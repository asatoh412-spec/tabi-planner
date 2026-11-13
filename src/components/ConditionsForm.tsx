import { useEffect, useState } from 'react'
import DestinationPicker from './DestinationPicker'
import { deletePreset, getSettings, listAreas, listPresets, newId, savePreset } from '../db'
import { gsiGeocode, placesLocate } from '../api/clients'
import { autoGateway, distanceKm } from '../lib/geo'
import { PACE_LIMITS } from '../lib/schedule'
import { emptyConditions, normalizeConditions, type Conditions, type MapArea, type Mode, type Pace, type Preset, type Priority, type Wish } from '../types'

const PRI: { v: Priority; label: string }[] = [
  { v: 'must', label: '必須' }, { v: 'want', label: 'できれば' }, { v: 'auto', label: 'おまかせ' }, { v: 'exclude', label: '除外' },
]
const ANGLES = ['バランス', '移動少なめ', '食事重視', 'ゆとり重視']

interface OriginCand { title: string; sub: string; coord: { lat: number; lng: number }; source: 'gsi' | 'google'; placeId?: string; km?: number }

export interface StartRequest { name: string; conditions: Conditions; withEvents: boolean }

export default function ConditionsForm({ initial, onStart, onDraft }: { initial?: { name: string; conditions: Conditions; withEvents?: boolean }; onStart: (r: StartRequest) => void; onDraft?: (d: StartRequest) => void }) {
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

  // 新しい旅行では「いつもの条件」（設定タブ）を初期値として入れる
  useEffect(() => {
    if (initial) return
    getSettings().then(st => setC(x => ({
      ...x,
      home: x.home ?? (st.home || null),
      startBasis: x.startBasis ?? (st.home && (st.homeTravelBasis ?? true) ? 'home' : 'gateway'),
      endBasis: x.endBasis ?? (st.home && (st.homeTravelBasis ?? true) ? 'home' : 'gateway'),
      mode: x.mode ?? st.defaultMode ?? null,
      pace: x.pace ?? st.defaultPace ?? null,
      adults: x.adults ?? st.defaultAdults ?? null,
    })))
  }, [])
  useEffect(() => { listAreas().then(setAreas) }, [c.areaIds.join(',')])
  useEffect(() => { listAreas().then(a => { setAreas(a); if (!c.areaIds.length && a.length === 1) setC(x => ({ ...x, areaIds: [a[0].id] })) }); listPresets().then(setPresets) }, [])

  const upd = (p: Partial<Conditions>) => setC(x => ({ ...x, ...p }))
  const str = (v: string) => (v.trim() ? v : null)

  const [originCands, setOriginCands] = useState<OriginCand[]>([])
  const [gwEdit, setGwEdit] = useState(false)
  const [homeEdit, setHomeEdit] = useState(false)
  const [step, setStep] = useState(initial?.conditions.areaIds?.length ? 3 : 0)
  const [timeDetail, setTimeDetail] = useState(false)
  const [times, setTimes] = useState({ leave: '07:00', ret: '21:00', home: false })
  useEffect(() => { getSettings().then(st => setTimes({ leave: st.leaveTime ?? '07:00', ret: st.returnTime ?? '21:00', home: !!st.home && (st.homeTravelBasis ?? true) })) }, [])

  /** 日付だけ選べば、時刻はいつもの時刻（家を基準）か、家が未設定なら玄関口10時着・17時発にする */
  function setDates(d1: string, d2: string) {
    if (!d1) return
    const end = d2 < d1 ? d1 : d2
    const home = (c.startBasis ?? (times.home ? 'home' : 'gateway')) === 'home'
    upd({
      start: `${d1}T${c.start && timeDetail ? c.start.slice(11, 16) : home ? times.leave : '10:00'}`,
      end: `${end}T${c.end && timeDetail ? c.end.slice(11, 16) : home ? times.ret : '17:00'}`,
      startBasis: home ? 'home' : 'gateway', endBasis: home ? 'home' : 'gateway',
    })
  }

  // 行き先が決まったら、玄関口（近くの駅）を自動で選ぶ。手で選んだ玄関口は変えない
  useEffect(() => {
    const first = areas.find(a => a.id === c.areaIds[0])
    if (!first || (c.origin && !c.originAuto)) return
    if (c.origin && c.originAuto && c.originAutoFor === first.id) return
    getSettings().then(st => autoGateway(st, first)).then(o => { if (o) setC(x => ({ ...x, origin: o, originAuto: true, originAutoFor: first.id })) }).catch(() => {})
  }, [c.areaIds.join(','), areas.length])

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
    upd({ origin: { label: x.title, coord: x.coord, source: x.source, placeId: x.placeId, fetchedAt: x.source === 'google' ? new Date().toISOString() : undefined }, originAuto: false }); setGwEdit(false)
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

  const chosenAreas = areas.filter(a => c.areaIds.includes(a.id))
  const STEPS = ['行き先', '日程と移動', '希望', '確認して作る']
  const canNext = step !== 0 || c.areaIds.length > 0
  const fmtD = (d?: string | null) => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '未定'

  return (
    <section className="page">
      <ol className="stepper">{STEPS.map((t, k) => <li key={t} className={k === step ? 'on' : k < step ? 'done' : ''}><button onClick={() => (k <= step || c.areaIds.length) && setStep(k)}>{k + 1}. {t}</button></li>)}</ol>

      {step === 0 && <>
        <h1>どこへ行きますか</h1>
      {presets.length > 0 && <div className="row">
        <span className="note">よく使う条件：</span>
        {presets.map(p => <span key={p.id} className="chip"><button className="link" onClick={() => { setC({ ...emptyConditions(), ...structuredClone(p.conditions), wishes: p.conditions.wishes.map(w => ({ ...w, id: newId() })) }); setOriginQ(p.conditions.origin?.label ?? '') }}>{p.name}</button><button className="ghost" aria-label="削除" onClick={async () => { await deletePreset(p.id); setPresets(await listPresets()) }}>×</button></span>)}
      </div>}

        <DestinationPicker areaIds={c.areaIds} onChange={ids => upd({ areaIds: ids })} />
      {c.origin && !gwEdit
        ? <p>玄関口：<b>{c.origin.label}</b>{c.originAuto && <span className="note">（行き先から自動で選びました）</span>} <button className="link small" onClick={() => setGwEdit(true)}>変える</button></p>
        : <><label>現地の玄関口（初日に着き、最終日に出る駅・空港など）</label>
      <div className="row">
        <input value={originQ} onChange={e => setOriginQ(e.target.value)} placeholder="例：田沢湖駅、弘前市表町1-1" />
        <button onClick={findOrigin}>設定</button>
      </div>
      {originCands.length > 0 && <ul className="list">{originCands.map((x, i) => <li key={i}><button className="link" onClick={() => pickOrigin(x)}>{x.title}</button><span className="note">{x.sub}・中心から{x.km!.toFixed(1)}km</span></li>)}</ul>}
      {originCands.some(x => x.source === 'google') && <p className="note">候補の一部の情報：Google Maps</p>}
      {originMsg && <p className="note">{originMsg}</p>}</>}

      </>}

      {step === 1 && <>
        <h1>いつ、どう回りますか</h1>
      <div className="grid2">
        <label>出発日<input type="date" value={c.start?.slice(0, 10) ?? ''} onChange={e => setDates(e.target.value, c.end?.slice(0, 10) || e.target.value)} /></label>
        <label>帰る日<input type="date" value={c.end?.slice(0, 10) ?? ''} onChange={e => setDates(c.start?.slice(0, 10) || e.target.value, e.target.value)} /></label>
      </div>
      {c.start && !timeDetail && <p className="note">{c.startBasis === 'home' ? `家を出る ${c.start.slice(11, 16)}` : `玄関口に着く ${c.start.slice(11, 16)}`}・{c.end ? (c.endBasis === 'home' ? `家に着く ${c.end.slice(11, 16)}` : `玄関口を出る ${c.end.slice(11, 16)}`) : ''}（いつもの時刻） <button className="link small" onClick={() => setTimeDetail(true)}>時刻を細かく指定</button></p>}
      {(timeDetail || !c.start) && <><div className="grid2">
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
      <p className="note">往復の電車・飛行機の時刻はアプリでは推測しません。家の時刻を基準にした場合、家⇄玄関口の所要時間は自動で目安を調べます。</p></>}

        <h2>移動とペース</h2>
      <div className="seg">
        {([['train', '電車中心'], ['car', '車'], ['walk_transit', '徒歩＋公共交通']] as [Mode, string][]).map(([v, l]) =>
          <button key={v} className={c.mode === v ? 'on' : ''} onClick={() => upd({ mode: c.mode === v ? null : v })}>{l}</button>)}
      </div>
      <div className="seg">
        {(Object.keys(PACE_LIMITS) as Pace[]).map(p =>
          <button key={p} className={c.pace === p ? 'on' : ''} onClick={() => upd({ pace: c.pace === p ? null : p })}>{PACE_LIMITS[p].label}<small>{PACE_LIMITS[p].stops}か所・{PACE_LIMITS[p].walkKm}km</small></button>)}
      </div>

        {c.home && !homeEdit ? <p className="note">自宅：{c.home} <button className="link small" onClick={() => setHomeEdit(true)}>変える</button></p> : <>
      <label>自宅（往復の乗換案内に使います）<input value={c.home ?? ''} onChange={e => { const h = str(e.target.value); upd({ home: h, ...(h && !timeDetail && c.startBasis !== 'home' ? { startBasis: 'home', endBasis: 'home', ...(c.start ? { start: `${c.start.slice(0, 10)}T${times.leave}` } : {}), ...(c.end ? { end: `${c.end.slice(0, 10)}T${times.ret}` } : {}) } : {}) }) }} placeholder="例：中野駅" /></label>
        </>}
      </>}

      {step === 2 && <>
        <h1>希望はありますか</h1>
        <p className="note">空欄でも作れます（おまかせ）。</p>
        <h2>行きたい・行きたくない場所</h2>
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

        <details className="more" open={!!(c.food || c.lodging || c.budget)}>
          <summary>食事・宿・予算・人数</summary>
      <label>食事の希望<input value={c.food ?? ''} onChange={e => upd({ food: str(e.target.value) })} placeholder="例：郷土料理、地酒、1食3,000円まで" /></label>
      <label>宿の条件<input value={c.lodging ?? ''} onChange={e => upd({ lodging: str(e.target.value) })} placeholder="例：温泉、駅から徒歩10分以内、1泊15,000円まで" /></label>
      <div className="grid2">
        <label>全体の予算感<input value={c.budget ?? ''} onChange={e => upd({ budget: str(e.target.value) })} placeholder="例：5万円" /></label>
        <label>人数<input type="number" min={1} max={10} value={c.adults ?? ''} onChange={e => upd({ adults: e.target.value ? Number(e.target.value) : null })} placeholder="1" /></label>
      </div>

        </details>
      </>}

      {step === 3 && <>
        <h1>この内容で作ります</h1>
        <dl className="summary">
          <dt>行き先</dt><dd>{chosenAreas.map(a => a.name).join('・') || '未選択'}{c.origin ? `（玄関口：${c.origin.label}）` : ''} <button className="link small" onClick={() => setStep(0)}>変える</button></dd>
          <dt>日程</dt><dd>{fmtD(c.start)}〜{fmtD(c.end)}・{c.startBasis === 'home' ? `家を${c.start?.slice(11, 16) ?? ''}に出る` : `玄関口に${c.start?.slice(11, 16) ?? ''}着`}・{c.endBasis === 'home' ? `家に${c.end?.slice(11, 16) ?? ''}着` : `玄関口を${c.end?.slice(11, 16) ?? ''}発`} <button className="link small" onClick={() => setStep(1)}>変える</button></dd>
          <dt>移動</dt><dd>{({ train: '電車中心', car: '車', walk_transit: '徒歩＋公共交通' } as Record<string, string>)[c.mode ?? ''] ?? 'おまかせ'}・{c.pace ? PACE_LIMITS[c.pace].label : 'ペースおまかせ'}</dd>
          <dt>希望</dt><dd>{c.wishes.length ? c.wishes.map(w => `${PRI.find(p => p.v === w.priority)!.label}：${w.text}`).join('、') : 'おまかせ'} <button className="link small" onClick={() => setStep(2)}>変える</button></dd>
        </dl>
      <label>旅行の名前<input value={name} onChange={e => setName(e.target.value)} placeholder="例：弘前 秋（空欄なら行き先の名前）" /></label>

        <h2>作り分け（最大3案）</h2>
      <div className="row wrap">
        {angleOptions.map(a => <button key={a} className={`chipbtn ${c.angles.includes(a) ? 'on' : ''}`} onClick={() => toggleAngle(a)}>{a}</button>)}
      </div>
      <p className="note">未選択なら「バランス」の1案。案が増えるほど費用と時間がかかります（1案あたりClaude約70円＋Places・Routesの呼び出し）。</p>
      <label className="check"><input type="checkbox" checked={withEvents} onChange={e => setWithEvents(e.target.checked)} />見頃・イベントもウェブ検索で調べる（約10〜20円）</label>

      </>}

      <div className="row sticky-actions">
        {step > 0 && <button onClick={() => setStep(step - 1)}>戻る</button>}
        {step === 3 && <button onClick={async () => { const n = prompt('この条件の名前'); if (n) { await savePreset({ id: newId(), name: n, conditions: c, savedAt: new Date().toISOString() }); setPresets(await listPresets()) } }}>よく使う条件に保存</button>}
        {step < 3
          ? <button className="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>{step === 0 && !c.areaIds.length ? '行き先を選んでください' : '次へ'}</button>
          : <button className="primary" disabled={!c.areaIds.length} onClick={() => onStart({ name: name || chosenAreas.map(a => a.name).join('・') || '旅行', conditions: c, withEvents })}>プランを作る</button>}
      </div>
    </section>
  )
}
