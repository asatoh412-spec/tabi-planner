import type { LatLng } from '../types'

/** 乗換案内へのリンク。Yahoo!の引数形式は実機で確認してから確定する（2026-11時点で未確認） */
export function transitLinks(fromName: string, toName: string, from: LatLng, to: LatLng, date: string, hhmm: string) {
  const [y, m, d] = date.split('-')
  const [hh, mm] = hhmm.split(':')
  const yahoo = new URLSearchParams({ from: fromName, to: toName, y, m, d, hh, m1: mm[0], m2: mm[1], type: '1' })
  return [
    { label: 'Yahoo!乗換案内', url: `https://transit.yahoo.co.jp/search/result?${yahoo}` },
    { label: 'Googleマップ（電車）', url: `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=transit` },
  ]
}
