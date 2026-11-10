import { routeBetween } from '../api/clients'
import type { Conditions, Day, Issue, Leg, LatLng, Pace, Plan, Settings, Stop } from '../types'
import { checkOpen } from './hours'
import { fetchLive, peek } from './live'
import { dow, fromMin, toMin } from './time'
import { transitLinks } from './transit'

export const PACE_LIMITS: Record<Pace, { stops: number; walkKm: number; label: string }> = {
  relaxed: { stops: 3, walkKm: 6, label: 'ゆったり' },
  standard: { stops: 5, walkKm: 10, label: '標準' },
  packed: { stops: 7, walkKm: 15, label: '詰め込み' },
}

/** 同じ2点間の経路はセッション中は使い回す（Routes の呼び出し回数を抑える） */
const routeCache = new Map<string, Awaited<ReturnType<typeof routeBetween>>>()
export const apiCount = { routes: 0 }
async function route(s: Settings, a: LatLng, b: LatLng, mode: 'WALK' | 'DRIVE') {
  const k = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}:${mode}`
  if (!routeCache.has(k)) { apiCount.routes++; routeCache.set(k, await routeBetween(s, a, b, mode)) }
  return routeCache.get(k)!
}

export function coordOf(stop: Stop): LatLng | null {
  const live = peek(stop.placeId)
  if (live) return live.location
  if (stop.googleCoord) return stop.googleCoord
  return stop.official?.coord ?? null
}
export function nameOf(stop: Stop): string {
  return stop.official?.name ?? peek(stop.placeId)?.name ?? '（名称を取得中）'
}

async function makeLeg(s: Settings, c: Conditions, a: LatLng, b: LatLng, aName: string, bName: string, date: string, hhmm: string): Promise<Leg> {
  const mode = c.mode ?? 'walk_transit'
  if (mode === 'car') {
    const r = await route(s, a, b, 'DRIVE')
    return { mode: 'car', minutes: r?.minutes ?? 0, meters: r?.meters, polyline: r?.polyline }
  }
  const walk = await route(s, a, b, 'WALK')
  const walkLimit = mode === 'train' ? 1500 : 2500
  if (walk && walk.meters <= walkLimit) return { mode: 'walk', minutes: walk.minutes, meters: walk.meters, polyline: walk.polyline }
  // 電車区間：Routesの電車モードは日本で使えないため、車の所要時間×1.3＋待ち10分で仮置きし、乗換案内で確認してもらう
  const drive = await route(s, a, b, 'DRIVE')
  const minutes = drive ? Math.round(drive.minutes * 1.3) + 10 : Math.round((walk?.minutes ?? 60) / 3)
  return { mode: 'train', minutes, estimated: true, transitLinks: transitLinks(aName, bName, a, b, date, hhmm), polyline: drive?.polyline }
}

/** 1日分の移動時間・到着出発時刻を計算する（stops の順番と滞在分はそのまま） */
export async function scheduleDay(s: Settings, c: Conditions, day: Day, isLast: boolean): Promise<Day> {
  await Promise.all(day.stops.map(st => fetchLive(st.placeId)))
  let t = toMin(day.startTime)
  let prev: LatLng = day.startPoint, prevName = day.startPoint.label
  const legs: Leg[] = []
  const stops: Stop[] = []
  let walkMeters = 0, moveMinutes = 0
  for (const st of day.stops) {
    const here = coordOf(st)
    const leg = here ? await makeLeg(s, c, prev, here, prevName, nameOf(st), day.date, fromMin(t)) : { mode: 'walk' as const, minutes: 0 }
    legs.push(leg)
    if (leg.mode === 'walk') walkMeters += leg.meters ?? 0
    moveMinutes += leg.minutes
    t += leg.minutes
    const arrive = fromMin(t)
    t += st.stayMin
    stops.push({ ...st, arrive, depart: fromMin(t) })
    if (here) { prev = here; prevName = nameOf(st) }
  }
  let returnLeg: Leg | undefined
  if (isLast && c.origin && day.stops.length) {
    returnLeg = await makeLeg(s, c, prev, c.origin.coord, prevName, c.origin.label, day.date, fromMin(t))
    moveMinutes += returnLeg.minutes
    if (returnLeg.mode === 'walk') walkMeters += returnLeg.meters ?? 0
    t += returnLeg.minutes
  }
  return { ...day, stops, legs, returnLeg, walkMeters, moveMinutes, slackMinutes: toMin(day.endTime) - t }
}

export function validatePlan(c: Conditions, plan: Plan): { issues: Issue[]; wishHits: Record<string, boolean> } {
  const issues: Issue[] = []
  const pace = PACE_LIMITS[c.pace ?? 'standard']
  plan.days.forEach((d, i) => {
    for (const st of d.stops) {
      const live = peek(st.placeId)
      const r = checkOpen(live?.periods, dow(d.date), toMin(st.arrive!), toMin(st.depart!))
      if (!r.ok) issues.push({ dayIndex: i, stopId: st.id, kind: 'closed', text: `${i + 1}日目「${nameOf(st)}」：${r.reason}（${st.arrive}〜${st.depart}）` })
    }
    if (d.slackMinutes < 0) issues.push({ dayIndex: i, kind: 'over_time', text: `${i + 1}日目：終了予定${d.endTime}を${-d.slackMinutes}分超える` })
    const visits = d.stops.filter(s => s.kind !== 'meal').length
    if (visits > pace.stops) issues.push({ dayIndex: i, kind: 'pace_count', text: `${i + 1}日目：立ち寄り${visits}か所（${pace.label}の上限${pace.stops}）` })
    if (d.walkMeters / 1000 > pace.walkKm) issues.push({ dayIndex: i, kind: 'pace_walk', text: `${i + 1}日目：歩行${(d.walkMeters / 1000).toFixed(1)}km（${pace.label}の上限${pace.walkKm}km）` })
  })
  const ids = new Set(plan.days.flatMap(d => d.stops.map(s => s.placeId)))
  const wishHits: Record<string, boolean> = {}
  for (const w of c.wishes) {
    if (w.priority !== 'must' && w.priority !== 'want') continue
    const hit = !!w.placeId && ids.has(w.placeId)
    wishHits[w.id] = hit
    if (w.priority === 'must' && !hit) issues.push({ dayIndex: null, kind: 'missing_must', text: `必須「${w.text}」が入っていない` })
  }
  return { issues, wishHits }
}

export async function scheduleAndValidate(s: Settings, c: Conditions, plan: Plan): Promise<Plan> {
  const days: Day[] = []
  for (let i = 0; i < plan.days.length; i++) {
    const d = { ...plan.days[i] }
    // 2日目以降の起点は前日の最後の立ち寄り先（宿のエリア）
    if (i > 0) {
      const last = days[i - 1].stops.at(-1)
      const p = last && coordOf(last)
      if (p) d.startPoint = { ...p, label: nameOf(last!) }
    }
    days.push(await scheduleDay(s, c, d, i === plan.days.length - 1))
  }
  const next = { ...plan, days }
  const { issues, wishHits } = validatePlan(c, next)
  return { ...next, issues, wishHits, status: issues.length ? 'conflict' : 'ok' }
}
