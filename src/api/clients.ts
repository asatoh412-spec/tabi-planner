import type { LatLng, Settings } from '../types'

// すべてブラウザから直接呼ぶ（2026-11-09 にCORSプリフライトが通ることを確認済み）

export async function gsiGeocode(address: string): Promise<{ title: string; coord: LatLng }[]> {
  const r = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(address)}`)
  if (!r.ok) throw new Error(`国土地理院 住所検索 HTTP ${r.status}`)
  const j = (await r.json()) as { geometry: { coordinates: [number, number] }; properties: { title: string } }[]
  return j.map(f => ({ title: f.properties.title, coord: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] } }))
}

/** Places Text Search。fieldMask で料金区分が決まる（places.id のみなら無料枠無制限） */
export async function placesTextSearch(s: Settings, query: string, center: LatLng, radiusM: number, fieldMask = 'places.id') {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': s.googleKey, 'X-Goog-FieldMask': fieldMask },
    body: JSON.stringify({
      textQuery: query, languageCode: 'ja', regionCode: 'JP',
      locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: radiusM } },
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Places HTTP ${r.status}: ${j?.error?.message ?? ''}`)
  return j as { places?: unknown[] }
}

export async function routesCompute(s: Settings, a: LatLng, b: LatLng, mode: 'WALK' | 'DRIVE' | 'TRANSIT') {
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': s.googleKey, 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      travelMode: mode, languageCode: 'ja',
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Routes HTTP ${r.status}: ${j?.error?.message ?? ''}`)
  return j as { routes?: { duration: string; distanceMeters: number }[] }
}

export async function claudeMessage(s: Settings, prompt: string, maxTokens = 64) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': s.anthropicKey, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: s.claudeModel, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Claude HTTP ${r.status}: ${j?.error?.message ?? ''}`)
  return j as { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } }
}

export interface RakutenHotel { hotelNo: number; hotelName: string; hotelMinCharge?: number; planListUrl?: string; hotelInformationUrl?: string }

export async function rakutenVacant(s: Settings, c: LatLng, radiusKm: number, checkin: string, checkout: string, adults = 1) {
  const p = new URLSearchParams({
    applicationId: s.rakutenAppId, accessKey: s.rakutenAccessKey, format: 'json', formatVersion: '2',
    datumType: '1', latitude: String(c.lat), longitude: String(c.lng), searchRadius: String(Math.min(3, Math.max(0.1, radiusKm))),
    checkinDate: checkin, checkoutDate: checkout, adultNum: String(adults), hits: '30',
  })
  const r = await fetch(`https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426?${p}`)
  const j = await r.json()
  if (r.status === 404) return { hotels: [] as RakutenHotel[], raw: j }
  if (!r.ok) throw new Error(`楽天 HTTP ${r.status}: ${j?.error_description ?? j?.error ?? ''}`)
  const hotels: RakutenHotel[] = (j.hotels ?? []).map((h: unknown[]) => (h as { hotelBasicInfo?: RakutenHotel }[])[0]?.hotelBasicInfo).filter(Boolean)
  return { hotels, raw: j }
}
