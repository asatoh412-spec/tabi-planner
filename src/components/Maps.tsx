/// <reference types="google.maps" />
import { useEffect, useRef, useState } from 'react'
import { getSettings } from '../db'
import { decodePolyline } from '../lib/polyline'
import { validCoord } from '../lib/geo'
import { coordOf, nameOf } from '../lib/schedule'
import type { Day, LatLng } from '../types'

export const PLAN_COLORS = ['#2f6fb0', '#c2562d', '#3b8a4e', '#8a4fa3']

let gmapsPromise: Promise<void> | null = null
/** キーの拒否（制限やAPI未許可）を受け取ったときの理由。Google は gm_authFailure を呼ぶ */
export let mapsAuthError = ''
export function loadGoogleMaps(key: string) {
  if (gmapsPromise) return gmapsPromise
  gmapsPromise = new Promise((resolve, reject) => {
    const cb = '__gmapsReady'
    const w = window as unknown as Record<string, unknown>
    w.gm_authFailure = () => { mapsAuthError = 'Google地図の読み込みがキーの設定で拒否されました。Google Cloud の「認証情報」で、このキーの「APIの制限」に Maps JavaScript API が入っているか、「ウェブサイトの制限」に https://tabi-planner.pages.dev/* が入っているかを確認してください。'; window.dispatchEvent(new Event('gmaps-auth-failure')) }
    // loading=async では、コールバックの時点で地図の部品が揃っているとは限らないので、使う部品を明示して読み込む
    w[cb] = () => { Promise.all([google.maps.importLibrary('maps'), google.maps.importLibrary('marker')]).then(() => resolve(), e => { gmapsPromise = null; reject(e) }) }
    const sc = document.createElement('script')
    sc.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=ja&region=JP&v=weekly&loading=async&callback=${cb}`
    sc.async = true
    sc.onerror = () => { gmapsPromise = null; reject(new Error('Google地図を読み込めませんでした')) }
    document.head.appendChild(sc)
  })
  return gmapsPromise
}

export interface MapRoute { color: string; days: Day[] }

/** オンライン時：Google地図。Placesの情報（座標・名前）はGoogle地図にだけ載せる */
export function GoogleRouteMap({ routes, height = 320 }: { routes: MapRoute[]; height?: number }) {
  const div = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let cancelled = false
    const overlays: { setMap(m: google.maps.Map | null): void }[] = []
    ;(async () => {
      if (!navigator.onLine) { setErr('オフラインのためGoogle地図は表示できません（「旅行中」タブで国土地理院の地図を使えます）'); return }
      const s = await getSettings()
      if (!s.googleKey) { setErr('GoogleのAPIキーが未設定です'); return }
      try { await loadGoogleMaps(s.googleKey) } catch (e) { setErr((e as Error).message); return }
      if (cancelled || !div.current) return
      const map = new google.maps.Map(div.current, { mapTypeControl: false, streetViewControl: false, fullscreenControl: false })
      const bounds = new google.maps.LatLngBounds()
      for (const r of routes) {
        r.days.forEach(d => {
          const path: google.maps.LatLngLiteral[] = []
          const push = (p: LatLng) => { path.push({ lat: p.lat, lng: p.lng }); bounds.extend(p) }
          if (validCoord(d.startPoint)) push(d.startPoint)
          d.stops.forEach((st, i) => {
            const leg = d.legs[i]
            if (leg?.polyline) decodePolyline(leg.polyline).forEach(([lat, lng]) => push({ lat, lng }))
            const c = coordOf(st)
            if (!c) return
            push(c)
            overlays.push(new google.maps.Marker({ map, position: c, title: nameOf(st), label: { text: String(i + 1), color: '#fff', fontSize: '12px' }, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: r.color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 } }))
          })
          overlays.push(new google.maps.Polyline({ map, path, strokeColor: r.color, strokeOpacity: 0.85, strokeWeight: 4 }))
        })
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, 32)
    })()
    return () => { cancelled = true; overlays.forEach(o => o.setMap(null)) }
  }, [routes])
  useEffect(() => { const f = () => setErr(mapsAuthError); addEventListener('gmaps-auth-failure', f); if (mapsAuthError) f(); return () => removeEventListener('gmaps-auth-failure', f) }, [])
  return err ? <p className="note map-err">{err}</p> : <div ref={div} className="map" style={{ height }} />
}
