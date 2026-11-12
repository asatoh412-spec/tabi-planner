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

// ---- 段階1以降で使う呼び出し ----

/** プラン作成時の候補。Google由来なので保存しない（メモリ上だけで使う） */
export interface Candidate {
  id: string
  name: string
  location: LatLng
  address?: string
  type?: string
  typeLabel?: string
  rating?: number
  ratingCount?: number
  priceLevel?: string
  periods?: OpenPeriod[]
  weekdayText?: string[]
  mapsUri?: string
}
export interface OpenPeriod { open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } }

const CANDIDATE_MASK = [
  'places.id', 'places.displayName', 'places.location', 'places.formattedAddress', 'places.primaryType',
  'places.primaryTypeDisplayName', 'places.rating', 'places.userRatingCount', 'places.priceLevel',
  'places.regularOpeningHours', 'places.googleMapsUri',
].join(',')

interface RawPlace {
  id: string; displayName?: { text: string }; location?: { latitude: number; longitude: number }
  formattedAddress?: string; primaryType?: string; primaryTypeDisplayName?: { text: string }
  rating?: number; userRatingCount?: number; priceLevel?: string
  regularOpeningHours?: { periods?: OpenPeriod[]; weekdayDescriptions?: string[] }; googleMapsUri?: string
}
const toCandidate = (p: RawPlace): Candidate => ({
  id: p.id, name: p.displayName?.text ?? '(名称不明)',
  location: { lat: p.location?.latitude ?? 0, lng: p.location?.longitude ?? 0 },
  address: p.formattedAddress, type: p.primaryType, typeLabel: p.primaryTypeDisplayName?.text,
  rating: p.rating, ratingCount: p.userRatingCount, priceLevel: p.priceLevel,
  periods: p.regularOpeningHours?.periods, weekdayText: p.regularOpeningHours?.weekdayDescriptions, mapsUri: p.googleMapsUri,
})

/** 営業時間・評価を含む検索（Enterprise料金：月1,000件まで無料） */
export async function placesCandidates(s: Settings, query: string, center: LatLng, radiusM: number, max = 10, includedType?: string): Promise<Candidate[]> {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': s.googleKey, 'X-Goog-FieldMask': CANDIDATE_MASK },
    body: JSON.stringify({
      textQuery: query, languageCode: 'ja', regionCode: 'JP', pageSize: max,
      ...(includedType ? { includedType, strictTypeFiltering: true } : {}),
      locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(50000, radiusM) } },
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Places HTTP ${r.status}: ${j?.error?.message ?? ''}`)
  return ((j.places ?? []) as RawPlace[]).map(toCandidate)
}

/** 駅名・施設名で地点を探す（出発地点用。Pro料金：月5,000件まで無料） */
export async function placesLocate(s: Settings, query: string, center: LatLng, radiusM: number) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': s.googleKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress' },
    body: JSON.stringify({ textQuery: query, languageCode: 'ja', regionCode: 'JP', pageSize: 5, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(50000, radiusM) } } }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Places HTTP ${r.status}: ${j?.error?.message ?? ''}`)
  return ((j.places ?? []) as RawPlace[]).map(toCandidate)
}

/** 1か所の詳細（表示用。保存しない） */
export async function placeDetails(s: Settings, placeId: string, mask = 'id,displayName,location,formattedAddress,regularOpeningHours,rating,userRatingCount,googleMapsUri,primaryTypeDisplayName,priceLevel'): Promise<Candidate> {
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=ja`, {
    headers: { 'X-Goog-Api-Key': s.googleKey, 'X-Goog-FieldMask': mask },
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Places HTTP ${r.status}: ${j?.error?.message ?? ''}`)
  return toCandidate(j as RawPlace)
}

export interface RouteResult { minutes: number; meters: number; polyline?: string }

export async function routeBetween(s: Settings, a: LatLng, b: LatLng, mode: 'WALK' | 'DRIVE'): Promise<RouteResult | null> {
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': s.googleKey, 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      travelMode: mode, languageCode: 'ja',
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Routes HTTP ${r.status}: ${j?.error?.message ?? ''}`)
  const x = j.routes?.[0]
  if (!x) return null
  return { minutes: Math.round(parseInt(x.duration) / 60), meters: x.distanceMeters ?? 0, polyline: x.polyline?.encodedPolyline }
}

export interface ClaudeUsage { input: number; output: number; searches: number }

/** JSONだけを返させる。web検索を使う場合は maxSearches > 0 */
export async function claudeJSON<T>(s: Settings, system: string, user: string, opts: { maxTokens?: number; maxSearches?: number } = {}): Promise<{ data: T; usage: ClaudeUsage; sources: string[] }> {
  const body: Record<string, unknown> = {
    model: s.claudeModel, max_tokens: opts.maxTokens ?? 8000, system,
    messages: [{ role: 'user', content: user }],
  }
  if (opts.maxSearches) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxSearches, user_location: { type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' } }]
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': s.anthropicKey, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`Claude HTTP ${r.status}: ${j?.error?.message ?? ''}`)
  const blocks = (j.content ?? []) as { type: string; text?: string; content?: { url?: string }[] }[]
  const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
  const sources = blocks.filter(b => b.type === 'web_search_tool_result').flatMap(b => (Array.isArray(b.content) ? b.content : []).map(c => c.url ?? '')).filter(Boolean)
  const usage: ClaudeUsage = { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0, searches: j.usage?.server_tool_use?.web_search_requests ?? 0 }
  return { data: extractJSON<T>(text), usage, sources }
}

export function extractJSON<T>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const src = fence ? fence[1] : text
  const i = Math.min(...['{', '['].map(c => { const k = src.indexOf(c); return k < 0 ? Infinity : k }))
  const close = src[i] === '[' ? ']' : '}'
  const k = src.lastIndexOf(close)
  if (!isFinite(i) || k < i) throw new Error('Claudeの返答からJSONを読み取れませんでした')
  return JSON.parse(src.slice(i, k + 1)) as T
}
