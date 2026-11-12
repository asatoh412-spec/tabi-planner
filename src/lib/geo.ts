import { claudeJSON, gsiGeocode, placeDetails, placesLocate, routeBetween, type ClaudeUsage } from '../api/clients'
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

/** 家の時刻を基準にしたとき、家⇄玄関口の片道の所要時間（分）を決める。入力があればそれ、なければ車の経路で推定 */
export async function ensureHomeTravel(s: Settings, c: Conditions, onUsage?: (u: ClaudeUsage) => void): Promise<{ minutes: number; estimated: boolean } | null> {
  const needs = c.startBasis === 'home' || c.endBasis === 'home'
  if (!needs) return null
  if (c.homeTravelMin) return { minutes: c.homeTravelMin, estimated: false }
  if (c.homeTravelEst) return { minutes: c.homeTravelEst, estimated: true }
  if (!c.home || !c.origin) return null
  // 公共交通なら、ウェブ検索で標準的な所要時間を出典付きで調べる（時刻や運賃は推測させない。所要時間の目安だけ）
  if (c.mode !== 'car' && s.anthropicKey) {
    try {
      const res = await claudeJSON<{ minutes?: number; route?: string; sourceUrl?: string }>(s,
        'ウェブ検索で調べた事実だけを書く。記憶から書かない。出典URLが確認できなければ minutes を返さない。出力はJSONのみ。',
        `「${c.home}」から「${c.origin.label}」まで、公共交通（新幹線・特急・在来線・バス・飛行機など一般的な経路）で行くときの、乗り換えを含む標準的な所要時間を調べてください。{"minutes":分,"route":"主な経路を1行","sourceUrl":"出典"}`,
        { maxSearches: 3, maxTokens: 1500 })
      onUsage?.(res.usage)
      const m = res.data.minutes
      if (m && m > 0 && m < 24 * 60 && res.data.sourceUrl) {
        c.homeTravelEst = Math.round(m); c.homeTravelSource = `${res.data.route ?? ''} ${res.data.sourceUrl}`.trim()
        return { minutes: c.homeTravelEst, estimated: true }
      }
    } catch { /* 失敗したら車の経路で推定 */ }
  }
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
