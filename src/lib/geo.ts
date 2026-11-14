import { claudeJSON, gsiGeocode, placeDetails, placesLocate, placesWithin, routeBetween, type ClaudeUsage } from '../api/clients'
import type { Conditions, LatLng, Settings } from '../types'

export function distanceKm(a: LatLng, b: LatLng) {
  const R = 6371, t = (x: number) => (x * Math.PI) / 180
  const h = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const validCoord = (p?: LatLng | null): p is LatLng => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0)

const EXPIRE = 30 * 864e5

/** Google由来の出発地点は、座標が無いか30日を過ぎていたら場所IDから取り直す */
export async function ensureOrigin(s: Settings, c: Conditions) {
  const o = c.origin
  if (!o || o.source !== 'google' || !o.placeId) return
  if (validCoord(o.coord) && o.fetchedAt && Date.now() - Date.parse(o.fetchedAt) < EXPIRE) return
  const d = await placeDetails(s, o.placeId, 'id,location')
  c.origin = { ...o, coord: d.location, fetchedAt: new Date().toISOString() }
}

/** 家の時刻を基準にしたとき、家⇄玄関口の片道の所要時間（分）を決める。入力があればそれ。なければ、公共交通ならウェブ検索の目安、車を選んだときだけ車の経路 */
export async function ensureHomeTravel(s: Settings, c: Conditions, onUsage?: (u: ClaudeUsage) => void): Promise<{ minutes: number; estimated: boolean } | null> {
  const needs = c.startBasis === 'home' || c.endBasis === 'home'
  if (!needs) return null
  if (c.homeTravelMin) return { minutes: c.homeTravelMin, estimated: false }
  // 以前の版が車の経路で代用した値は、公共交通を選んでいるなら使わずに調べ直す
  if (c.homeTravelEst && (c.mode === 'car' || !String(c.homeTravelSource ?? '').startsWith('車の経路'))) return { minutes: c.homeTravelEst, estimated: true }
  if (!c.home || !c.origin) return null
  let lastError = '検索に失敗'
  // 公共交通なら、ウェブ検索で標準的な所要時間を出典付きで調べる（時刻や運賃は推測させない。所要時間の目安だけ）
  if (c.mode !== 'car' && s.anthropicKey) {
    try {
      const res = await claudeJSON<{ minutes?: number | string; route?: string; sourceUrl?: string }>(s,
        'ウェブ検索で調べた事実だけを使う。記憶から数字を書かない。',
        `「${c.home}」から「${c.origin.label}」まで、公共交通（新幹線・特急・在来線・バス・飛行機など一般的な経路）で行くときの、乗り換えを含む標準的な片道の所要時間を調べ、report_travel_time で報告してください。
調べ方：
1. まず「${c.home} ${c.origin.label} 所要時間」で探す
2. 直接の情報がなければ、最寄りの主要ターミナル（東京駅・上野駅・新宿駅・羽田空港など）から「${c.origin.label}」までの所要時間を探す。観光協会や自治体の「アクセス」のページによく載っている
3. 2を使った場合は、「${c.home}」からそのターミナルまでの所要時間と乗り換えの余裕（15分程度）を足す
4. 「最速」と書かれた値はそのまま使ってよい。route に経路と、足し算した場合はその内訳を書く`,
        { maxSearches: 5, maxTokens: 4000, tool: { name: 'report_travel_time', description: '調べた所要時間を報告する', input_schema: { type: 'object', required: ['minutes', 'sourceUrl'], properties: { minutes: { type: 'integer', description: '乗り換え込みの片道の所要時間（分）' }, route: { type: 'string', description: '主な経路を1行で' }, sourceUrl: { type: 'string' } } } } })
      onUsage?.(res.usage)
      const m = toMinutes(res.data.minutes)
      if (!m) lastError = '検索で所要時間を読み取れなかった'
      if (m && m > 0 && m < 24 * 60 && res.data.sourceUrl) {
        c.homeTravelEst = Math.round(m); c.homeTravelSource = `${res.data.route ?? ''} ${res.data.sourceUrl}`.trim()
        return { minutes: c.homeTravelEst, estimated: true }
      }
    } catch (e) { lastError = (e as Error).message }
  }
  // 公共交通を選んでいるのに車の経路で代用はしない（使用者の指摘 2026-11-12）。分からなければ「不明」として、所要時間の入力を促す
  if (c.mode !== 'car') { c.homeTravelSource = `不明（${lastError}）`; return null }
  if (!validCoord(c.origin.coord)) return null
  let h: LatLng | undefined = (await gsiGeocode(c.home).catch(() => []))[0]?.coord
  if (s.googleKey) {
    const g = (await placesLocate(s, c.home, { lat: 35.68, lng: 139.77 }, 50000).catch(() => []))[0]?.location
    if (g) h = g
  }
  if (!h) return null
  const r = await routeBetween(s, h, c.origin.coord, 'DRIVE').catch(() => null)
  if (!r) return null
  c.homeTravelEst = r.minutes; c.homeTravelSource = '車の経路（Google Routes）'
  return { minutes: r.minutes, estimated: true }
}

/** 「230」「3時間50分」「3:50」などを分に直す */
function toMinutes(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return undefined
  const hm = v.match(/(\d+)\s*(?:時間|:)\s*(\d+)?/)
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0)
  const m = v.match(/(\d+)/)
  return m ? Number(m[1]) : undefined
}

/** 行き先（最初の範囲）の近くの駅を、玄関口として自動で選ぶ */
/**
 * 行き先から玄関口（到着駅・空港）を自動で選ぶ。
 * 以前は「範囲の名前＋駅」で探して、範囲の外の同名の駅（鹿児島市吉野町 → 横浜の吉野町駅）を選んでいた（2026-11-14 の不具合）。
 * いまは範囲の中だけを探す（locationRestriction）。
 * 家から遠い（250km超）ときは、近くの小さな駅ではなく、新幹線の駅（または飛行機を使うなら空港）を玄関口にする。
 */
export async function autoGateway(s: Settings, area: { name: string; center: LatLng; radiusKm?: number }, opt: { home?: string | null; plane?: boolean; onUsage?: (u: ClaudeUsage) => void } = {}) {
  if (!s.googleKey) return null
  const near = async (q: string, km: number, type: string) =>
    (await placesWithin(s, q, area.center, km, type || undefined).catch(() => [])).sort((a, b) => distanceKm(a.location, area.center) - distanceKm(b.location, area.center))
  let homeKm = 0
  if (opt.home) {
    const h = (await placesLocate(s, opt.home, { lat: 35.68, lng: 139.77 }, 50000).catch(() => []))[0]?.location
    if (h) homeKm = distanceKm(h, area.center)
  }
  let pick: Awaited<ReturnType<typeof near>>[number] | undefined
  if (homeKm > 250) {
    // 遠い行き先：どの駅・空港に着くのが一般的かは、観光協会などの「アクセス」をウェブ検索して決める（記憶で決めない）
    if (s.anthropicKey && opt.home) {
      try {
        const res = await claudeJSON<{ name?: string; sourceUrl?: string }>(s,
          'ウェブ検索で調べた事実だけを使う。記憶から決めない。',
          `「${opt.home}」から「${area.name}」（緯度${area.center.lat.toFixed(3)}、経度${area.center.lng.toFixed(3)}付近）へ、${opt.plane ? '飛行機または新幹線・特急' : '鉄道（新幹線・特急。飛行機は使わない）'}で行くとき、一般的に降りる現地の玄関口（駅${opt.plane ? 'または空港' : ''}）を、観光協会・自治体の「アクセス」のページなどで調べ、report_gateway で報告してください。そこから先のバスやローカル線は含めず、遠くから来た人が降りる大きな駅${opt.plane ? '・空港' : ''}を1つ選びます。`,
          { maxSearches: 3, maxTokens: 3000, tool: { name: 'report_gateway', description: '玄関口を報告する', input_schema: { type: 'object', required: ['name', 'sourceUrl'], properties: { name: { type: 'string', description: '駅名または空港名（例：〇〇駅、〇〇空港）' }, sourceUrl: { type: 'string' } } } } })
        opt.onUsage?.(res.usage)
        const n = res.data.name?.trim()
        if (n && res.data.sourceUrl) pick = (await near(n, 90, n.includes('空港') ? 'airport' : 'train_station'))[0] ?? (await near(n, 90, ''))[0]
      } catch { /* 下の検索に任せる */ }
    }
    if (!pick && opt.plane && homeKm > 500) pick = (await near('空港', 90, 'airport')).find(x => x.name.includes('空港'))
    if (!pick) pick = (await near('新幹線 駅', 90, 'train_station')).find(x => x.name.endsWith('駅'))
  }
  if (!pick) pick = (await near('駅', Math.max(10, (area.radiusKm ?? 5) + 5), 'train_station')).find(x => x.name.endsWith('駅'))
  if (!pick) return null
  return { label: pick.name, coord: pick.location, source: 'google' as const, placeId: pick.id, fetchedAt: new Date().toISOString() }
}
