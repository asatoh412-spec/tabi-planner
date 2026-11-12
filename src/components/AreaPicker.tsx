/// <reference types="google.maps" />
import { useEffect, useRef, useState } from 'react'
import { deleteArea, getSettings, listAreas, newId, saveArea } from '../db'
import { gsiGeocode, placesLocate } from '../api/clients'
import type { LatLng, MapArea } from '../types'
import { loadGoogleMaps } from './Maps'

/** 範囲の指定（Google地図）。地図をタップして中心を決め、半径を調整する */
export default function AreaPicker() {
  const div = useRef<HTMLDivElement>(null)
  const map = useRef<google.maps.Map | null>(null)
  const circle = useRef<google.maps.Circle | null>(null)
  const others = useRef<google.maps.Circle[]>([])
  const [center, setCenter] = useState<LatLng | null>(null)
  const [radius, setRadius] = useState(5)
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [areas, setAreas] = useState<MapArea[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => { listAreas().then(setAreas) }, [])

  useEffect(() => {
    let off = false
    ;(async () => {
      const s = await getSettings()
      if (!s.googleKey) { setMsg('GoogleのAPIキーを設定タブで入れてください'); return }
      try { await loadGoogleMaps(s.googleKey) } catch (e) { setMsg((e as Error).message); return }
      if (off || !div.current) return
      const m = new google.maps.Map(div.current, { center: { lat: 37.5, lng: 138.5 }, zoom: 5, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false })
      m.addListener('click', (e: google.maps.MapMouseEvent) => { if (e.latLng) setCenter({ lat: e.latLng.lat(), lng: e.latLng.lng() }) })
      map.current = m
      drawSaved()
    })()
    return () => { off = true }
  }, [])

  function drawSaved(list = areas) {
    const m = map.current
    if (!m) return
    others.current.forEach(c => c.setMap(null))
    others.current = list.map(a => new google.maps.Circle({ map: m, center: a.center, radius: a.radiusKm * 1000, strokeColor: '#888', strokeWeight: 1, fillOpacity: 0.05, clickable: false }))
  }
  useEffect(() => { drawSaved() }, [areas])

  useEffect(() => {
    const m = map.current
    if (!m) return
    circle.current?.setMap(null)
    if (center) circle.current = new google.maps.Circle({ map: m, center, radius: radius * 1000, strokeColor: '#2f5d50', strokeWeight: 2, fillColor: '#2f5d50', fillOpacity: 0.08, clickable: false })
  }, [center, radius])

  async function search() {
    setMsg('')
    try {
      const s = await getSettings()
      let c: LatLng | undefined
      if (s.googleKey) c = (await placesLocate(s, q, { lat: 37.5, lng: 138.5 }, 50000))[0]?.location
      if (!c) c = (await gsiGeocode(q))[0]?.coord
      if (!c) { setMsg('見つかりませんでした'); return }
      setCenter(c); if (!name) setName(q)
      map.current?.setCenter(c); map.current?.setZoom(radius > 15 ? 9 : 11)
    } catch (e) { setMsg((e as Error).message) }
  }

  async function save() {
    if (!center) return
    const a: MapArea = { id: newId(), name: name || '無題の範囲', center, radiusKm: radius, minZoom: 0, maxZoom: 0, createdAt: new Date().toISOString(), tilesSavedAt: null }
    await saveArea(a); const list = await listAreas(); setAreas(list); setMsg(`「${a.name}」を保存しました`); setCenter(null); setName(''); setQ('')
  }

  return (
    <section className="page">
      <h1>範囲の指定</h1>
      <p className="note">回りたい場所ごとに範囲を作ります（例：角館、田沢湖、乳頭温泉）。旅行の条件で複数選べます。</p>
      <div className="row">
        <input placeholder="地名・駅名で探す（例：角館駅）" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
        <button onClick={search}>探す</button>
      </div>
      <div ref={div} className="map" />
      <label>半径 {radius} km
        <input type="range" min={1} max={50} step={1} value={radius} onChange={e => setRadius(Number(e.target.value))} />
      </label>
      <label>名前<input value={name} onChange={e => setName(e.target.value)} placeholder="例：角館" /></label>
      <div className="row">
        <button className="primary" disabled={!center} onClick={save}>この範囲を保存</button>
        {msg && <span className="note">{msg}</span>}
      </div>
      {areas.length > 0 && <>
        <h2>保存した範囲</h2>
        <ul className="list">
          {areas.map(a => (
            <li key={a.id}>
              <button className="link" onClick={() => { setCenter(a.center); setRadius(a.radiusKm); setName(a.name); map.current?.setCenter(a.center); map.current?.setZoom(a.radiusKm > 15 ? 9 : 11) }}>{a.name}</button>
              <span className="note">半径{a.radiusKm}km</span>
              <button className="ghost" onClick={async () => { await deleteArea(a.id); setAreas(await listAreas()) }}>削除</button>
            </li>
          ))}
        </ul>
      </>}
    </section>
  )
}
