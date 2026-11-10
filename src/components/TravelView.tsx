import { useEffect, useMemo, useState } from 'react'
import { getArea, listTrips, saveArea } from '../db'
import { cachedTileCount, saveTiles, tileUrls } from '../lib/tiles'
import { fmtDate, today } from '../lib/time'
import type { MapArea, Trip } from '../types'
import { GsiDayMap } from './Maps'

/** 旅行中：保存済みのデータだけで表示する（オフラインでも見られる） */
export default function TravelView() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [tid, setTid] = useState('')
  const [di, setDi] = useState(0)
  const [area, setArea] = useState<MapArea | null>(null)
  const [prog, setProg] = useState('')
  const [cached, setCached] = useState(0)

  useEffect(() => {
    listTrips().then(ts => {
      const ok = ts.filter(t => t.adoptedPlanId)
      setTrips(ok)
      const now = today()
      const cur = ok.find(t => t.plans.find(p => p.id === t.adoptedPlanId)?.days.some(d => d.date === now)) ?? ok[0]
      if (cur) {
        setTid(cur.id)
        const i = cur.plans.find(p => p.id === cur.adoptedPlanId)!.days.findIndex(d => d.date === now)
        setDi(Math.max(0, i))
      }
    })
    cachedTileCount().then(setCached)
  }, [])

  const trip = trips.find(t => t.id === tid)
  const plan = trip?.plans.find(p => p.id === trip.adoptedPlanId)
  const day = plan?.days[Math.min(di, plan.days.length - 1)]
  useEffect(() => { if (trip?.conditions.areaId) getArea(trip.conditions.areaId).then(a => setArea(a ?? null)) }, [trip])

  const points = useMemo(() => (day?.stops ?? []).map((s, i) => ({ s, i })).filter(x => x.s.official?.coord).map(x => ({ label: x.s.official!.name, coord: x.s.official!.coord!, n: x.i + 1 })), [day])

  if (!trips.length) return <section className="page"><h1>旅行中</h1><p className="note">採用した案のある旅行がありません。旅行の画面で「この案を採用」を押すと、ここに表示されます。</p></section>

  async function download() {
    if (!area) return
    const sig = { stop: false }
    await saveTiles(area, (d, t) => setProg(`地図を保存中 ${d}/${t}`), sig)
    const a = { ...area, tilesSavedAt: new Date().toISOString() }
    await saveArea(a); setArea(a); setProg('保存しました'); setCached(await cachedTileCount())
  }

  const missing = (day?.stops.length ?? 0) - points.length
  return (
    <section className="page">
      <h1>旅行中</h1>
      {trips.length > 1 && <select value={tid} onChange={e => { setTid(e.target.value); setDi(0) }}>{trips.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      {plan && <div className="tabs-inline">{plan.days.map((d, i) => <button key={d.date} className={i === di ? 'on' : ''} onClick={() => setDi(i)}>{fmtDate(d.date)}</button>)}</div>}
      {day && <>
        <ol className="timeline">
          <li className="tl-start"><b>{day.startTime}</b> 出発：{day.startPoint.label}</li>
          {day.stops.map((s, i) => <li key={s.id} className="tl-stop">
            {day.legs[i] && <p className="note">{{ walk: '徒歩', car: '車', train: '電車' }[day.legs[i].mode]} {day.legs[i].minutes}分{day.legs[i].estimated ? '（推定）' : ''}
              {navigator.onLine && day.legs[i].transitLinks?.map(l => <a key={l.url} href={l.url} target="_blank" rel="noreferrer"> {l.label}</a>)}</p>}
            <div className="stop-head"><b>{s.arrive}–{s.depart}</b><span className="stop-name">{i + 1}. {s.official?.name ?? '（公式情報を未取得）'}</span></div>
            {s.official && <p className="note">{[s.official.hours, s.official.closed && `休み：${s.official.closed}`, s.official.fee].filter(Boolean).join('・')}{s.official.needsCheck && '（要確認）'}</p>}
          </li>)}
        </ol>
        {day.rainPlan && <p className="box"><b>雨の日の代案：</b>{day.rainPlan}</p>}
        <GsiDayMap points={points} center={area?.center} />
        {missing > 0 && <p className="note">地図に出ていない{missing}か所は、公式サイトの住所が未取得です（旅行の画面で「公式サイトの情報を取得」）。</p>}
      </>}
      {area && <div className="box">
        <h3>オフライン用の地図</h3>
        <p className="note">「{area.name}」半径{area.radiusKm}km・ズーム{area.minZoom}〜{area.maxZoom}：{tileUrls(area).length}枚。{area.tilesSavedAt ? `${area.tilesSavedAt.slice(0, 10)}に保存済み。` : '未保存。'}端末内の地図画像 {cached}枚。</p>
        <button disabled={!navigator.onLine || !!prog && prog.startsWith('地図を保存中')} onClick={download}>{area.tilesSavedAt ? '保存し直す' : 'この範囲の地図を保存'}</button>
        {prog && <p className="note">{prog}</p>}
      </div>}
    </section>
  )
}
