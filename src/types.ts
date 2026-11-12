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

/** 出発地点。国土地理院の住所検索なら保存してよい。Google（Places）由来なら placeId と取得日を持ち、座標は30日で破棄して取り直す */
export interface Origin { label: string; coord: LatLng; source?: 'gsi' | 'google'; placeId?: string; fetchedAt?: string }

export interface Conditions {
  start: string | null // 'YYYY-MM-DDTHH:mm'
  end: string | null
  /** 現地の玄関口（到着駅・空港など）。初日はここから始まり、最終日はここで終わる */
  origin: Origin | null
  /** 自宅（往復の乗換案内リンク用） */
  home: string | null
  /** 時刻の基準：初日は「玄関口に着く」か「家を出る」か、最終日は「玄関口を出る」か「家に着く」か */
  startBasis?: 'gateway' | 'home'
  endBasis?: 'gateway' | 'home'
  /** 家⇄玄関口の片道の所要時間（分。乗換案内で調べた値）。空なら車の所要時間で推定 */
  homeTravelMin?: number | null
  /** 推定した片道の所要時間（分）。homeTravelMin が空のときに使う */
  homeTravelEst?: number | null
  /** 推定の根拠（ウェブ検索の出典URL、または「車の経路」） */
  homeTravelSource?: string | null
  mode: Mode | null
  pace: Pace | null
  /** 旧形式（1か所）。読み込み時に areaIds へ移す */
  areaId?: string | null
  areaIds: string[]
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

export type StopKind = 'sight' | 'meal' | 'cafe' | 'shop' | 'other' | 'lodging'

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
  /** 時刻が推定（公共交通の推定区間のあと）か */
  approx?: boolean
  /** 乗換案内で調べた、この地点へ向かう公共交通の発車・到着時刻（使用者が入力） */
  transitIn?: { depart?: string; arrive: string }
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
  /** Google由来の座標なら fetchedAt を持つ（30日で破棄） */
  startPoint: LatLng & { label: string; fetchedAt?: string }
  stops: Stop[]
  /** legs[i] は stops[i-1]（i=0 は startPoint）から stops[i] への区間 */
  legs: Leg[]
  /** 最終日のみ：最後の立ち寄り先から玄関口（帰りの駅など）へ */
  returnLeg?: Leg
  /** 最終日以外：その日に泊まる宿と、そこへの区間 */
  lodging?: Stop
  lodgingLeg?: Leg
  /** 帰りの玄関口に着く時刻が推定か */
  returnApprox?: boolean
  /** 初日の玄関口着・最終日の玄関口発が、家の時刻からの推定か */
  startApprox?: boolean
  endApprox?: boolean
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
  /** いつもの条件（新しい旅行の初期値） */
  home?: string
  homeTravelBasis?: boolean
  defaultMode?: Mode | null
  defaultPace?: Pace | null
  defaultAdults?: number | null
}

export const emptyConditions = (): Conditions => ({
  start: null, end: null, origin: null, home: null, mode: null, pace: null, areaIds: [],
  wishes: [], food: null, lodging: null, budget: null, adults: null, angles: [],
})

/** 旧形式の条件を今の形に直す */
export function normalizeConditions(c: Conditions): Conditions {
  const areaIds = c.areaIds ?? (c.areaId ? [c.areaId] : [])
  return { ...emptyConditions(), ...c, areaIds, home: c.home ?? null }
}
