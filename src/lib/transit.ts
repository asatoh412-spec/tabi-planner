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

/** 予約サイトの検索結果へのリンク。引数形式は実機で未確認（2026-11-12時点：URLが応答することだけ確認） */
export function bookingLinks(keyword: string, checkin: string, checkout: string, adults: number) {
  const [y1, m1, d1] = checkin.split('-').map(Number)
  const [y2, m2, d2] = checkout.split('-').map(Number)
  const nights = Math.max(1, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5))
  const k = encodeURIComponent(keyword)
  return [
    { label: '楽天トラベル', url: `https://kw.travel.rakuten.co.jp/keyword/Search.do?f_keyword=${k}&f_nen1=${y1}&f_tuki1=${m1}&f_hi1=${d1}&f_nen2=${y2}&f_tuki2=${m2}&f_hi2=${d2}&f_otona_su=${adults}` },
    { label: 'じゃらん', url: `https://www.jalan.net/uw/uwp2011/uww2011init.do?keyword=${k}&stayYear=${y1}&stayMonth=${m1}&stayDay=${d1}&stayCount=${nights}&adultNum=${adults}` },
    { label: '一休', url: `https://www.ikyu.com/search?keyword=${k}&cid=${checkin.replace(/-/g, '')}&cod=${checkout.replace(/-/g, '')}&ppc=${adults}` },
    { label: 'Googleホテル', url: `https://www.google.com/travel/hotels?q=${k}` },
  ]
}
