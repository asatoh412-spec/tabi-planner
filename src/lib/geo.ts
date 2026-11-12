import { placeDetails } from '../api/clients'
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
