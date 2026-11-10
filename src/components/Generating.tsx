import { useEffect, useRef, useState } from 'react'
import { getArea, getSettings, newId, saveTrip } from '../db'
import { CostMeter, fetchEvents, gatherCandidates, generatePlan } from '../lib/generate'
import type { Plan, Trip } from '../types'
import type { StartRequest } from './ConditionsForm'

export default function Generating({ req, onDone, onCancel }: { req: StartRequest; onDone: (tripId: string) => void; onCancel: () => void }) {
  const [log, setLog] = useState<string[]>([])
  const [cost, setCost] = useState('')
  const [error, setError] = useState('')
  const started = useRef(false)
  const stop = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const meter = new CostMeter()
    const progress = (m: string) => { setLog(l => [...l, m]); setCost(meter.summary()) }
    ;(async () => {
      try {
        const s = await getSettings()
        const missing = [!s.googleKey && 'Google', !s.anthropicKey && 'Claude'].filter(Boolean)
        if (missing.length) throw new Error(`${missing.join('・')}のAPIキーが未設定です（設定タブ）`)
        const area = await getArea(req.conditions.areaId!)
        if (!area) throw new Error('範囲が見つかりません')
        const c = structuredClone(req.conditions)
        const pool = await gatherCandidates(s, c, area, meter, progress)
        progress(`候補 ${pool.all.length}か所を集めました`)
        const missingMust = c.wishes.filter(w => w.priority === 'must' && !pool.wishPlace[w.id])
        if (missingMust.length) progress(`注意：必須「${missingMust.map(w => w.text).join('、')}」が範囲内で見つかりませんでした`)
        const angles = c.angles.length ? c.angles : ['バランス']
        const plans: Plan[] = []
        for (const a of angles) {
          if (stop.current) break
          plans.push(await generatePlan(s, c, area, pool, a, meter, progress))
          setCost(meter.summary())
        }
        let events: Trip['events'] = []
        if (req.withEvents && !stop.current) {
          progress('見頃・イベントを調べています')
          try { events = await fetchEvents(s, area, c, meter) } catch (e) { progress(`見頃・イベントの取得に失敗：${(e as Error).message}`) }
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
      {error
        ? <><p className="err">{error}</p><button onClick={onCancel}>条件に戻る</button></>
        : <button onClick={() => { stop.current = true }}>今の案で止める</button>}
    </section>
  )
}
