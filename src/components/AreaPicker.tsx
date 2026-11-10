import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { deleteArea, listAreas, newId, saveArea } from '../db'
import { gsiGeocode } from '../api/clients'
import type { MapArea } from '../types'
import { GSI_ATTR, GSI_URL, tileUrls } from '../lib/tiles'


export default function AreaPicker() {
  const mapDiv = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const circle = useRef<L.Circle | null>(null)
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [radius, setRadius] = useState(2.5)
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [areas, setAreas] = useState<MapArea[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => { listAreas().then(setAreas) }, [])

  useEffect(() => {
    if (!mapDiv.current || map.current) return
    const m = L.map(mapDiv.current, { zoomControl: true }).setView([35.681, 139.767], 6)
    L.tileLayer(GSI_URL, { attribution: GSI_ATTR, maxZoom: 18, minZoom: 5 }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => setCenter({ lat: e.latlng.lat, lng: e.latlng.lng }))
    map.current = m
    return () => { m.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    circle.current?.remove()
    if (center) circle.current = L.circle([center.lat, center.lng], { radius: radius * 1000, color: '#2f5d50', weight: 2, fillOpacity: 0.08 }).addTo(m)
  }, [center, radius])

  async function search() {
    setMsg('')
    try {
      const r = await gsiGeocode(q)
      if (!r.length) { setMsg('見つかりませんでした'); return }
      const c = r[0].coord
      setCenter(c); if (!name) setName(q)
      map.current?.setView([c.lat, c.lng], 13)
    } catch (e) { setMsg((e as Error).message) }
  }

  async function save() {
    if (!center) return
    const a: MapArea = { id: newId(), name: name || '無題の範囲', center, radiusKm: radius, minZoom: 14, maxZoom: 17, createdAt: new Date().toISOString(), tilesSavedAt: null }
    await saveArea(a); setAreas(await listAreas()); setMsg(`「${a.name}」を保存しました`)
  }

  const est = center ? tileUrls({ id: '', name: '', center, radiusKm: radius, minZoom: 14, maxZoom: 17, createdAt: '', tilesSavedAt: null }).length : 0

  return (
    <section className="page">
      <h1>範囲の指定</h1>
      <div className="row">
        <input placeholder="地名・住所で探す（例：弘前市）" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
        <button onClick={search}>探す</button>
      </div>
      <div ref={mapDiv} className="map" />
      <p className="note">地図をタップして中心を決め、半径を調整します。</p>
      <label>半径 {radius.toFixed(1)} km
        <input type="range" min={0.5} max={15} step={0.5} value={radius} onChange={e => setRadius(Number(e.target.value))} />
      </label>
      <label>名前<input value={name} onChange={e => setName(e.target.value)} placeholder="例：弘前" /></label>
      {center && <p className="note">オフライン保存する場合の地図画像：ズーム14〜17で約{est.toLocaleString()}枚（約{Math.round(est * 20 / 1024)}MB の概算）</p>}
      <div className="row">
        <button className="primary" disabled={!center} onClick={save}>この範囲を保存</button>
        {msg && <span className="note">{msg}</span>}
      </div>
      {areas.length > 0 && <>
        <h2>保存した範囲</h2>
        <ul className="list">
          {areas.map(a => (
            <li key={a.id}>
              <button className="link" onClick={() => { setCenter(a.center); setRadius(a.radiusKm); setName(a.name); map.current?.setView([a.center.lat, a.center.lng], 12) }}>{a.name}</button>
              <span className="note">半径{a.radiusKm}km</span>
              <button className="ghost" onClick={async () => { await deleteArea(a.id); setAreas(await listAreas()) }}>削除</button>
            </li>
          ))}
        </ul>
      </>}
    </section>
  )
}
