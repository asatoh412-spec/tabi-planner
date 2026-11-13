import type { StopKind } from '../types'

// 種類ごとの小さなアイコン（線画）。色は文字色に合わせる
const PATHS: Record<StopKind | 'walk' | 'car' | 'train' | 'home' | 'gate', string> = {
  sight: 'M3 20h18M5 20V10m4 10V10m6 10V10m4 10V10M2 10l10-6 10 6z',
  meal: 'M4 3v8a3 3 0 0 0 6 0V3M7 3v18M17 3c-2 0-3 3-3 6s1 4 3 4v8',
  cafe: 'M4 8h13v5a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6zM17 10h2a2 2 0 0 1 0 4h-2M8 2v3m4-3v3',
  shop: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  other: 'M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  lodging: 'M3 18V7m0 6h18v5M3 13h18m-7-4h5a2 2 0 0 1 2 2v2M7 11a2 2 0 1 0 0-.1',
  walk: 'M13 4a2 2 0 1 0 0-.1M9 21l2-6 3 3v5M8 12l3-4 4 2 2 4M11 8l-1 6',
  car: 'M4 16v-4l2-5h12l2 5v4zM4 16v3h3v-3m10 0v3h3v-3M7 13h1m8 0h1',
  train: 'M6 4h12v11a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3zM6 10h12M9 21l1-3m5 3-1-3M9 14h.01M15 14h.01',
  home: 'M3 11l9-7 9 7M5 9v11h14V9M10 20v-6h4v6',
  gate: 'M4 21V8l8-5 8 5v13M4 21h16M9 21v-7h6v7',
}

export default function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
}
