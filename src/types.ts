// データ構造（設計案「データ構造」節に対応）
// Google由来の店名・営業時間・評価・レビュー・写真は保存しない。
// 保存してよいのは場所ID（無期限）と座標（取得日から30日）だけ。

export type Priority = 'must' | 'want' | 'auto' | 'exclude'
export type Mode = 'train' | 'car' | 'walk_transit'
export type Pace = 'relaxed' | 'standard' | 'packed'

export interface LatLng { lat: number; lng: number }

/** Placesから得た座標。30日で破棄する */
export interface GoogleCoord extends LatLng { fetchedAt: string }

export interface MapArea {
  id: string
  name: string
  center: LatLng
  radiusKm: number
  /** オフライン用に保存するズーム範囲 */
  minZoom: number
  maxZoom: number
  createdAt: string
  /** 地図画像を保存した日（未保存なら null） */
  tilesSavedAt: string | null
}

export interface Wish {
  id: string
  priority: Priority
  /** 場所ID（必須・できれば）またはテーマ文（おまかせ・除外） */
  placeId?: string
  theme?: string
  label: string
}

export interface Conditions {
  start: string | null // ISO 日時
  end: string | null
  mode: Mode | null
  pace: Pace | null
  areaId: string | null
  wishes: Wish[]
  food: string | null
  lodging: string | null
  budget: string | null
}

export interface Preset { id: string; name: string; conditions: Conditions; savedAt: string }

export interface OfficialInfo {
  name: string
  address?: string
  /** 住所から国土地理院の住所検索で求めた座標（地理院地図に載せてよい） */
  coord?: LatLng
  hours?: string
  closed?: string
  fee?: string
  sourceUrl?: string
  checkedAt: string
  needsCheck: boolean
}

export interface Stop {
  id: string
  placeId?: string
  googleCoord?: GoogleCoord
  arrive?: string
  depart?: string
  stayMin: number
  kind: 'sight' | 'meal' | 'lodging' | 'other'
  pinned: boolean
  official?: OfficialInfo
}

export interface Leg {
  fromStopId: string
  toStopId: string
  mode: 'walk' | 'car' | 'train'
  minutes: number
  meters?: number
  transitUrl?: string
}

export interface EventInfo { text: string; period?: string; sourceUrl: string; checkedAt: string }

export interface HotelCandidate {
  hotelNo: number
  name: string
  charge?: number
  reserveUrl: string
  fetchedAt: string
}

export interface Day {
  date: string
  stops: Stop[]
  legs: Leg[]
  lodgingArea?: string
  rainPlan?: string
  walkMeters?: number
  events: EventInfo[]
  hotels: HotelCandidate[]
}

export interface Plan {
  id: string
  angle: string
  days: Day[]
  issues: string[]
  costNote?: string
}

export interface Trip {
  id: string
  name: string
  conditions: Conditions
  plans: Plan[]
  adoptedPlanId: string | null
  createdAt: string
}

export interface Settings {
  googleKey: string
  anthropicKey: string
  rakutenAppId: string
  rakutenAccessKey: string
  claudeModel: string
}

export const emptyConditions = (): Conditions => ({
  start: null, end: null, mode: null, pace: null, areaId: null,
  wishes: [], food: null, lodging: null, budget: null,
})
