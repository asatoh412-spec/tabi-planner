import { useEffect, useRef, useState } from 'react'
import { getSettings, listAreas, newId, saveTrip } from '../db'
import { CostMeter, fetchEvents, gatherCandidates, generatePlan } from '../lib/generate'
import { ensureHomeTravel, ensureOrigin } from '../lib/geo'
import type { Plan, Trip } from '../types'
import type { StartRequest } from './ConditionsForm'

export default function Generating({ req: req0, onDone, onCancel }: { req: StartRequest; onDone: (tripId: string) => void; onCancel: () => void }) {
  const [req, setReq] = useState(req0)
  const [needTravel, setNeedTravel] = useState('')
  const [travelIn, setTravelIn] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [cost, setCost] = useState('')
  const [error, setError] = useState('')
  const started = useRef(false)
  const stop = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    setNeedTravel('')
    const meter = new CostMeter()
    const progress = (m: string) => { setLog(l => [...l, m]); setCost(meter.summary()) }
    ;(async () => {
      try {
        const s = await getSettings()
        const missing = [!s.googleKey && 'Google', !s.anthropicKey && 'Claude'].filter(Boolean)
        if (missing.length) throw new Error(`${missing.join('・')}のAPIキーが未設定です（設定タブ）`)
        const c = structuredClone(req.conditions)
        // 家の時刻を基準にするなら、先に家⇄玄関口の所要時間を決める。分からないまま0分で組むことはしない
        if ((c.startBasis === 'home' || c.endBasis === 'home') && c.home && c.origin && !c.homeTravelMin) {
          progress('家から玄関口までの所要時間を調べています')
          await ensureOrigin(s, c)
          const t = await ensureHomeTravel(s, c, u => meter.add(u))
          if (!t) { setNeedTravel(c.homeTravelSource ?? ''); setCost(meter.summary()); return }
          progress(`家から${c.origin.label}まで 約${Math.floor(t.minutes / 60)}時間${t.minutes % 60}分（${c.homeTravelSource}）`)
        }
        const areas = (await listAreas()).filter(a => c.areaIds.includes(a.id))
        if (!areas.length) throw new Error('範囲が選ばれていません')
        const pool = await gatherCandidates(s, c, areas, meter, progress)
        progress(`候補 ${pool.all.length}か所を集めました`)
        const missingMust = c.wishes.filter(w => w.priority === 'must' && !pool.wishPlace[w.id])
        if (missingMust.length) progress(`注意：必須「${missingMust.map(w => w.text).join('、')}」が範囲内で見つかりませんでした`)
        const angles = c.angles.length ? c.angles : ['バランス']
        const plans: Plan[] = []
        for (const a of angles) {
          if (stop.current) break
          plans.push(await generatePlan(s, c, areas, pool, a, meter, progress))
          setCost(meter.summary())
        }
        let events: Trip['events'] = []
        if (req.withEvents && !stop.current) {
          progress('見頃・イベントを調べています')
          try { events = await fetchEvents(s, areas, c, meter) } catch (e) { progress(`見頃・イベントの取得に失敗：${(e as Error).message}`) }
        }
        const trip: Trip = { id: newId(), name: req.name, conditions: c, plans, adoptedPlanId: null, events, createdAt: new Date().toISOString() }
        await saveTrip(trip)
        progress(`完了：${meter.summary()}`)
        onDone(trip.id)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [req, onDone])

  return (
    <section className="page">
      <h1>プランを作っています</h1>
      <ol className="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ol>
      {cost && <p className="note">費用の目安：{cost}</p>}
      {needTravel && <div className="box warn-box">
        <p>「{req.conditions.home}」から「{req.conditions.origin?.label}」までの所要時間を調べられませんでした（{needTravel}）。乗換案内などで調べた片道の所要時間を入れてください。</p>
        <div className="row"><input type="number" min={1} value={travelIn} onChange={e => setTravelIn(e.target.value)} placeholder="分（例：220）" />
          <button className="primary" disabled={!Number(travelIn)} onClick={() => { started.current = false; setLog([]); setReq({ ...req, conditions: { ...req.conditions, homeTravelMin: Number(travelIn) } }) }}>この時間で作る</button></div>
      </div>}
      {error
        ? <><p className="err">{error}</p><button onClick={onCancel}>条件に戻る</button></>
        : <button onClick={() => { stop.current = true }}>今の案で止める</button>}
    </section>
  )
}
