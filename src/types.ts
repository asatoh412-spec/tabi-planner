// データ構造（設計案「データ構造」節に対応）
// Google由来の店名・営業時間・評価・レビュー・写真は保存しない。
// 保存してよいのは場所ID（無期限）と座標（取得日から30日）だけ。
// 店名などはオンライン時にその場で取得してメモリ上でだけ使う（src/lib/live.ts）。

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
  minZoom: number
  maxZoom: number
  createdAt: string
  tilesSavedAt: string | null
}

export interface Wish {
  id: string
  priority: Priority
  /** 必須・できれば：場所名、おまかせ：テーマ、除外：場所名やジャンル */
  text: string
  /** 検索で確定した場所ID（任意） */
  placeId?: string
}

/** 国土地理院の住所検索で求めた地点（地理院地図に載せてよい） */
export interface Origin { label: string; coord: LatLng }

export interface Conditions {
  start: string | null // 'YYYY-MM-DDTHH:mm'
  end: string | null
  origin: Origin | null // 初日の出発地点（駅など）
  mode: Mode | null
  pace: Pace | null
  areaId: string | null
  wishes: Wish[]
  food: string | null
  lodging: string | null
  budget: string | null
  adults: number | null
  /** 作り分けの観点（空ならバランス1案） */
  angles: string[]
}

export interface Preset { id: string; name: string; conditions: Conditions; savedAt: string }

export interface OfficialInfo {
  name: string
  address?: string
  coord?: LatLng
  hours?: string
  closed?: string
  fee?: string
  highlight?: string
  sourceUrl?: string
  checkedAt: string
  needsCheck: boolean
}

export type StopKind = 'sight' | 'meal' | 'cafe' | 'shop' | 'other'

export interface Stop {
  id: string
  placeId: string
  googleCoord?: GoogleCoord
  arrive?: string // 'HH:mm'
  depart?: string
  stayMin: number
  kind: StopKind
  pinned: boolean
  official?: OfficialInfo
}

export interface Leg {
  mode: 'walk' | 'car' | 'train'
  minutes: number
  meters?: number
  /** 電車区間の所要時間は推定（乗換案内で確認） */
  estimated?: boolean
  transitLinks?: { label: string; url: string }[]
  polyline?: string
}

export interface EventInfo { title: string; period?: string; place?: string; sourceUrl: string; checkedAt: string }

/** 宿の候補。Google由来（source:'google'）は場所IDだけを保存し、名前などは表示時に取得する */
export interface HotelCandidate {
  source: 'rakuten' | 'google'
  hotelNo?: number
  placeId?: string
  /** 楽天のみ保存（Googleの宿名は保存しない） */
  name?: string
  minCharge?: number
  url?: string
  fetchedAt: string
}

export interface Day {
  date: string // 'YYYY-MM-DD'
  startTime: string
  endTime: string
  startPoint: LatLng & { label: string }
  stops: Stop[]
  /** legs[i] は stops[i-1]（i=0 は startPoint）から stops[i] への区間 */
  legs: Leg[]
  /** 最終日のみ：最後の立ち寄り先から出発地点（帰りの駅など）へ */
  returnLeg?: Leg
  lodgingArea?: string
  rainPlan?: string
  walkMeters: number
  moveMinutes: number
  slackMinutes: number
  hotels: HotelCandidate[]
  hotelsFetchedAt?: string
}

export interface Issue { dayIndex: number | null; stopId?: string; kind: 'missing_must' | 'closed' | 'over_time' | 'pace_count' | 'pace_walk' | 'other'; text: string }

export interface Plan {
  id: string
  angle: string
  days: Day[]
  issues: Issue[]
  status: 'ok' | 'conflict'
  attempts: number
  createdAt: string
  /** 必須・できれば の充足（Wish.id → 入ったか） */
  wishHits: Record<string, boolean>
}

export interface Trip {
  id: string
  name: string
  conditions: Conditions
  plans: Plan[]
  adoptedPlanId: string | null
  events: EventInfo[]
  createdAt: string
}

export interface Settings {
  googleKey: string
  anthropicKey: string
  rakutenAppId: string
  rakutenAccessKey: string
  claudeModel: string
  maxRepair: number
}

export const emptyConditions = (): Conditions => ({
  start: null, end: null, origin: null, mode: null, pace: null, areaId: null,
  wishes: [], food: null, lodging: null, budget: null, adults: null, angles: [],
})
