import { useEffect, useState } from 'react'
import { deletePreset, listAreas, listPresets, newId, savePreset } from '../db'
import { gsiGeocode } from '../api/clients'
import { PACE_LIMITS } from '../lib/schedule'
import { emptyConditions, type Conditions, type MapArea, type Mode, type Pace, type Preset, type Priority, type Wish } from '../types'

const PRI: { v: Priority; label: string }[] = [
  { v: 'must', label: '必須' }, { v: 'want', label: 'できれば' }, { v: 'auto', label: 'おまかせ' }, { v: 'exclude', label: '除外' },
]
const ANGLES = ['バランス', '移動少なめ', '食事重視', 'ゆとり重視']

export interface StartRequest { name: string; conditions: Conditions; withEvents: boolean }

export default function ConditionsForm({ initial, onStart, goArea }: { initial?: { name: string; conditions: Conditions }; onStart: (r: StartRequest) => void; goArea: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [c, setC] = useState<Conditions>(initial?.conditions ?? emptyConditions())
  const [areas, setAreas] = useState<MapArea[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [originQ, setOriginQ] = useState(c.origin?.label ?? '')
  const [originMsg, setOriginMsg] = useState('')
  const [wishText, setWishText] = useState('')
  const [wishPri, setWishPri] = useState<Priority>('must')
  const [withEvents, setWithEvents] = useState(true)

  useEffect(() => { listAreas().then(a => { setAreas(a); if (!c.areaId && a.length === 1) setC(x => ({ ...x, areaId: a[0].id })) }); listPresets().then(setPresets) }, [])

  const upd = (p: Partial<Conditions>) => setC(x => ({ ...x, ...p }))
  const str = (v: string) => (v.trim() ? v : null)

  async function findOrigin() {
    setOriginMsg('')
    try {
      const r = await gsiGeocode(originQ)
      if (!r.length) { setOriginMsg('見つかりませんでした。駅名は「〇〇駅」でなく住所や地名でも試してください'); return }
      upd({ origin: { label: originQ, coord: r[0].coord } }); setOriginMsg(`設定：${r[0].title}`)
    } catch (e) { setOriginMsg((e as Error).message) }
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
        ? <p className="note">範囲が未登録です。<button className="link" onClick={goArea}>国土地理院の地図で範囲を指定する</button></p>
        : <label>範囲
            <select value={c.areaId ?? ''} onChange={e => upd({ areaId: e.target.value || null })}>
              <option value="">選んでください</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.name}（半径{a.radiusKm}km）</option>)}
            </select>
          </label>}
      <label>初日の出発地点（駅・住所。最終日はここに戻る）</label>
      <div className="row">
        <input value={originQ} onChange={e => setOriginQ(e.target.value)} placeholder="例：青森県弘前市表町1-1" />
        <button onClick={findOrigin}>設定</button>
      </div>
      {originMsg && <p className="note">{originMsg}</p>}

      <h2>時間と移動</h2>
      <div className="grid2">
        <label>出発（到着）日時<input type="datetime-local" value={c.start ?? ''} onChange={e => upd({ start: str(e.target.value) })} /></label>
        <label>帰着（最後の出発）日時<input type="datetime-local" value={c.end ?? ''} onChange={e => upd({ end: str(e.target.value) })} /></label>
      </div>
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
        <button className="primary" disabled={!c.areaId} onClick={() => onStart({ name: name || areas.find(a => a.id === c.areaId)?.name || '旅行', conditions: c, withEvents })}>プランを作る</button>
      </div>
    </section>
  )
}
