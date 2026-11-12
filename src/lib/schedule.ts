import { routeBetween } from '../api/clients'
import type { Conditions, Day, Issue, Leg, LatLng, Pace, Plan, Settings, Stop } from '../types'
import { checkOpen } from './hours'
import { fetchLive, peek } from './live'
import { dow, fromMin, toMin } from './time'
import { transitLinks } from './transit'
import { ensureOrigin } from './geo'

export const PACE_LIMITS: Record<Pace, { stops: number; walkKm: number; label: string }> = {
  relaxed: { stops: 3, walkKm: 6, label: 'ゆったり' },
  standard: { stops: 5, walkKm: 10, label: '標準' },
  packed: { stops: 7, walkKm: 15, label: '詰め込み' },
}

/** 宿に着きたい時刻の上限（その日の終了予定とは別。夕食を宿でとる想定も含め19時） */
export const CHECKIN_BY = '19:00'

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
  // 公共交通の区間（電車・バス）：Routesの電車モードは日本で使えない（2026-11-12 実測）ため、車の所要時間×1.3＋待ち10分で仮置きし、乗換案内で確認してもらう
  const drive = await route(s, a, b, 'DRIVE')
  const minutes = drive ? Math.round(drive.minutes * 1.3) + 10 : Math.round((walk?.minutes ?? 60) / 3)
  // 所要時間の目安は道路の距離から推定しているが、経路は車道ではないので地図には線を引かない（直線で表示）
  return { mode: 'train', minutes, estimated: true, transitLinks: transitLinks(aName, bName, a, b, date, hhmm) }
}

/** 区間を進める。使用者が乗換案内で調べた時刻があればそれを使い、推定区間のあとは「頃」扱いにする */
function advance(t: number, approx: boolean, leg: Leg, fixed?: { depart?: string; arrive: string }) {
  if (fixed) {
    const dep = fixed.depart ? toMin(fixed.depart) : null
    return { t: toMin(fixed.arrive), approx: false, missed: dep !== null && !approx && dep < t ? fromMin(dep) : null }
  }
  return { t: t + leg.minutes, approx: approx || !!leg.estimated, missed: null }
}

/** 1日分の移動時間・到着出発時刻を計算する（stops の順番と滞在分はそのまま） */
export async function scheduleDay(s: Settings, c: Conditions, day: Day, isLast: boolean): Promise<Day & { missed: { stopId: string; at: string }[] }> {
  await Promise.all([...day.stops, ...(day.lodging ? [day.lodging] : [])].map(st => fetchLive(st.placeId)))
  let t = toMin(day.startTime)
  let approx = !!day.startApprox
  let prev: LatLng = day.startPoint, prevName = day.startPoint.label
  const legs: Leg[] = []
  const stops: Stop[] = []
  const missed: { stopId: string; at: string }[] = []
  let walkMeters = 0, moveMinutes = 0
  const go = async (st: Stop) => {
    const here = coordOf(st)
    const leg = here ? await makeLeg(s, c, prev, here, prevName, nameOf(st), day.date, fromMin(t)) : { mode: 'walk' as const, minutes: 0 }
    if (leg.mode === 'walk') walkMeters += leg.meters ?? 0
    moveMinutes += leg.minutes
    const a = advance(t, approx, leg, leg.mode === 'train' ? st.transitIn : undefined)
    if (a.missed) missed.push({ stopId: st.id, at: a.missed })
    t = a.t; approx = a.approx
    const arrive = fromMin(t)
    t += st.stayMin
    if (here) { prev = here; prevName = nameOf(st) }
    return { leg, stop: { ...st, arrive, depart: fromMin(t), approx } }
  }
  for (const st of day.stops) { const r = await go(st); legs.push(r.leg); stops.push(r.stop) }
  let returnLeg: Leg | undefined, lodging: Stop | undefined, lodgingLeg: Leg | undefined, returnApprox: boolean | undefined
  if (!isLast && day.lodging) {
    const r = await go({ ...day.lodging, stayMin: 0 })
    lodging = r.stop; lodgingLeg = r.leg
  }
  if (isLast && c.origin) {
    returnLeg = await makeLeg(s, c, prev, c.origin.coord, prevName, c.origin.label, day.date, fromMin(t))
    moveMinutes += returnLeg.minutes
    if (returnLeg.mode === 'walk') walkMeters += returnLeg.meters ?? 0
    t += returnLeg.minutes
    returnApprox = approx || !!returnLeg.estimated
  }
  const end = lodging ? Math.min(toMin(day.endTime), toMin(CHECKIN_BY)) : toMin(day.endTime)
  return { ...day, stops, legs, returnLeg, returnApprox, lodging, lodgingLeg, walkMeters, moveMinutes, slackMinutes: end - t, missed }
}

export function validatePlan(c: Conditions, plan: Plan, missed: { dayIndex: number; stopId: string; at: string }[] = []): { issues: Issue[]; wishHits: Record<string, boolean> } {
  const issues: Issue[] = []
  const pace = PACE_LIMITS[c.pace ?? 'standard']
  plan.days.forEach((d, i) => {
    for (const st of d.stops) {
      const live = peek(st.placeId)
      const r = checkOpen(live?.periods, dow(d.date), toMin(st.arrive!), toMin(st.depart!))
      if (!r.ok) issues.push({ dayIndex: i, stopId: st.id, kind: 'closed', text: `${i + 1}日目「${nameOf(st)}」：${r.reason}（${st.arrive}〜${st.depart}${st.approx ? '、時刻は推定' : ''}）` })
    }
    if (d.slackMinutes < 0) {
      const what = d.lodging ? `宿に着くのが${CHECKIN_BY}（または終了予定）より` : `終了予定${d.endTime}を`
      issues.push({ dayIndex: i, kind: 'over_time', text: `${i + 1}日目：${what}${-d.slackMinutes}分遅い` })
    }
    const visits = d.stops.filter(s => s.kind !== 'meal').length
    if (visits > pace.stops) issues.push({ dayIndex: i, kind: 'pace_count', text: `${i + 1}日目：立ち寄り${visits}か所（${pace.label}の上限${pace.stops}）` })
    if (d.walkMeters / 1000 > pace.walkKm) issues.push({ dayIndex: i, kind: 'pace_walk', text: `${i + 1}日目：歩行${(d.walkMeters / 1000).toFixed(1)}km（${pace.label}の上限${pace.walkKm}km）` })
    if (i < plan.days.length - 1 && !d.lodging) issues.push({ dayIndex: i, kind: 'other', text: `${i + 1}日目：宿が決まっていない（「宿を探す」で選べます）` })
  })
  for (const m of missed) {
    const st = plan.days[m.dayIndex].stops.find(x => x.id === m.stopId) ?? plan.days[m.dayIndex].lodging
    issues.push({ dayIndex: m.dayIndex, stopId: m.stopId, kind: 'over_time', text: `${m.dayIndex + 1}日目「${st ? nameOf(st) : ''}」へ向かう便（${m.at}発）に、前の予定が終わってからでは間に合わない` })
  }
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
  await ensureOrigin(s, c)
  const days: Day[] = []
  const missed: { dayIndex: number; stopId: string; at: string }[] = []
  for (let i = 0; i < plan.days.length; i++) {
    const d = { ...plan.days[i] }
    if (i === 0 && c.origin) d.startPoint = { ...c.origin.coord, label: c.origin.label, fetchedAt: c.origin.fetchedAt }
    // 2日目以降の起点は前日の宿（宿が未定なら前日の最後の立ち寄り先）
    if (i > 0) {
      const last = days[i - 1].lodging ?? days[i - 1].stops.at(-1)
      const p = last && coordOf(last)
      if (p) d.startPoint = { lat: p.lat, lng: p.lng, label: nameOf(last!), fetchedAt: last!.official?.coord ? undefined : new Date().toISOString() }
    }
    const { missed: m, ...day } = await scheduleDay(s, c, d, i === plan.days.length - 1)
    m.forEach(x => missed.push({ dayIndex: i, ...x }))
    days.push(day)
  }
  const next = { ...plan, days }
  const { issues, wishHits } = validatePlan(c, next, missed)
  return { ...next, issues, wishHits, status: issues.length ? 'conflict' : 'ok' }
}

/** 推定の時刻は15分単位に丸めて「頃」を付ける */
export function showTime(hhmm: string | undefined, approx?: boolean) {
  if (!hhmm) return ''
  if (!approx) return hhmm
  const m = Math.round(toMin(hhmm) / 15) * 15
  return `${fromMin(m)}頃`
}
