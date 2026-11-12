import { claudeJSON, gsiGeocode, placesCandidates, rakutenVacant, type Candidate, type ClaudeUsage } from '../api/clients'
import { newId } from '../db'
import type { Conditions, Day, EventInfo, HotelCandidate, LatLng, MapArea, OfficialInfo, Plan, Settings, Stop, StopKind, Trip } from '../types'
import { peek, remember } from './live'
import { PACE_LIMITS, apiCount, coordOf, nameOf, scheduleAndValidate } from './schedule'
import { addDays, daysBetween, dow, fromMin, toMin, today } from './time'
import { distanceKm, ensureHomeTravel, ensureOrigin } from './geo'

export type Progress = (msg: string) => void

const shift = (hhmm: string, min: number) => fromMin(Math.max(0, Math.min(24 * 60 - 1, toMin(hhmm) + min)))

/** 費用の集計（概算。為替は1ドル150円と仮定） */
export class CostMeter {
  claudeIn = 0; claudeOut = 0; searches = 0; places = 0
  add(u: ClaudeUsage) { this.claudeIn += u.input; this.claudeOut += u.output; this.searches += u.searches }
  /** Sonnet 5.5：入力$2・出力$10／100万トークン、ウェブ検索$10／1,000回、Places Enterprise超過時$0.035／件 */
  yen(includePlaces = false) {
    const usd = this.claudeIn * 2e-6 + this.claudeOut * 10e-6 + this.searches * 0.01 + (includePlaces ? this.places * 0.035 : 0)
    return Math.round(usd * 150)
  }
  summary() {
    return `Claude 入力${this.claudeIn.toLocaleString()}・出力${this.claudeOut.toLocaleString()}トークン、ウェブ検索${this.searches}回、Places ${this.places}件、Routes ${apiCount.routes}件 → 約${this.yen()}円（Placesは月1,000件の無料枠内なら0円、超えると約${this.yen(true)}円）`
  }
}

// ---------- 候補集め ----------

export interface CandidatePool { all: Candidate[]; wishPlace: Record<string, Candidate | undefined> }

export async function gatherCandidates(s: Settings, c: Conditions, areas: MapArea[], meter: CostMeter, progress: Progress): Promise<CandidatePool> {
  const pool = new Map<string, Candidate>()
  const wishPlace: Record<string, Candidate | undefined> = {}
  const add = (cs: Candidate[]) => cs.forEach(x => { pool.set(x.id, x); remember(x) })
  const q = async (a: MapArea, text: string, max: number) => { meter.places++; return placesCandidates(s, text, a.center, a.radiusKm * 1000, max) }
  const main = areas[0]

  // 必須・できれば：どの範囲にあるか分からないので、範囲ごとに探して一番近いものを採る
  for (const w of c.wishes.filter(w => w.priority === 'must' || w.priority === 'want')) {
    progress(`「${w.text}」を探しています`)
    let hit: Candidate | undefined
    for (const a of areas) {
      const cs = await q(a, w.text, 3)
      hit = (w.placeId && cs.find(x => x.id === w.placeId)) || hit || cs[0]
      if (hit && distanceKm(hit.location, a.center) <= a.radiusKm) break
    }
    wishPlace[w.id] = hit
    if (hit) { w.placeId = hit.id; add([hit]) }
  }
  for (const a of areas) {
    for (const w of c.wishes.filter(w => w.priority === 'auto')) {
      progress(`${a.name}：テーマ「${w.text}」の候補を探しています`)
      add(await q(a, `${w.text} ${a.name}`, 6))
    }
    progress(`${a.name}：食事と名所の候補を探しています`)
    add(await q(a, c.food ? `${c.food} ${a.name}` : `${a.name} 郷土料理`, 6))
    add(await q(a, `${a.name} カフェ`, 3))
    add(await q(a, `${a.name} 観光名所`, areas.length > 1 ? 10 : 15))
  }
  void main

  const ex = c.wishes.filter(w => w.priority === 'exclude').map(w => w.text.trim()).filter(Boolean)
  const keep = [...pool.values()].filter(x => !ex.some(e => x.name.includes(e) || (x.typeLabel ?? '').includes(e)))
  return { all: keep, wishPlace }
}

// ---------- 宿（Google Places の宿泊施設。予定の各日の最後に置く） ----------

const lodgingCache = new Map<string, Candidate[]>()

export async function lodgingCandidates(s: Settings, c: Conditions, near: LatLng, area: string | undefined, meter: CostMeter): Promise<Candidate[]> {
  const key = `${near.lat.toFixed(3)},${near.lng.toFixed(3)}|${area ?? ''}|${c.lodging ?? ''}`
  if (!lodgingCache.has(key)) {
    meter.places++
    const cs = await placesCandidates(s, `${c.lodging ?? ''} ${area ?? ''} ホテル 旅館`.trim(), near, 8000, 8, 'lodging')
    cs.forEach(remember)
    lodgingCache.set(key, cs)
  }
  return lodgingCache.get(key)!
}

const lodgingStop = (h: Candidate, prev?: Stop): Stop => ({
  id: prev?.placeId === h.id ? prev.id : newId(), placeId: h.id, stayMin: 0, kind: 'lodging', pinned: prev?.placeId === h.id ? prev.pinned : false,
  googleCoord: { ...h.location, fetchedAt: new Date().toISOString() },
})

/** 最終日以外の各日に宿を置く。固定した宿はそのまま。評価が高く、件数の多いものを選ぶ */
export async function assignLodging(s: Settings, c: Conditions, plan: Plan, meter: CostMeter, progress: Progress): Promise<Plan> {
  const days = [...plan.days]
  const now = new Date().toISOString()
  for (let i = 0; i < days.length - 1; i++) {
    const d = days[i]
    const last = d.stops.at(-1)
    const near = last && coordOf(last)
    if (!near) continue
    progress(`${i + 1}日目の宿を選んでいます`)
    const cs = await lodgingCandidates(s, c, near, d.lodgingArea, meter)
    const hotels: HotelCandidate[] = cs.map(h => ({ source: 'google', placeId: h.id, fetchedAt: now }))
    if (d.lodging?.pinned) { days[i] = { ...d, hotels, hotelsFetchedAt: now }; continue }
    const best = [...cs].sort((a, b) => score(b) - score(a))[0]
    days[i] = { ...d, hotels, hotelsFetchedAt: now, lodging: best ? lodgingStop(best, d.lodging) : undefined }
  }
  return { ...plan, days }
}
const score = (h: Candidate) => (h.rating ?? 3) + Math.log10((h.ratingCount ?? 0) + 1) * 0.3

export function chooseLodging(plan: Plan, dayIndex: number, h: Candidate): Plan {
  return { ...plan, days: plan.days.map((d, i) => (i === dayIndex ? { ...d, lodging: { ...lodgingStop(h, d.lodging), pinned: true } } : d)) }
}

// ---------- Claude による組み立て ----------

interface DraftDay { date: string; stops: { id: string; stayMin: number; kind: StopKind }[]; lodgingArea?: string; rainPlan?: string }
interface Draft { days: DraftDay[] }

const DRAFT_TOOL = {
  name: 'submit_itinerary',
  description: '組み立てた行程を提出する',
  input_schema: {
    type: 'object', required: ['days'],
    properties: {
      days: {
        type: 'array',
        items: {
          type: 'object', required: ['date', 'stops'],
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            stops: { type: 'array', items: { type: 'object', required: ['id', 'stayMin', 'kind'], properties: { id: { type: 'string', description: '候補のid' }, stayMin: { type: 'integer' }, kind: { type: 'string', enum: ['sight', 'meal', 'cafe', 'shop', 'other'] } } } },
            lodgingArea: { type: 'string' },
            rainPlan: { type: 'string' },
          },
        },
      },
    },
  },
}

const SYSTEM = `あなたは国内旅行の行程を組み立てる担当です。
- 立ち寄り先は、与えられた候補の id からだけ選ぶ。候補にない場所を作らない
- 必須は全部入れる。できればは時間が許す範囲で入れる。除外に当たるものは入れない
- 1日の立ち寄り数（食事を除く）はペースの上限以内。昼食は11:30〜13:30、夕食は18:00〜20:00ごろに1回ずつ（その日の時間帯に含まれる場合のみ）
- 営業時間（曜日別）に合う順番にし、座標を見て移動が往復にならない順に並べる
- 電車の時刻・運賃は書かない
- 範囲が複数ある場合は、日ごとに回る範囲をまとめ、範囲の間の移動は1日1回程度にする
- 最終日以外は、その日の最後にアプリが lodgingArea の近くの宿を置く。宿へは19:00までに着けるよう、最後の立ち寄り先を lodgingArea の近くにする
- 初日は玄関口（到着駅など）から始まり、最終日は玄関口に戻って終わる
- rainPlan は雨天時の代案を1〜2文（候補の名前を使ってよい）。lodgingArea は宿泊に向いたエリア名（最終日は不要）
- 結果は submit_itinerary で提出する`

function describeCandidates(pool: Candidate[], dates: string[]) {
  const wd = [...new Set(dates.map(dow))]
  return pool.map(x => {
    const hours = x.weekdayText ? wd.map(d => x.weekdayText![(d + 6) % 7]).join(' / ') : '営業時間不明'
    return `- id=${x.id} | ${x.name} | ${x.typeLabel ?? x.type ?? ''} | 評価${x.rating ?? '-'}(${x.ratingCount ?? 0}) | ${x.location.lat.toFixed(4)},${x.location.lng.toFixed(4)} | ${hours}`
  }).join('\n')
}

function describeConditions(c: Conditions, days: Day[], pool: CandidatePool, angle: string, areas: MapArea[]) {
  const pace = PACE_LIMITS[c.pace ?? 'standard']
  const w = (p: string) => c.wishes.filter(x => x.priority === p)
  const lines = [
    `観点：${angle}`,
    `日程：${days.map(d => `${d.date} ${d.startTime}〜${d.endTime}`).join('、')}`,
    `範囲：${areas.map(a => `${a.name}（中心 ${a.center.lat.toFixed(3)},${a.center.lng.toFixed(3)}、半径${a.radiusKm}km）`).join('、')}`,
    `玄関口（初日の到着・最終日の出発）：${days[0].startPoint.label}（${days[0].startPoint.lat.toFixed(4)},${days[0].startPoint.lng.toFixed(4)}）`,
    `移動手段：${{ train: '電車中心', car: '車', walk_transit: '徒歩と公共交通' }[c.mode ?? 'walk_transit']}`,
    `ペース：${pace.label}（立ち寄り上限${pace.stops}か所、歩行上限${pace.walkKm}km）`,
    `必須：${w('must').map(x => `${x.text}${pool.wishPlace[x.id] ? `(id=${pool.wishPlace[x.id]!.id})` : '(候補なし)'}`).join('、') || 'なし'}`,
    `できれば：${w('want').map(x => `${x.text}${pool.wishPlace[x.id] ? `(id=${pool.wishPlace[x.id]!.id})` : ''}`).join('、') || 'なし'}`,
    `おまかせのテーマ：${w('auto').map(x => x.text).join('、') || 'なし'}`,
    `除外：${w('exclude').map(x => x.text).join('、') || 'なし'}`,
    `食事の希望：${c.food ?? 'おまかせ'}`, `宿の希望：${c.lodging ?? 'おまかせ'}`, `予算感：${c.budget ?? 'おまかせ'}`,
  ]
  return lines.join('\n')
}

export function buildDaySkeletons(c: Conditions, areas: MapArea[], travel: { minutes: number; estimated: boolean } | null = null): Day[] {
  const area = areas[0]
  const startDate = c.start?.slice(0, 10) ?? addDays(today(), 7)
  const endDate = c.end?.slice(0, 10) ?? startDate
  const dates = daysBetween(startDate, endDate < startDate ? startDate : endDate)
  const relaxed = c.pace === 'relaxed'
  const origin = c.origin ? { ...c.origin.coord, label: c.origin.label, fetchedAt: c.origin.fetchedAt } : { ...area.center, label: `${area.name}（範囲の中心）` }
  return dates.map((date, i) => ({
    date,
    startTime: i === 0 && c.start ? shift(c.start.slice(11, 16), c.startBasis === 'home' ? travel?.minutes ?? 0 : 0) : relaxed ? '10:00' : '09:00',
    endTime: i === dates.length - 1 && c.end ? shift(c.end.slice(11, 16), c.endBasis === 'home' ? -(travel?.minutes ?? 0) : 0) : relaxed ? '18:00' : '19:30',
    startApprox: i === 0 && !!c.start && c.startBasis === 'home' && !!travel?.estimated,
    endApprox: i === dates.length - 1 && !!c.end && c.endBasis === 'home' && !!travel?.estimated,
    startPoint: origin, stops: [], legs: [], walkMeters: 0, moveMinutes: 0, slackMinutes: 0, hotels: [],
  }))
}

function draftToPlan(draft: Draft, skeleton: Day[], angle: string, pool: Candidate[], keepPinned?: Plan): Plan {
  const valid = new Set(pool.map(x => x.id))
  const days = skeleton.map((sk, i) => {
    const dd = draft.days.find(d => d.date === sk.date) ?? draft.days[i]
    const stops: Stop[] = (dd?.stops ?? []).filter(x => valid.has(x.id) || keepPinned?.days.some(d => d.stops.some(s => s.placeId === x.id))).map(x => {
      const prev = keepPinned?.days.flatMap(d => d.stops).find(s => s.placeId === x.id)
      const live = peek(x.id)
      return {
        id: prev?.id ?? newId(), placeId: x.id, stayMin: Math.max(15, Math.min(240, x.stayMin || 60)),
        kind: x.kind ?? 'sight', pinned: prev?.pinned ?? false, official: prev?.official,
        googleCoord: live ? { ...live.location, fetchedAt: new Date().toISOString() } : prev?.googleCoord,
      }
    })
    const keptLodging = keepPinned?.days.find(d => d.date === sk.date)?.lodging
    return { ...sk, stops, lodgingArea: dd?.lodgingArea, rainPlan: dd?.rainPlan, lodging: keptLodging?.pinned ? keptLodging : undefined }
  })
  return { id: newId(), angle, days, issues: [], status: 'ok', attempts: 0, createdAt: new Date().toISOString(), wishHits: {} }
}

function planToDraft(p: Plan): Draft {
  return { days: p.days.map(d => ({ date: d.date, stops: d.stops.map(s => ({ id: s.placeId, stayMin: s.stayMin, kind: s.kind })), lodgingArea: d.lodgingArea, rainPlan: d.rainPlan })) }
}

/** 1案を作る：組み立て→計算→検証→（破綻があれば）組み直し を上限回数まで */
export async function generatePlan(s: Settings, c: Conditions, areas: MapArea[], pool: CandidatePool, angle: string, meter: CostMeter, progress: Progress): Promise<Plan> {
  await ensureOrigin(s, c)
  if ((c.startBasis === 'home' || c.endBasis === 'home') && !c.homeTravelMin && !c.homeTravelEst) progress('家から玄関口までの所要時間の目安を調べています')
  const travel = await ensureHomeTravel(s, c, u => meter.add(u))
  const skeleton = buildDaySkeletons(c, areas, travel)
  const base = `${describeConditions(c, skeleton, pool, angle, areas)}\n\n候補（id | 名前 | 種類 | 評価(件数) | 緯度,経度 | 該当曜日の営業時間）：\n${describeCandidates(pool.all, skeleton.map(d => d.date))}`
  progress(`「${angle}」の案を組み立てています`)
  let res = await claudeJSON<Draft>(s, SYSTEM, base, { tool: DRAFT_TOOL, maxTokens: 16000 })
  meter.add(res.usage)
  let plan = draftToPlan(res.data, skeleton, angle, pool.all)
  for (let attempt = 0; ; attempt++) {
    plan = await assignLodging(s, c, plan, meter, progress)
    progress(`「${angle}」の移動時間と営業時間を確認しています（${attempt + 1}回目）`)
    plan = await scheduleAndValidate(s, c, plan)
    plan.attempts = attempt + 1
    if (plan.status === 'ok' || attempt >= s.maxRepair) return plan
    progress(`「${angle}」の破綻を直しています（${plan.issues.length}件）`)
    const fix = `${base}\n\n前回の案：\n${JSON.stringify(planToDraft(plan))}\n\n計算で見つかった破綻：\n${plan.issues.map(i => `- ${i.text}`).join('\n')}\n\n各日の移動時間（分）と空き時間：\n${plan.days.map((d, i) => `${i + 1}日目 移動${d.moveMinutes}分・余り${d.slackMinutes}分・歩行${(d.walkMeters / 1000).toFixed(1)}km`).join('\n')}\n\n破綻を解消した案を同じ形式で出し直してください。必須同士がどうしても両立しない場合も、必須を黙って外さず、入れたまま出してください。`
    res = await claudeJSON<Draft>(s, SYSTEM, fix, { tool: DRAFT_TOOL, maxTokens: 16000 })
    meter.add(res.usage)
    plan = draftToPlan(res.data, skeleton, angle, pool.all)
  }
}

/** 指定した1日だけ作り直す（固定した立ち寄り先は残す） */
export async function regenerateDay(s: Settings, trip: Trip, plan: Plan, dayIndex: number, areas: MapArea[], meter: CostMeter, progress: Progress): Promise<Plan> {
  const c = trip.conditions
  const pool = await gatherCandidates(s, c, areas, meter, progress)
  const day = plan.days[dayIndex]
  const others = new Set(plan.days.filter((_, i) => i !== dayIndex).flatMap(d => d.stops.map(x => x.placeId)))
  const pinned = day.stops.filter(x => x.pinned)
  pinned.forEach(p => { const l = peek(p.placeId); if (l && !pool.all.some(x => x.id === l.id)) pool.all.push(l) })
  const cands = pool.all.filter(x => !others.has(x.id))
  const prompt = `${describeConditions(c, [day], pool, plan.angle, areas)}\n\nこの日（${day.date} ${day.startTime}〜${day.endTime}、出発地点 ${day.startPoint.label}）だけを作り直します。\n固定（必ず残す。順番は変えてよい）：${pinned.map(p => `id=${p.placeId} ${nameOf(p)}`).join('、') || 'なし'}\n他の日に入っている場所は使わない。\n\n候補：\n${describeCandidates(cands, [day.date])}\n\n1日分だけを days に入れて提出する。`
  progress(`${dayIndex + 1}日目を作り直しています`)
  const res = await claudeJSON<Draft>(s, SYSTEM, prompt, { tool: DRAFT_TOOL, maxTokens: 16000 })
  meter.add(res.usage)
  const one = draftToPlan(res.data, [day], plan.angle, cands, plan)
  const days = plan.days.map((d, i) => (i === dayIndex ? { ...one.days[0], hotels: d.hotels, hotelsFetchedAt: d.hotelsFetchedAt, lodging: d.lodging?.pinned ? d.lodging : undefined } : d))
  const withLodging = await assignLodging(s, c, { ...plan, days }, meter, progress)
  progress('移動時間と営業時間を確認しています')
  return scheduleAndValidate(s, c, withLodging)
}

/** 日ごとに別の案を選んで1つにまとめ、つなぎ目を検証し直す */
export async function combinePlans(s: Settings, trip: Trip, picks: string[]): Promise<Plan> {
  const days = picks.map((pid, i) => structuredClone(trip.plans.find(p => p.id === pid)!.days[i]))
  const angle = `組み合わせ（${picks.map((pid, i) => `${i + 1}日目:${trip.plans.find(p => p.id === pid)!.angle}`).join('・')}）`
  const plan: Plan = { id: newId(), angle, days, issues: [], status: 'ok', attempts: 1, createdAt: new Date().toISOString(), wishHits: {} }
  // 同じ場所が2日に入っていないか
  const seen = new Map<string, number>()
  const dup: string[] = []
  days.forEach((d, i) => d.stops.forEach(x => { if (seen.has(x.placeId)) dup.push(`${seen.get(x.placeId)! + 1}日目と${i + 1}日目に「${nameOf(x)}」が重複`); else seen.set(x.placeId, i) }))
  const checked = await scheduleAndValidate(s, trip.conditions, plan)
  if (dup.length) { checked.issues.push(...dup.map(text => ({ dayIndex: null, kind: 'other' as const, text }))); checked.status = 'conflict' }
  return checked
}

// ---------- 見頃・イベント（ウェブ検索、出典付き） ----------

export async function fetchEvents(s: Settings, areas: MapArea[], c: Conditions, meter: CostMeter): Promise<EventInfo[]> {
  const from = c.start?.slice(0, 10) ?? today(), to = c.end?.slice(0, 10) ?? from
  const res = await claudeJSON<{ events: { title: string; period?: string; place?: string; sourceUrl: string }[] }>(s,
    'ウェブ検索で調べた事実だけを書く。記憶から日程を書かない。出典URLが確認できないものは出さない。出力はJSONのみ。',
    `${areas.map(area => `${area.name}周辺（中心 ${area.center.lat.toFixed(3)},${area.center.lng.toFixed(3)}、半径${area.radiusKm}km）`).join('、')}で、${from}〜${to}に見頃の花・紅葉・食材、開催中のイベント・祭り・展覧会を調べてください。日程が今年のものか必ず確認すること。\n{"events":[{"title":"","period":"","place":"","sourceUrl":""}]}`,
    { maxSearches: 5, maxTokens: 4000 })
  meter.add(res.usage)
  const now = new Date().toISOString()
  return (res.data.events ?? []).filter(e => e.sourceUrl).map(e => ({ ...e, checkedAt: now }))
}

// ---------- 公式サイトの控え（ウェブ検索、出典付き） ----------

export async function fetchOfficialInfo(s: Settings, plan: Plan, meter: CostMeter, progress: Progress): Promise<Plan> {
  const stops = plan.days.flatMap(d => d.stops).filter(x => !x.official)
  const now = new Date().toISOString()
  const found = new Map<string, OfficialInfo>()
  for (let i = 0; i < stops.length; i += 6) {
    const batch = stops.slice(i, i + 6)
    progress(`公式サイトを確認しています（${i + 1}〜${i + batch.length}／${stops.length}か所）`)
    const list = batch.map(x => { const l = peek(x.placeId); return `- key=${x.placeId} | ${l?.name ?? ''} | ${l?.address ?? ''}` }).join('\n')
    const res = await claudeJSON<{ items: { key: string; name: string; address?: string; hours?: string; closed?: string; fee?: string; highlight?: string; sourceUrl?: string; official: boolean }[] }>(s,
      'ウェブ検索で各施設の公式サイト（なければ自治体・観光協会のページ）を探し、そこに書かれている内容だけを書く。記憶から書かない。見つからない項目は省く。出力はJSONのみ。',
      `次の施設について、公式の名称・住所・営業時間・定休日・料金・見どころ（1文）と、その出典URLを調べてください。公式サイトが見つからない場合は official:false。\n${list}\n\n{"items":[{"key":"","name":"","address":"","hours":"","closed":"","fee":"","highlight":"","sourceUrl":"","official":true}]}`,
      { maxSearches: batch.length * 2, maxTokens: 6000 })
    meter.add(res.usage)
    for (const it of res.data.items ?? []) {
      let coord
      if (it.address) { try { coord = (await gsiGeocode(it.address))[0]?.coord } catch { /* 住所検索に失敗しても続行 */ } }
      found.set(it.key, { name: it.name, address: it.address, coord, hours: it.hours, closed: it.closed, fee: it.fee, highlight: it.highlight, sourceUrl: it.sourceUrl, checkedAt: now, needsCheck: !it.official || !it.sourceUrl })
    }
    for (const x of batch) if (!found.has(x.placeId)) found.set(x.placeId, { name: peek(x.placeId)?.name ?? '（名称不明）', checkedAt: now, needsCheck: true })
  }
  return { ...plan, days: plan.days.map(d => ({ ...d, stops: d.stops.map(x => (found.has(x.placeId) ? { ...x, official: found.get(x.placeId) } : x)) })) }
}

// ---------- 宿（Google Places の宿泊施設＋予約サイトへのリンク、楽天キーがあれば空室検索も） ----------

export async function fetchHotels(s: Settings, plan: Plan, c: Conditions, meter: CostMeter, progress: Progress): Promise<Plan> {
  const withGoogle = await assignLodging(s, c, plan, meter, progress)
  if (!(s.rakutenAppId && s.rakutenAccessKey)) return withGoogle
  const days = [...withGoogle.days]
  for (let i = 0; i < days.length - 1; i++) {
    const p = (days[i].lodging && coordOf(days[i].lodging!)) || (days[i].stops.at(-1) && coordOf(days[i].stops.at(-1)!))
    if (!p) continue
    progress(`${i + 1}日目：楽天トラベルの空室を確認しています`)
    try {
      const r = await rakutenVacant(s, p, 3, days[i].date, days[i + 1].date, c.adults ?? 1)
      const now = new Date().toISOString()
      days[i] = { ...days[i], hotels: [...days[i].hotels, ...r.hotels.slice(0, 8).map(h => ({ source: 'rakuten' as const, hotelNo: h.hotelNo, name: h.hotelName, minCharge: h.hotelMinCharge, url: h.planListUrl ?? h.hotelInformationUrl ?? '', fetchedAt: now }))] }
    } catch (e) { progress(`楽天の空室検索に失敗：${(e as Error).message}`) }
    await new Promise(res => setTimeout(res, 1100)) // 楽天の短時間連続アクセス制限への配慮
  }
  return { ...withGoogle, days }
}
