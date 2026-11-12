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

/** 家の時刻を基準にしたとき、家⇄玄関口の片道の所要時間（分）を決める。入力があればそれ。なければ、公共交通ならウェブ検索の目安、車を選んだときだけ車の経路 */
export async function ensureHomeTravel(s: Settings, c: Conditions, onUsage?: (u: ClaudeUsage) => void): Promise<{ minutes: number; estimated: boolean } | null> {
  const needs = c.startBasis === 'home' || c.endBasis === 'home'
  if (!needs) return null
  if (c.homeTravelMin) return { minutes: c.homeTravelMin, estimated: false }
  // 以前の版が車の経路で代用した値は、公共交通を選んでいるなら使わずに調べ直す
  if (c.homeTravelEst && (c.mode === 'car' || !String(c.homeTravelSource ?? '').startsWith('車の経路'))) return { minutes: c.homeTravelEst, estimated: true }
  if (!c.home || !c.origin) return null
  // 公共交通なら、ウェブ検索で標準的な所要時間を出典付きで調べる（時刻や運賃は推測させない。所要時間の目安だけ）
  if (c.mode !== 'car' && s.anthropicKey) {
    try {
      const res = await claudeJSON<{ minutes?: number | string; route?: string; sourceUrl?: string }>(s,
        'ウェブ検索で調べた事実だけを書く。記憶から書かない。出典URLが確認できなければ minutes を返さない。',
        `「${c.home}」から「${c.origin.label}」まで、公共交通（新幹線・特急・在来線・バス・飛行機など一般的な経路）で行くときの、乗り換えを含む標準的な所要時間を調べ、report_travel_time で報告してください。`,
        { maxSearches: 3, maxTokens: 3000, tool: { name: 'report_travel_time', description: '調べた所要時間を報告する', input_schema: { type: 'object', required: ['minutes', 'sourceUrl'], properties: { minutes: { type: 'integer', description: '乗り換え込みの片道の所要時間（分）' }, route: { type: 'string', description: '主な経路を1行で' }, sourceUrl: { type: 'string' } } } } })
      onUsage?.(res.usage)
      const m = toMinutes(res.data.minutes)
      if (m && m > 0 && m < 24 * 60 && res.data.sourceUrl) {
        c.homeTravelEst = Math.round(m); c.homeTravelSource = `${res.data.route ?? ''} ${res.data.sourceUrl}`.trim()
        return { minutes: c.homeTravelEst, estimated: true }
      }
    } catch { /* 見つからなければ下で「不明」にする */ }
  }
  // 公共交通を選んでいるのに車の経路で代用はしない（使用者の指摘 2026-11-12）。分からなければ「不明」として、所要時間の入力を促す
  if (c.mode !== 'car') { c.homeTravelSource = '不明'; return null }
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
