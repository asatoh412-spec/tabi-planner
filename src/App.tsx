import { useCallback, useEffect, useState } from 'react'
import AreaPicker from './components/AreaPicker'
import ConditionsForm, { type StartRequest } from './components/ConditionsForm'
import Generating from './components/Generating'
import Settings from './components/Settings'
import TripView from './components/TripView'
import { deleteTrip, listTrips, purgeExpiredGoogleCoords } from './db'
import { fmtDate } from './lib/time'
import type { Conditions, Trip } from './types'

type View =
  | { k: 'trips' } | { k: 'area'; fromForm?: boolean } | { k: 'settings' }
  | { k: 'new'; initial?: { name: string; conditions: Conditions; withEvents?: boolean } }
  | { k: 'gen'; req: StartRequest } | { k: 'trip'; id: string }

function Trips({ open, create, draft, resume }: { open: (id: string) => void; create: () => void; draft: StartRequest | null; resume: () => void }) {
  const [trips, setTrips] = useState<Trip[]>([])
  useEffect(() => { listTrips().then(t => setTrips(t.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))) }, [])
  return (
    <section className="page">
      <h1>旅行一覧</h1>
      <div className="row">
        {draft && <button className="primary" onClick={resume}>入力中の旅行計画に戻る{draft.name ? `（${draft.name}）` : ''}</button>}
        <button className={draft ? '' : 'primary'} onClick={create}>新しい旅行</button>
      </div>
      {trips.length === 0 && <p className="note">まだ旅行はありません。先に「範囲」で行き先の範囲を保存し、「設定」でAPIキーを入れてください。</p>}
      <ul className="list cards">
        {trips.map(t => {
          const p = t.plans.find(x => x.id === t.adoptedPlanId) ?? t.plans[0]
          return <li key={t.id}>
            <button className="link" onClick={() => open(t.id)}>{t.name}</button>
            <span className="note">{p ? `${fmtDate(p.days[0].date)}〜 ${t.plans.length}案` : '案なし'}{t.adoptedPlanId ? '・採用済み' : ''}</span>
            <button className="ghost" onClick={async () => { if (confirm(`「${t.name}」を削除しますか`)) { await deleteTrip(t.id); setTrips(trips.filter(x => x.id !== t.id)) } }}>削除</button>
          </li>
        })}
      </ul>
    </section>
  )
}

export default function App() {
  const [view, setView] = useState<View>({ k: 'trips' })
  // 入力中の条件（範囲の指定に行って戻っても消えないように。端末にも控える）
  const [draft, setDraftState] = useState<StartRequest | null>(() => { try { const t = localStorage.getItem('tabi-draft'); return t ? JSON.parse(t) : null } catch { return null } })
  const setDraft = useCallback((d: StartRequest | null) => { setDraftState(d); try { if (d) localStorage.setItem('tabi-draft', JSON.stringify(d)); else localStorage.removeItem('tabi-draft') } catch { /* 保存できなくても続行 */ } }, [])
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    purgeExpiredGoogleCoords()
    // 以前のPWA版が残した Service Worker とキャッシュを消す（古い版が表示され続けるのを防ぐ）
    navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {})
    caches?.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {})
    const on = () => setOnline(true), off = () => setOnline(false)
    addEventListener('online', on); addEventListener('offline', off)
    return () => { removeEventListener('online', on); removeEventListener('offline', off) }
  }, [])
  const onDone = useCallback((id: string) => setView({ k: 'trip', id }), [])
  const tab = view.k === 'new' || view.k === 'gen' || view.k === 'trip' ? 'trips' : view.k
  return (
    <div className="app">
      {!online && <div className="offline no-print">オフラインです（このアプリはオンラインで使います）</div>}
      <main>
        {view.k === 'trips' && <Trips open={id => setView({ k: 'trip', id })} create={() => { setDraft(null); setView({ k: 'new', initial: undefined }) }} draft={draft} resume={() => setView({ k: 'new', initial: draft ?? undefined })} />}
        {view.k === 'new' && <ConditionsForm key={JSON.stringify(view.initial?.conditions ?? null).length} initial={view.initial ?? draft ?? undefined} onDraft={setDraft} onStart={req => { setDraft(null); setView({ k: 'gen', req }) }} />}
        {view.k === 'gen' && <Generating req={view.req} onDone={onDone} onCancel={() => setView({ k: 'new', initial: { name: view.req.name, conditions: view.req.conditions } })} />}
        {view.k === 'trip' && <TripView tripId={view.id} onBack={() => setView({ k: 'trips' })} onRegenerate={(c, name) => setView({ k: 'new', initial: { name, conditions: c } })} />}
        {view.k === 'area' && <AreaPicker onBack={view.fromForm || draft ? () => setView({ k: 'new', initial: draft ?? undefined }) : undefined}
          onSaved={draft ? a => setDraft({ ...draft, conditions: { ...draft.conditions, areaIds: [...new Set([...(draft.conditions.areaIds ?? []), a.id])] } }) : undefined} />}
        {view.k === 'settings' && <Settings />}
      </main>
      <nav className="tabs no-print">
        {([['trips', '旅行'], ['settings', '設定']] as const).map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setView({ k } as View)}>{l}</button>)}
      </nav>
    </div>
  )
}
