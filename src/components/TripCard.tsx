/// <reference types="google.maps" />
import { useEffect, useRef } from 'react'
import { getSettings } from '../db'
import { fmtDate } from '../lib/time'
import type { MapArea, Trip } from '../types'
import { loadGoogleMaps } from './Maps'

/** 旅行一覧のカード：日付・行き先・小さな地図（操作できない地図に行き先の円だけ描く） */
export default function TripCard({ trip, areas, onOpen, onDelete }: { trip: Trip; areas: MapArea[]; onOpen: () => void; onDelete: () => void }) {
  const div = useRef<HTMLDivElement>(null)
  const p = trip.plans.find(x => x.id === trip.adoptedPlanId) ?? trip.plans[0]
  const mine = areas.filter(a => trip.conditions.areaIds?.includes(a.id) || trip.conditions.areaId === a.id)
  const nights = p ? p.days.length - 1 : 0

  useEffect(() => {
    let off = false
    ;(async () => {
      const s = await getSettings()
      if (!s.googleKey || !mine.length) return
      try { await loadGoogleMaps(s.googleKey) } catch { return }
      if (off || !div.current) return
      const m = new google.maps.Map(div.current, { disableDefaultUI: true, gestureHandling: 'none', keyboardShortcuts: false, clickableIcons: false, center: mine[0].center, zoom: 8 })
      const b = new google.maps.LatLngBounds()
      mine.forEach(a => { const c = new google.maps.Circle({ map: m, center: a.center, radius: a.radiusKm * 1000, strokeColor: '#2f5d50', strokeWeight: 2, fillColor: '#2f5d50', fillOpacity: 0.2, clickable: false }); const cb = c.getBounds(); if (cb) b.union(cb) })
      m.fitBounds(b, 8)
    })()
    return () => { off = true }
  }, [trip.id, mine.length])

  return <li className="trip-card" onClick={onOpen}>
    <div ref={div} className="trip-map">{!mine.length && <span className="note">地図なし</span>}</div>
    <div className="trip-info">
      <b className="trip-name">{trip.name}</b>
      <span className="trip-dates">{p ? `${fmtDate(p.days[0].date)}〜${fmtDate(p.days.at(-1)!.date)}・${nights ? `${nights}泊${nights + 1}日` : '日帰り'}` : '案なし'}</span>
      <span className="note">{mine.map(a => a.name).join('・')}</span>
      <span className="trip-badges">{trip.adoptedPlanId && <span className="badge">採用済み</span>}<span className="note">{trip.plans.length}案</span>{p?.status === 'conflict' && <span className="badge warn">要対応</span>}</span>
    </div>
    <button className="ghost del" onClick={e => { e.stopPropagation(); onDelete() }} aria-label="削除">削除</button>
  </li>
}
