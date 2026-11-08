import { useEffect, useState } from 'react'
import AreaPicker from './components/AreaPicker'
import Settings from './components/Settings'
import { listTrips, purgeExpiredGoogleCoords } from './db'
import type { Trip } from './types'

type Tab = 'trips' | 'area' | 'settings'

function Trips({ go }: { go: (t: Tab) => void }) {
  const [trips, setTrips] = useState<Trip[]>([])
  useEffect(() => { listTrips().then(setTrips) }, [])
  return (
    <section className="page">
      <h1>旅行一覧</h1>
      {trips.length === 0 && <p className="note">まだ旅行はありません。プランの作成は段階1で追加します。まずは「範囲」で行き先の範囲を保存し、「設定」でAPIキーの接続テストをしてください。</p>}
      <div className="row"><button onClick={() => go('area')}>範囲を指定する</button><button onClick={() => go('settings')}>設定を開く</button></div>
    </section>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('trips')
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    purgeExpiredGoogleCoords()
    const on = () => setOnline(true), off = () => setOnline(false)
    addEventListener('online', on); addEventListener('offline', off)
    return () => { removeEventListener('online', on); removeEventListener('offline', off) }
  }, [])
  return (
    <div className="app">
      {!online && <div className="offline">オフライン表示中</div>}
      <main>
        {tab === 'trips' && <Trips go={setTab} />}
        {tab === 'area' && <AreaPicker />}
        {tab === 'settings' && <Settings />}
      </main>
      <nav className="tabs">
        <button className={tab === 'trips' ? 'on' : ''} onClick={() => setTab('trips')}>旅行</button>
        <button className={tab === 'area' ? 'on' : ''} onClick={() => setTab('area')}>範囲</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>設定</button>
      </nav>
    </div>
  )
}
