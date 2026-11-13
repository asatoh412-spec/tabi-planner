/// <reference types="google.maps" />
import { useEffect, useRef, useState } from 'react'
import { getSettings, listAreas, newId, saveArea } from '../db'
import { gsiGeocode, placesLocate } from '../api/clients'
import type { LatLng, MapArea } from '../types'
import { loadGoogleMaps, mapsAuthError } from './Maps'

const RADII = [2, 5, 10, 20, 30]

/** 地点の名前を国土地理院の逆ジオコーダーで付ける（町名など）。失敗したら「選んだ地点」 */
async function nameOf(p: LatLng): Promise<string> {
  try {
    const r = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${p.lat}&lon=${p.lng}`)
    const j = await r.json()
    return (j?.results?.lv01Nm as string) || '選んだ地点'
  } catch { return '選んだ地点' }
}

/** 行き先を地図で選ぶ。タップか地名の入力で追加し、半径は自動（5km）。範囲は保存しておき、次回も使える */
export default function DestinationPicker({ areaIds, onChange }: { areaIds: string[]; onChange: (ids: string[]) => void }) {
  const div = useRef<HTMLDivElement>(null)
  const map = useRef<google.maps.Map | null>(null)
  const circles = useRef<google.maps.Circle[]>([])
  const [all, setAll] = useState<MapArea[]>([])
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [noKey, setNoKey] = useState(false)
  const idsRef = useRef(areaIds)
  idsRef.current = areaIds

  useEffect(() => { listAreas().then(setAll) }, [])
  useEffect(() => { const f = () => setMsg(mapsAuthError); addEventListener('gmaps-auth-failure', f); if (mapsAuthError) f(); return () => removeEventListener('gmaps-auth-failure', f) }, [])

  async function add(center: LatLng, name: string, radiusKm = 5) {
    const a: MapArea = { id: newId(), name, center, radiusKm, minZoom: 0, maxZoom: 0, createdAt: new Date().toISOString(), tilesSavedAt: null }
    await saveArea(a)
    setAll(await listAreas())
    onChange([...idsRef.current, a.id])
  }

  useEffect(() => {
    let off = false
    ;(async () => {
      const s = await getSettings()
      if (!s.googleKey) { setNoKey(true); return }
      try { await loadGoogleMaps(s.googleKey) } catch (e) { setMsg((e as Error).message); return }
      if (off || !div.current) return
      const m = new google.maps.Map(div.current, { center: { lat: 37.8, lng: 138.8 }, zoom: 5, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy' })
      m.addListener('click', async (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return
        const p = { lat: e.latLng.lat(), lng: e.latLng.lng() }
        await add(p, await nameOf(p))
      })
      map.current = m
    })()
    return () => { off = true }
  }, [])

  const chosen = areaIds.map(id => all.find(a => a.id === id)).filter((a): a is MapArea => !!a)

  // 選んだ範囲を地図に円で描き、全部が見えるように寄せる
  useEffect(() => {
    const m = map.current
    if (!m || !window.google) return
    circles.current.forEach(c => c.setMap(null))
    circles.current = chosen.map(a => new google.maps.Circle({ map: m, center: a.center, radius: a.radiusKm * 1000, strokeColor: '#2f5d50', strokeWeight: 2, fillColor: '#2f5d50', fillOpacity: 0.1, clickable: false }))
    if (chosen.length) {
      const b = new google.maps.LatLngBounds()
      circles.current.forEach(c => { const cb = c.getBounds(); if (cb) b.union(cb) })
      m.fitBounds(b, 24)
    }
  }, [chosen.map(a => `${a.id}:${a.radiusKm}`).join(','), map.current])

  async function search() {
    setMsg('')
    const text = q.trim()
    if (!text) return
    try {
      const s = await getSettings()
      let p: LatLng | undefined
      if (s.googleKey) p = (await placesLocate(s, text, { lat: 37.8, lng: 138.8 }, 50000))[0]?.location
      if (!p) p = (await gsiGeocode(text))[0]?.coord
      if (!p) { setMsg('見つかりませんでした'); return }
      await add(p, text)
      setQ('')
    } catch (e) { setMsg((e as Error).message) }
  }

  async function setRadius(a: MapArea, r: number) { await saveArea({ ...a, radiusKm: r }); setAll(await listAreas()) }
  async function rename(a: MapArea) { const n = prompt('行き先の名前（候補を探すときの地名に使います）', a.name); if (n) { await saveArea({ ...a, name: n }); setAll(await listAreas()) } }

  const recent = all.filter(a => !areaIds.includes(a.id)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 6)

  return <div>
    <div className="row">
      <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="地名で追加（例：角館、乳頭温泉）" />
      <button onClick={search}>追加</button>
    </div>
    {noKey
      ? <p className="note map-err">この端末にはGoogleのAPIキーが入っていないので地図を出せません（設定タブ）。地名の入力では追加できます。</p>
      : <div ref={div} className="map" style={{ height: 300 }} />}
    {!noKey && <p className="note">地図をタップすると、その場所を行き先に追加します（半径5km）。</p>}
    {msg && <p className="note">{msg}</p>}
    {chosen.length > 0 && <ul className="list">
      {chosen.map(a => <li key={a.id} className="dest">
        <button className="link" onClick={() => rename(a)}>{a.name}</button>
        <span className="radius">{RADII.map(r => <button key={r} className={`chipbtn small ${a.radiusKm === r ? 'on' : ''}`} onClick={() => setRadius(a, r)}>{r}km</button>)}</span>
        <button className="ghost" onClick={() => onChange(areaIds.filter(x => x !== a.id))}>外す</button>
      </li>)}
    </ul>}
    {recent.length > 0 && <p className="note">前に使った行き先：{recent.map(a => <button key={a.id} className="link small" onClick={() => onChange([...areaIds, a.id])}>{a.name}</button>)}</p>}
  </div>
}
