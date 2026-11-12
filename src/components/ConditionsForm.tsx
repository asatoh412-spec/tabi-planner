import { useEffect, useState } from 'react'
import { deletePreset, getSettings, listAreas, listPresets, newId, savePreset } from '../db'
import { gsiGeocode, placesLocate } from '../api/clients'
import { distanceKm } from '../lib/geo'
import { PACE_LIMITS } from '../lib/schedule'
import { emptyConditions, normalizeConditions, type Conditions, type MapArea, type Mode, type Pace, type Preset, type Priority, type Wish } from '../types'

const PRI: { v: Priority; label: string }[] = [
  { v: 'must', label: '必須' }, { v: 'want', label: 'できれば' }, { v: 'auto', label: 'おまかせ' }, { v: 'exclude', label: '除外' },
]
const ANGLES = ['バランス', '移動少なめ', '食事重視', 'ゆとり重視']

interface OriginCand { title: string; sub: string; coord: { lat: number; lng: number }; source: 'gsi' | 'google'; placeId?: string; km?: number }

export interface StartRequest { name: string; conditions: Conditions; withEvents: boolean }

export default function ConditionsForm({ initial, onStart, goArea, onDraft }: { initial?: { name: string; conditions: Conditions; withEvents?: boolean }; onStart: (r: StartRequest) => void; goArea: () => void; onDraft?: (d: StartRequest) => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [c, setC] = useState<Conditions>(initial ? normalizeConditions(initial.conditions) : emptyConditions())
  const [areas, setAreas] = useState<MapArea[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [originQ, setOriginQ] = useState(c.origin?.label ?? '')
  const [originMsg, setOriginMsg] = useState('')
  const [wishText, setWishText] = useState('')
  const [wishPri, setWishPri] = useState<Priority>('must')
  const [withEvents, setWithEvents] = useState(initial?.withEvents ?? true)
  useEffect(() => { onDraft?.({ name, conditions: c, withEvents }) }, [name, c, withEvents])

  useEffect(() => { listAreas().then(a => { setAreas(a); if (!c.areaIds.length && a.length === 1) setC(x => ({ ...x, areaIds: [a[0].id] })) }); listPresets().then(setPresets) }, [])

  const upd = (p: Partial<Conditions>) => setC(x => ({ ...x, ...p }))
  const str = (v: string) => (v.trim() ? v : null)

  const [originCands, setOriginCands] = useState<OriginCand[]>([])

  async function findOrigin() {
    setOriginMsg(''); setOriginCands([])
    const area = areas.find(a => c.areaIds.includes(a.id))
    if (!area) { setOriginMsg('先に範囲を選んでください（近い候補を優先するため）'); return }
    const out: OriginCand[] = []
    try {
      const st = await getSettings()
      if (st.googleKey) {
        const g = await placesLocate(st, originQ, area.center, 50000)
        g.forEach(x => out.push({ title: x.name, sub: x.address ?? '', coord: x.location, source: 'google', placeId: x.id }))
      }
    } catch (e) { setOriginMsg(`Googleでの検索に失敗：${(e as Error).message}`) }
    try {
      const r = await gsiGeocode(originQ)
      r.slice(0, 10).forEach(x => out.push({ title: x.title, sub: '国土地理院 住所検索', coord: x.coord, source: 'gsi' }))
    } catch { /* 住所検索の失敗は無視 */ }
    out.forEach(x => { x.km = distanceKm(area.center, x.coord) })
    out.sort((a, b) => a.km! - b.km!)
    if (!out.length) { setOriginMsg('見つかりませんでした'); return }
    setOriginCands(out.slice(0, 6))
  }

  function pickOrigin(x: OriginCand) {
    const area = areas.find(a => c.areaIds.includes(a.id))
    upd({ origin: { label: x.title, coord: x.coord, source: x.source, placeId: x.placeId, fetchedAt: x.source === 'google' ? new Date().toISOString() : undefined } })
    setOriginCands([])
    const far = area && x.km! > area.radiusKm * 3 + 20
    setOriginMsg(`設定：${x.title}（範囲の中心から${x.km!.toFixed(1)}km）${far ? '　※範囲からかなり離れています。合っているか確認してください' : ''}`)
  }

  function addWish() {
    if (!wishText.trim()) return
    const w: Wish = { id: newId(), priority: wishPri, text: wishText.trim() }
    upd({ wishes: [...c.wishes, w] }); setWishText('')
  }

  const musts = c.wishes.filter(w => w.priority === 'must')
  const angleOptions = [...ANGLES, ...(musts.length >= 2 ? musts.map(m => `${m.text}を優先`) : [])]
  const toggleAngle = (a: string) => upd({ angles: c.angles.includes(a) ? c.angles.filter(x => x !== a) : c.angles.length >= 3 ? c.angles : [...c.angles, a] })

  return (
    <section className="page">
      <h1>条件の入力</h1>
      <p className="note">すべて任意です。空欄は「おまかせ」として扱います。</p>

      {presets.length > 0 && <div className="row">
        <span className="note">よく使う条件：</span>
        {presets.map(p => <span key={p.id} className="chip"><button className="link" onClick={() => { setC({ ...emptyConditions(), ...structuredClone(p.conditions), wishes: p.conditions.wishes.map(w => ({ ...w, id: newId() })) }); setOriginQ(p.conditions.origin?.label ?? '') }}>{p.name}</button><button className="ghost" aria-label="削除" onClick={async () => { await deletePreset(p.id); setPresets(await listPresets()) }}>×</button></span>)}
      </div>}

      <label>旅行の名前<input value={name} onChange={e => setName(e.target.value)} placeholder="例：弘前 秋" /></label>

      <h2>場所</h2>
      {areas.length === 0
        ? <p className="note">範囲が未登録です。<button className="link" onClick={goArea}>地図で範囲を指定する</button></p>
        : <>
            <p className="note">回る範囲（複数選べます。範囲の間は車か公共交通で移動します）</p>
            <div className="row wrap">{areas.map(a => <button key={a.id} className={`chipbtn ${c.areaIds.includes(a.id) ? 'on' : ''}`} onClick={() => upd({ areaIds: c.areaIds.includes(a.id) ? c.areaIds.filter(x => x !== a.id) : [...c.areaIds, a.id] })}>{a.name}（{a.radiusKm}km）</button>)}
              <button className="link" onClick={goArea}>＋範囲を追加</button></div>
          </>}
      <label>自宅（往復の乗換案内に使います）<input value={c.home ?? ''} onChange={e => upd({ home: str(e.target.value), ...(c.startBasis ? {} : { startBasis: 'home', endBasis: 'home' }) })} placeholder="例：中野駅" /></label>
      <label>現地の玄関口（初日に着き、最終日に出る駅・空港など）</label>
      <div className="row">
        <input value={originQ} onChange={e => setOriginQ(e.target.value)} placeholder="例：田沢湖駅、弘前市表町1-1" />
        <button onClick={findOrigin}>設定</button>
      </div>
      {originCands.length > 0 && <ul className="list">{originCands.map((x, i) => <li key={i}><button className="link" onClick={() => pickOrigin(x)}>{x.title}</button><span className="note">{x.sub}・中心から{x.km!.toFixed(1)}km</span></li>)}</ul>}
      {originCands.some(x => x.source === 'google') && <p className="note">候補の一部の情報：Google Maps</p>}
      {originMsg && <p className="note">{originMsg}</p>}

      <h2>時間と移動</h2>
      <div className="grid2">
        <div>
          <div className="seg small">
            <button className={c.startBasis !== 'home' ? 'on' : ''} onClick={() => upd({ startBasis: 'gateway' })}>玄関口に着く</button>
            <button className={c.startBasis === 'home' ? 'on' : ''} onClick={() => upd({ startBasis: 'home', homeTravelEst: null })}>家を出る</button>
          </div>
          <label>{c.startBasis === 'home' ? '家を出る日時' : '玄関口に着く日時'}<input type="datetime-local" value={c.start ?? ''} onChange={e => upd({ start: str(e.target.value) })} /></label>
        </div>
        <div>
          <div className="seg small">
            <button className={c.endBasis !== 'home' ? 'on' : ''} onClick={() => upd({ endBasis: 'gateway' })}>玄関口を出る</button>
            <button className={c.endBasis === 'home' ? 'on' : ''} onClick={() => upd({ endBasis: 'home', homeTravelEst: null })}>家に着く</button>
          </div>
          <label>{c.endBasis === 'home' ? '家に着く日時' : '玄関口を出る日時'}<input type="datetime-local" value={c.end ?? ''} onChange={e => upd({ end: str(e.target.value) })} /></label>
        </div>
      </div>
      {(c.startBasis === 'home' || c.endBasis === 'home') && <label>家⇄玄関口の片道の所要時間（分）<input type="number" min={0} value={c.homeTravelMin ?? ''} onChange={e => upd({ homeTravelMin: e.target.value ? Number(e.target.value) : null, homeTravelEst: null })} placeholder="空欄なら目安を自動で調べます" /></label>}
      <p className="note">往復の電車・飛行機の時刻はアプリでは推測しません。乗換案内で調べた時刻を入れてください（空欄なら初日は午前9時着・最終日は19時半発として組みます）。</p>
      <div className="seg">
        {([['train', '電車中心'], ['car', '車'], ['walk_transit', '徒歩＋公共交通']] as [Mode, string][]).map(([v, l]) =>
          <button key={v} className={c.mode === v ? 'on' : ''} onClick={() => upd({ mode: c.mode === v ? null : v })}>{l}</button>)}
      </div>
      <div className="seg">
        {(Object.keys(PACE_LIMITS) as Pace[]).map(p =>
          <button key={p} className={c.pace === p ? 'on' : ''} onClick={() => upd({ pace: c.pace === p ? null : p })}>{PACE_LIMITS[p].label}<small>{PACE_LIMITS[p].stops}か所・{PACE_LIMITS[p].walkKm}km</small></button>)}
      </div>

      <h2>行き先の希望</h2>
      <div className="seg small">
        {PRI.map(p => <button key={p.v} className={wishPri === p.v ? 'on' : ''} onClick={() => setWishPri(p.v)}>{p.label}</button>)}
      </div>
      <div className="row">
        <input value={wishText} onChange={e => setWishText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addWish()}
          placeholder={wishPri === 'auto' ? '例：焼き物の窯元、地酒の飲める店' : wishPri === 'exclude' ? '例：テーマパーク' : '例：弘前城'} />
        <button onClick={addWish}>追加</button>
      </div>
      <ul className="list">
        {c.wishes.map(w => (
          <li key={w.id}>
            <span className={`pri pri-${w.priority}`}>{PRI.find(p => p.v === w.priority)!.label}</span>
            <span>{w.text}</span>
            <button className="ghost" onClick={() => upd({ wishes: c.wishes.filter(x => x.id !== w.id) })}>削除</button>
          </li>
        ))}
      </ul>

      <h2>食事・宿・予算</h2>
      <label>食事の希望<input value={c.food ?? ''} onChange={e => upd({ food: str(e.target.value) })} placeholder="例：郷土料理、地酒、1食3,000円まで" /></label>
      <label>宿の条件<input value={c.lodging ?? ''} onChange={e => upd({ lodging: str(e.target.value) })} placeholder="例：温泉、駅から徒歩10分以内、1泊15,000円まで" /></label>
      <div className="grid2">
        <label>全体の予算感<input value={c.budget ?? ''} onChange={e => upd({ budget: str(e.target.value) })} placeholder="例：5万円" /></label>
        <label>人数<input type="number" min={1} max={10} value={c.adults ?? ''} onChange={e => upd({ adults: e.target.value ? Number(e.target.value) : null })} placeholder="1" /></label>
      </div>

      <h2>作り分け（最大3案）</h2>
      <div className="row wrap">
        {angleOptions.map(a => <button key={a} className={`chipbtn ${c.angles.includes(a) ? 'on' : ''}`} onClick={() => toggleAngle(a)}>{a}</button>)}
      </div>
      <p className="note">未選択なら「バランス」の1案。案が増えるほど費用と時間がかかります（1案あたりClaude約70円＋Places・Routesの呼び出し）。</p>
      <label className="check"><input type="checkbox" checked={withEvents} onChange={e => setWithEvents(e.target.checked)} />見頃・イベントもウェブ検索で調べる（約10〜20円）</label>

      <div className="row sticky-actions">
        <button onClick={async () => { const n = prompt('この条件の名前'); if (n) { await savePreset({ id: newId(), name: n, conditions: c, savedAt: new Date().toISOString() }); setPresets(await listPresets()) } }}>よく使う条件に保存</button>
        <button className="primary" disabled={!c.areaIds.length} onClick={() => onStart({ name: name || areas.filter(a => c.areaIds.includes(a.id)).map(a => a.name).join('・') || '旅行', conditions: c, withEvents })}>プランを作る</button>
      </div>
    </section>
  )
}
