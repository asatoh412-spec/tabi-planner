import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSettings, getTrip, listAreas, saveTrip } from '../db'
import { placesCandidates, type Candidate } from '../api/clients'
import { CostMeter, chooseLodging, combinePlans, fetchHotels, fetchOfficialInfo, regenerateDay } from '../lib/generate'
import { remember, useLive } from '../lib/live'
import { CHECKIN_BY, PACE_LIMITS, coordOf, nameOf, scheduleAndValidate, showTime } from '../lib/schedule'
import { fmtDate, fromMin, toMin } from '../lib/time'
import { bookingLinks, transitLinks } from '../lib/transit'
import { normalizeConditions, type Conditions, type Day, type LatLng, type Leg, type MapArea, type Plan, type Stop, type Trip } from '../types'
import { GoogleRouteMap, PLAN_COLORS } from './Maps'

const KIND: Record<Stop['kind'], string> = { sight: '名所', meal: '食事', cafe: 'カフェ', shop: '買い物', other: 'その他', lodging: '宿' }
const LEGMODE: Record<Leg['mode'], string> = { walk: '徒歩', car: '車', train: '公共交通' }

export default function TripView({ tripId, onBack, onRegenerate }: { tripId: string; onBack: () => void; onRegenerate: (c: Conditions, name: string) => void }) {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [sel, setSel] = useState<string>('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => { getTrip(tripId).then(t => { if (t) { t = { ...t, conditions: normalizeConditions(t.conditions) }; setTrip(t); setSel(t.adoptedPlanId ?? t.plans[0]?.id ?? '') } }) }, [tripId])

  const persist = useCallback(async (t: Trip) => { await saveTrip(t); setTrip({ ...t }) }, [])
  const replacePlan = useCallback(async (p: Plan) => { if (!trip) return; await persist({ ...trip, plans: trip.plans.map(x => (x.id === p.id ? p : x)) }) }, [trip, persist])

  async function run(label: string, fn: (meter: CostMeter, progress: (m: string) => void) => Promise<void>) {
    setBusy(label); setNote('')
    const meter = new CostMeter()
    try { await fn(meter, m => setBusy(m)); setNote(`完了：${meter.summary()}`) } catch (e) { setNote(`失敗：${(e as Error).message}`) }
    setBusy('')
  }

  if (!trip) return <section className="page"><p className="note">読み込み中…</p></section>
  const plan = trip.plans.find(p => p.id === sel)
  const c = trip.conditions

  return (
    <section className="page">
      <button className="link" onClick={onBack}>← 旅行一覧</button>
      <h1>{trip.name}</h1>
      <p className="note">{plan ? `${fmtDate(plan.days[0].date)}〜${fmtDate(plan.days.at(-1)!.date)}・` : ''}{PACE_LIMITS[c.pace ?? 'standard'].label}・{{ train: '電車中心', car: '車', walk_transit: '徒歩＋公共交通' }[c.mode ?? 'walk_transit']}</p>

      {trip.events.length > 0 && <details className="box">
        <summary>見頃・イベント（{trip.events.length}件）</summary>
        <ul>{trip.events.map((e, i) => <li key={i}>{e.title}{e.period && `（${e.period}）`}{e.place && `・${e.place}`} <a href={e.sourceUrl} target="_blank" rel="noreferrer">出典</a> <span className="note">{e.checkedAt.slice(0, 10)}確認</span></li>)}</ul>
      </details>}

      <div className="tabs-inline">
        {trip.plans.map((p, i) => <button key={p.id} className={sel === p.id ? 'on' : ''} onClick={() => setSel(p.id)}>
          <i className="dot" style={{ background: PLAN_COLORS[i % 4] }} />{p.angle}{p.status === 'conflict' && <span className="badge warn">要対応</span>}{trip.adoptedPlanId === p.id && <span className="badge">採用</span>}
        </button>)}
        {trip.plans.length > 1 && <button className={sel === 'compare' ? 'on' : ''} onClick={() => setSel('compare')}>比べる</button>}
      </div>

      {busy && <p className="busy">{busy}</p>}
      {note && <p className="note">{note}</p>}

      {sel === 'compare' && <Compare trip={trip} onCombine={async picks => {
        await run('組み合わせを検証しています', async () => {
          const s = await getSettings()
          const p = await combinePlans(s, trip, picks)
          await persist({ ...trip, plans: [...trip.plans, p] }); setSel(p.id)
        })
      }} />}

      {plan && <PlanView key={plan.id} trip={trip} plan={plan} busy={!!busy}
        onAdopt={() => persist({ ...trip, adoptedPlanId: plan.id })}
        onEarlier={newEnd => run('早めに帰る予定に直しています', async () => {
          const s = await getSettings()
          const last = plan.days.length - 1
          const travel = c.homeTravelMin ?? c.homeTravelEst ?? 0
          const date = plan.days[last].date
          const c2 = { ...c, end: `${date}T${c.endBasis === 'home' ? fromMin(toMin(newEnd) + travel) : newEnd}` }
          const p2 = await scheduleAndValidate(s, c2, { ...plan, days: plan.days.map((d, i) => (i === last ? { ...d, endTime: newEnd } : d)) })
          await persist({ ...trip, conditions: c2, plans: trip.plans.map(x => (x.id === p2.id ? p2 : x)) })
        })}
        onChange={async p => {
          await run('移動時間と営業時間を確認し直しています', async () => {
            const s = await getSettings()
            await replacePlan(await scheduleAndValidate(s, c, p))
          })
        }}
        onOfficial={() => run('公式サイトを確認しています', async (m, pr) => { const s = await getSettings(); await replacePlan(await fetchOfficialInfo(s, plan, m, pr)) })}
        onHotels={() => run('宿を探しています', async (m, pr) => {
          const s = await getSettings()
          await replacePlan(await scheduleAndValidate(s, c, await fetchHotels(s, plan, c, m, pr)))
        })}
        onRegenDay={i => run(`${i + 1}日目を作り直しています`, async (m, pr) => {
          const s = await getSettings(); const areas = (await listAreas()).filter(a => c.areaIds.includes(a.id))
          if (!areas.length) throw new Error('範囲が見つかりません')
          await replacePlan(await regenerateDay(s, trip, plan, i, areas, m, pr))
        })}
        onRegenerate={cc => onRegenerate(cc, trip.name)}
        onDelete={async () => { if (confirm(`「${plan.angle}」を削除しますか`)) { const plans = trip.plans.filter(x => x.id !== plan.id); await persist({ ...trip, plans, adoptedPlanId: trip.adoptedPlanId === plan.id ? null : trip.adoptedPlanId }); setSel(plans[0]?.id ?? '') } }}
      />}
    </section>
  )
}

// ---------------- 1案の表示と調整 ----------------

function PlanView({ trip, plan, busy, onAdopt, onEarlier, onChange, onOfficial, onHotels, onRegenDay, onRegenerate, onDelete }: {
  trip: Trip; plan: Plan; busy: boolean
  onAdopt: () => void; onEarlier: (newEnd: string) => void; onChange: (p: Plan) => void; onOfficial: () => void; onHotels: () => void
  onRegenDay: (i: number) => void; onRegenerate: (c: Conditions) => void; onDelete: () => void
}) {
  const [di, setDi] = useState(0)
  const [areas, setAreas] = useState<MapArea[]>([])
  useEffect(() => { listAreas().then(a => setAreas(a.filter(x => trip.conditions.areaIds.includes(x.id)))) }, [trip.conditions.areaIds])
  const day = plan.days[Math.min(di, plan.days.length - 1)]
  const c = trip.conditions
  const editStops = (fn: (stops: Stop[]) => Stop[]) => onChange({ ...plan, days: plan.days.map((d, i) => (i === di ? { ...d, stops: fn([...d.stops]) } : d)) })
  const routes = useMemo(() => [{ color: PLAN_COLORS[trip.plans.indexOf(plan) % 4] ?? PLAN_COLORS[0], days: [day] }], [day, plan, trip.plans])

  return (
    <div>
      {plan.issues.some(x => x.kind !== 'idle') && <Conflict trip={{ ...trip }} plan={{ ...plan, issues: plan.issues.filter(x => x.kind !== 'idle') }} onRegenerate={onRegenerate} />}
      {plan.issues.filter(x => x.kind === 'idle').map((x, i) => {
        const lastI = plan.days.length - 1
        if (x.dayIndex !== lastI) return <p key={i} className="note">時間の余裕：{x.text}。「この日だけ作り直す」で埋められます。</p>
        // 最終日：玄関口に着いてから20分後以降の便で帰る案
        const d = plan.days[lastI]
        const arrive = toMin(d.endTime) - d.slackMinutes
        const dep = fromMin(Math.ceil((arrive + 20) / 10) * 10)
        const travel = trip.conditions.homeTravelMin ?? trip.conditions.homeTravelEst ?? null
        return <div key={i} className="box">
          <p>時間の余裕：{x.text}。</p>
          <div className="row wrap">
            <button disabled={busy} onClick={() => onEarlier(dep)}>早めに帰る（{trip.conditions.origin?.label ?? '玄関口'} {dep}頃発{travel ? `・家に${fromMin(toMin(dep) + travel)}頃着` : ''}）</button>
            <button disabled={busy} onClick={() => onRegenDay(lastI)}>この日だけ作り直して時間を埋める</button>
          </div>
          <p className="note">早めに帰る場合も、実際の便は乗換案内で確認してください。</p>
        </div>
      })}
      <div className="row wrap">
        {trip.adoptedPlanId !== plan.id && <button className="primary" onClick={onAdopt}>この案を採用</button>}
        <button disabled={busy} onClick={onOfficial}>公式サイトの情報を取得</button>
        <button disabled={busy} onClick={onHotels}>宿を探す</button>
        <button onClick={() => window.print()}>印刷・PDFで保存</button>
        <button className="ghost" onClick={onDelete}>案を削除</button>
      </div>

      <div className="tabs-inline">
        {plan.days.map((d, i) => <button key={d.date} className={i === di ? 'on' : ''} onClick={() => setDi(i)}>{i + 1}日目 {fmtDate(d.date)}</button>)}
      </div>

      <p className="note">移動{day.moveMinutes}分・徒歩{(day.walkMeters / 1000).toFixed(1)}km・空き{day.slackMinutes}分{day.lodgingArea && `・宿泊エリア：${day.lodgingArea}`}</p>

      <ol className="timeline">
        {di === 0 && c.startBasis === 'home' && c.start && <li className="tl-start"><b>{c.start.slice(11, 16)}</b> 家を出る（{c.home ?? '自宅'}）</li>}
        {di === 0 && c.home && c.origin && (c.startBasis === 'home' && c.start
          ? <li className="tl-leg">{c.origin.label} へ：<TransitLinks from={c.home} to={c.origin.label} date={day.date} time={c.start.slice(11, 16)} /> <span className="note">（{c.start.slice(11, 16)}以降に出る便を探す）</span></li>
          : <li className="tl-leg">自宅（{c.home}）から {c.origin.label} へ：<TransitLinks from={c.home} to={c.origin.label} date={day.date} time={day.startTime} byArrival /> <span className="note">（{day.startTime}に着く便を探す）</span></li>)}
        <li className="tl-start"><b>{showTime(day.startTime, day.startApprox)}</b> {di === 0 ? '着' : '出発'}：{day.startPoint.label}{day.startApprox && (c.homeTravelEst ? <span className="note">（家から約{c.homeTravelEst}分の目安：{c.homeTravelSource}）</span> : <span className="err">（家からの所要時間を調べられなかったため、家を出る時刻のまま計算しています（{c.homeTravelSource}）。条件の「片道の所要時間」に入れて作り直してください）</span>)}</li>
        {day.stops.map((st, i) => (
          <StopItem key={st.id} stop={st} leg={day.legs[i]} index={i} count={day.stops.length} dayIssues={plan.issues.filter(x => x.stopId === st.id)}
            onPin={() => editStops(ss => ss.map(x => (x.id === st.id ? { ...x, pinned: !x.pinned } : x)))}
            onMove={d => editStops(ss => { const j = i + d; [ss[i], ss[j]] = [ss[j], ss[i]]; return ss })}
            onRemove={() => editStops(ss => ss.filter(x => x.id !== st.id))}
            onStay={m => editStops(ss => ss.map(x => (x.id === st.id ? { ...x, stayMin: Math.max(15, x.stayMin + m) } : x)))}
            onReplace={cand => { remember(cand); editStops(ss => ss.map(x => (x.id === st.id ? { ...x, placeId: cand.id, official: undefined, googleCoord: { ...cand.location, fetchedAt: new Date().toISOString() } } : x))) }}
            onTransit={tin => editStops(ss => ss.map(x => (x.id === st.id ? { ...x, transitIn: tin } : x)))}
            center={coordOf(st) ?? areas[0]?.center}
          />
        ))}
        {day.lodging && <>
          {day.lodgingLeg && <li className="tl-leg"><LegLine leg={day.lodgingLeg} /> <TransitInput value={day.lodging.transitIn} show={day.lodgingLeg.mode === 'train'} onChange={tin => onChange({ ...plan, days: plan.days.map((d, i) => (i === di ? { ...d, lodging: { ...d.lodging!, transitIn: tin } } : d)) })} /></li>}
          <li className="tl-stop lodging"><div className="stop-head"><b>{showTime(day.lodging.arrive, day.lodging.approx)}</b><span className="kind">宿</span><span className="stop-name">{nameOf(day.lodging)}</span>{day.lodging.pinned && <span className="badge">固定</span>}</div>
            <p className="note">{CHECKIN_BY}までに着く想定。下の「宿の候補」から変えられます</p></li>
        </>}
        {!day.lodging && di < plan.days.length - 1 && <li className="tl-end">宿：未定（「宿を探す」で選べます）</li>}
        {day.returnLeg && <li className="tl-leg"><LegLine leg={day.returnLeg} /></li>}
        {di === plan.days.length - 1 && <li className="tl-end"><b>{showTime(fromMin(toMin(day.endTime) - day.slackMinutes), day.returnApprox)}</b> {c.origin?.label ?? '終点'} 着（{showTime(day.endTime, day.endApprox)}発の予定）</li>}
        {di === plan.days.length - 1 && c.endBasis === 'home' && c.end && <li className="tl-end"><b>{c.end.slice(11, 16)}</b> 家に着く（{c.home ?? '自宅'}）{day.endApprox && <span className="note">（玄関口から約{c.homeTravelEst}分の目安）</span>}</li>}
        {di === plan.days.length - 1 && c.home && c.origin && <li className="tl-leg">{c.origin.label} から自宅へ：<TransitLinks from={c.origin.label} to={c.home} date={day.date} time={day.endTime} /></li>}
      </ol>
      <div className="row"><button disabled={busy} onClick={() => onRegenDay(di)}>この日だけ作り直す（固定した場所は残す）</button></div>

      {day.rainPlan && <p className="box"><b>雨の日の代案：</b>{day.rainPlan}</p>}

      <GoogleRouteMap routes={routes} />

      <PrintPlan trip={trip} plan={plan} />
      {di < plan.days.length - 1 && <Hotels day={day} next={plan.days[di + 1]} adults={c.adults ?? 1} onPick={h => onChange(chooseLodging(plan, di, h))} />}
    </div>
  )
}

function LegLine({ leg }: { leg: Leg }) {
  return <span className="leg">{LEGMODE[leg.mode]} {leg.estimated ? '約' : ''}{leg.minutes}分{leg.meters ? `・${(leg.meters / 1000).toFixed(1)}km` : ''}
    {leg.estimated && <span className="badge warn">推定</span>}
    {leg.transitLinks?.map(l => <a key={l.url} href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}
  </span>
}

function StopItem({ stop, leg, index, count, dayIssues, onPin, onMove, onRemove, onStay, onReplace, onTransit, center }: {
  stop: Stop; leg?: Leg; index: number; count: number; dayIssues: { text: string }[]
  onPin: () => void; onMove: (d: number) => void; onRemove: () => void; onStay: (m: number) => void; onReplace: (c: Candidate) => void; onTransit: (t: Stop['transitIn']) => void; center?: LatLng
}) {
  const live = useLive(stop.placeId)
  const [open, setOpen] = useState(false)
  const [rep, setRep] = useState(false)
  const o = stop.official
  return <>
    {leg && <li className="tl-leg"><LegLine leg={leg} /> <TransitInput value={stop.transitIn} show={leg.mode === 'train'} onChange={onTransit} /></li>}
    <li className={`tl-stop ${dayIssues.length ? 'has-issue' : ''}`}>
      <div className="stop-head" onClick={() => setOpen(!open)}>
        <b>{showTime(stop.arrive, stop.approx)}–{showTime(stop.depart, stop.approx)}</b>
        <span className="kind">{KIND[stop.kind]}</span>
        <span className="stop-name">{nameOf(stop)}</span>
        {stop.pinned && <span className="badge">固定</span>}
      </div>
      {dayIssues.map((x, i) => <p key={i} className="err">{x.text}</p>)}
      {open && <div className="stop-body">
        {o && <div className="official">
          {o.hours && <p>営業時間：{o.hours}</p>}{o.closed && <p>休み：{o.closed}</p>}{o.fee && <p>料金：{o.fee}</p>}{o.highlight && <p>見どころ：{o.highlight}</p>}
          <p className="note">{o.sourceUrl ? <a href={o.sourceUrl} target="_blank" rel="noreferrer">出典</a> : '出典なし'}・{o.checkedAt.slice(0, 10)}確認{o.needsCheck && <span className="badge warn">要確認</span>}</p>
        </div>}
        {live && <div className="google">
          {live.rating && <p>評価 {live.rating}（{live.ratingCount}件）{live.typeLabel && `・${live.typeLabel}`}</p>}
          {live.weekdayText && <details><summary>Googleの営業時間</summary><ul>{live.weekdayText.map(w => <li key={w}>{w}</li>)}</ul></details>}
          <p className="note"><a href={live.mapsUri ?? `https://www.google.com/maps/place/?q=place_id:${stop.placeId}`} target="_blank" rel="noreferrer">Googleマップで開く</a>・情報：Google Maps</p>
        </div>}
        <div className="row wrap">
          <button onClick={onPin}>{stop.pinned ? '固定を外す' : '固定'}</button>
          <button disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
          <button onClick={() => onStay(-15)}>滞在−15分</button>
          <button onClick={() => onStay(15)}>滞在＋15分</button>
          <button onClick={() => setRep(!rep)}>入れ替え</button>
          <button className="ghost" onClick={onRemove}>外す</button>
        </div>
        {rep && center && <ReplaceSearch center={center} onPick={c => { setRep(false); onReplace(c) }} />}
      </div>}
    </li>
  </>
}

function ReplaceSearch({ center, onPick }: { center: LatLng; onPick: (c: Candidate) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Candidate[]>([])
  const [err, setErr] = useState('')
  async function search() {
    setErr('')
    try {
      const s = await getSettings()
      const r = await placesCandidates(s, q, center, 10000, 8)
      r.forEach(remember); setRes(r)
    } catch (e) { setErr((e as Error).message) }
  }
  return <div className="box">
    <div className="row"><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="入れ替え先を探す" /><button onClick={search}>探す</button></div>
    {err && <p className="err">{err}</p>}
    <ul className="list">{res.map(r => <li key={r.id}><button className="link" onClick={() => onPick(r)}>{r.name}</button><span className="note">{r.typeLabel} {r.rating ? `評価${r.rating}` : ''}</span></li>)}</ul>
    {res.length > 0 && <p className="note">情報：Google Maps</p>}
  </div>
}

function TransitLinks({ from, to, date, time, byArrival }: { from: string; to: string; date: string; time: string; byArrival?: boolean }) {
  return <>{transitLinks(from, to, { lat: NaN, lng: NaN }, { lat: NaN, lng: NaN }, date, time, byArrival).filter(l => !l.url.includes('NaN')).map(l => <a key={l.url} className="bk" href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}</>
}

/** 乗換案内で調べた発車・到着時刻を入れる欄。入れるとその先の時刻がそれで計算し直される */
function TransitInput({ value, show, onChange }: { value?: Stop['transitIn']; show: boolean; onChange: (t: Stop['transitIn']) => void }) {
  const [open, setOpen] = useState(false)
  const [dep, setDep] = useState(value?.depart ?? '')
  const [arr, setArr] = useState(value?.arrive ?? '')
  if (!show) return null
  if (!open) return <button className="link small" onClick={() => setOpen(true)}>{value ? `実際の便：${value.depart ?? ''}発→${value.arrive}着（変更）` : '調べた時刻を入れる'}</button>
  return <span className="tin">
    <input type="time" value={dep} onChange={e => setDep(e.target.value)} aria-label="発車" />発→
    <input type="time" value={arr} onChange={e => setArr(e.target.value)} aria-label="到着" />着
    <button disabled={!arr} onClick={() => { setOpen(false); onChange({ depart: dep || undefined, arrive: arr }) }}>反映</button>
    {value && <button className="ghost" onClick={() => { setOpen(false); onChange(undefined) }}>消す</button>}
  </span>
}

/** 印刷用（画面では非表示）。圏外に備えて、全日程を1枚にまとめて紙やPDFにする */
function PrintPlan({ trip, plan }: { trip: Trip; plan: Plan }) {
  const c = trip.conditions
  return <div className="print-only">
    <h1>{trip.name}（{plan.angle}）</h1>
    {plan.days.map((d, i) => <div key={d.date} className="print-day">
      <h2>{i + 1}日目 {fmtDate(d.date)}</h2>
      <table><tbody>
        {i === 0 && c.home && <tr><td></td><td>自宅（{c.home}）→ {d.startPoint.label}（乗換案内で確認）</td></tr>}
        <tr><td>{d.startTime}</td><td>{i === 0 ? '着' : '出発'}：{d.startPoint.label}</td></tr>
        {d.stops.map((st, j) => <tr key={st.id}><td>{showTime(st.arrive, st.approx)}</td><td>{d.legs[j] ? `（${LEGMODE[d.legs[j].mode]} ${d.legs[j].estimated ? '約' : ''}${d.legs[j].minutes}分${st.transitIn ? `・${st.transitIn.depart ?? ''}発→${st.transitIn.arrive}着` : ''}）` : ''} <b>{nameOf(st)}</b>（{st.stayMin}分）{st.official?.hours ? `　営業：${st.official.hours}` : ''}</td></tr>)}
        {d.lodging && <tr><td>{showTime(d.lodging.arrive, d.lodging.approx)}</td><td>宿：<b>{nameOf(d.lodging)}</b></td></tr>}
        {i === plan.days.length - 1 && <tr><td>{d.endTime}</td><td>{c.origin?.label ?? ''} 発{c.home ? ` → 自宅（${c.home}）` : ''}</td></tr>}
      </tbody></table>
      {d.rainPlan && <p>雨の日：{d.rainPlan}</p>}
    </div>)}
    <p className="note">「頃」の付いた時刻は推定です。電車・バスは乗換案内で確認してください。</p>
  </div>
}

// ---------------- 宿 ----------------

function Hotels({ day, next, adults, onPick }: { day: Day; next: Day; adults: number; onPick: (h: Candidate) => void }) {
  const google = day.hotels.filter(h => h.source === 'google')
  const rakuten = day.hotels.filter(h => h.source === 'rakuten')
  const areaWord = day.lodgingArea ?? '宿泊エリア'
  return <div className="box">
    <h3>宿の候補（{fmtDate(day.date)}泊）</h3>
    {!day.hotelsFetchedAt && <p className="note">「宿を探す」で、この日の最後の立ち寄り先から3km以内の宿を探します</p>}
    {day.hotelsFetchedAt && google.length === 0 && rakuten.length === 0 && <p className="note">宿が見つかりませんでした（半径3km）</p>}
    {google.length > 0 && <ul className="list hotels">{google.map(h => <GoogleHotel key={h.placeId} placeId={h.placeId!} checkin={day.date} checkout={next.date} adults={adults} chosen={day.lodging?.placeId === h.placeId} onPick={onPick} />)}</ul>}
    {google.length > 0 && <p className="note">情報：Google Maps。空室と料金は各予約サイトで確認してください。</p>}
    {rakuten.length > 0 && <>
      <h3>楽天トラベルの空室</h3>
      <ul className="list">{rakuten.map(h => <li key={h.hotelNo}><a href={h.url} target="_blank" rel="noreferrer">{h.name}</a><span className="note">{h.minCharge ? `${h.minCharge.toLocaleString()}円〜` : ''}</span></li>)}</ul>
      <p className="note">{day.hotelsFetchedAt!.slice(0, 16).replace('T', ' ')} 時点の空き状況</p>
      <p className="credit"><a href="https://developers.rakuten.com/" target="_blank" rel="noreferrer">Supported by Rakuten Developers</a></p>
    </>}
    {day.lodgingArea && <p className="note">エリアで探す（{areaWord}）：{bookingLinks(day.lodgingArea, day.date, next.date, adults).map(l => <a key={l.url} className="bk" href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}</p>}
  </div>
}

function GoogleHotel({ placeId, checkin, checkout, adults, chosen, onPick }: { placeId: string; checkin: string; checkout: string; adults: number; chosen: boolean; onPick: (h: Candidate) => void }) {
  const live = useLive(placeId)
  if (!live) return <li className="note">（宿の情報はオンライン時に表示します）</li>
  return <li className="hotel">
    <div><b>{live.name}</b> {chosen ? <span className="badge">この宿で計画中</span> : <button className="link small" onClick={() => onPick(live)}>ここに泊まる</button>} <span className="note">{live.typeLabel ?? ''}{live.rating ? `・評価${live.rating}（${live.ratingCount}件）` : ''}{live.priceLevel ? `・${PRICE[live.priceLevel] ?? ''}` : ''}</span></div>
    <div className="note">{bookingLinks(live.name, checkin, checkout, adults).map(l => <a key={l.url} className="bk" href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}<a className="bk" href={live.mapsUri ?? `https://www.google.com/maps/place/?q=place_id:${placeId}`} target="_blank" rel="noreferrer">Googleマップ</a></div>
  </li>
}

const PRICE: Record<string, string> = { PRICE_LEVEL_INEXPENSIVE: '価格帯：安め', PRICE_LEVEL_MODERATE: '価格帯：中', PRICE_LEVEL_EXPENSIVE: '価格帯：高め', PRICE_LEVEL_VERY_EXPENSIVE: '価格帯：かなり高め' }

// ---------------- 破綻の提示 ----------------

function Conflict({ trip, plan, onRegenerate }: { trip: Trip; plan: Plan; onRegenerate: (c: Conditions) => void }) {
  const c = trip.conditions
  const musts = c.wishes.filter(w => w.priority === 'must')
  const mustRelated = plan.issues.some(i => i.kind === 'missing_must') || plan.issues.some(i => i.stopId && musts.some(m => m.placeId && plan.days.some(d => d.stops.some(s => s.id === i.stopId && s.placeId === m.placeId))))
  const extendOneDay = (): Conditions => {
    const end = c.end ?? `${plan.days.at(-1)!.date}T${plan.days.at(-1)!.endTime}`
    const d = new Date(end.slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
    return { ...c, end: `${d.toISOString().slice(0, 10)}${end.slice(10)}` }
  }
  return <div className="box warn-box">
    <h3>{plan.attempts > 1 ? `${plan.attempts - 1}回組み直しても解消しなかった点` : '検証で見つかった点'}</h3>
    <ul>{plan.issues.map((x, i) => <li key={i}>{x.text}</li>)}</ul>
    {mustRelated && <>
      <p>必須同士が両立しない可能性があります。どれかを選ぶと、条件を変えて作り直します。</p>
      <div className="row wrap">
        <button onClick={() => onRegenerate(extendOneDay())}>日を分ける（1日延ばす）</button>
        {musts.map(m => <button key={m.id} onClick={() => onRegenerate({ ...c, wishes: c.wishes.map(w => (w.id === m.id ? { ...w, priority: 'want' } : w)) })}>「{m.text}」をできればに下げる</button>)}
      </div>
    </>}
    {!mustRelated && <p className="note">固定・入れ替え・順番の変更・「この日だけ作り直す」で調整できます。</p>}
  </div>
}

// ---------------- 比較 ----------------

function Compare({ trip, onCombine }: { trip: Trip; onCombine: (picks: string[]) => void }) {
  const plans = trip.plans
  const nDays = Math.min(...plans.map(p => p.days.length))
  const [picks, setPicks] = useState<string[]>(() => Array.from({ length: nDays }, () => plans[0].id))
  const routes = useMemo(() => plans.map((p, i) => ({ color: PLAN_COLORS[i % 4], days: p.days })), [plans])
  const wishes = trip.conditions.wishes.filter(w => w.priority === 'must' || w.priority === 'want')
  const sum = (p: Plan, f: (d: Day) => number) => p.days.reduce((a, d) => a + f(d), 0)
  const evText = (p: Plan) => {
    const names = p.days.flatMap(d => d.stops.map(nameOf))
    return trip.events.filter(e => names.some(n => n && (e.place?.includes(n) || e.title.includes(n)))).map(e => e.title).join('、') || '—'
  }
  return <div>
    <div className="scroll-x">
      <table className="cmp">
        <thead><tr><th></th>{plans.map((p, i) => <th key={p.id}><i className="dot" style={{ background: PLAN_COLORS[i % 4] }} />{p.angle}</th>)}</tr></thead>
        <tbody>
          <tr><th>検証</th>{plans.map(p => <td key={p.id}>{p.status === 'ok' ? '通過' : `要対応${p.issues.length}件`}</td>)}</tr>
          {wishes.map(w => <tr key={w.id}><th>{w.priority === 'must' ? '必須' : 'できれば'}：{w.text}</th>{plans.map(p => <td key={p.id}>{p.wishHits[w.id] ? '○' : '×'}</td>)}</tr>)}
          <tr><th>移動の合計</th>{plans.map(p => <td key={p.id}>{sum(p, d => d.moveMinutes)}分</td>)}</tr>
          <tr><th>1日の徒歩</th>{plans.map(p => <td key={p.id}>{p.days.map(d => (d.walkMeters / 1000).toFixed(1)).join(' / ')} km</td>)}</tr>
          <tr><th>各日の空き</th>{plans.map(p => <td key={p.id}>{p.days.map(d => d.slackMinutes).join(' / ')} 分</td>)}</tr>
          <tr><th>立ち寄り数</th>{plans.map(p => <td key={p.id}>{p.days.map(d => d.stops.length).join(' / ')}</td>)}</tr>
          <tr><th>入場料など</th>{plans.map(p => <td key={p.id}>{p.days.flatMap(d => d.stops).filter(s => s.official?.fee).map(s => `${s.official!.name}：${s.official!.fee}`).join('、') || '公式情報の取得後に表示'}</td>)}</tr>
          <tr><th>宿</th>{plans.map(p => <td key={p.id}>{p.days.slice(0, -1).map(d => { if (!d.hotelsFetchedAt) return '未検索'; const yen = d.hotels.map(h => h.minCharge).filter((x): x is number => !!x); return `${d.hotels.length}件${yen.length ? `（楽天${Math.min(...yen).toLocaleString()}円〜）` : ''}` }).join(' / ') || '日帰り'}</td>)}</tr>
          <tr><th>見頃・イベント</th>{plans.map(p => <td key={p.id}>{evText(p)}</td>)}</tr>
        </tbody>
      </table>
    </div>
    <p className="note">交通費は乗換案内で確認してください。食事の予算帯は入力した希望に沿って選んでいます。</p>
    <GoogleRouteMap routes={routes} height={360} />
    {nDays > 1 && <div className="box">
      <h3>日ごとに案を選んで組み合わせる</h3>
      {picks.map((pid, i) => <label key={i}>{i + 1}日目
        <select value={pid} onChange={e => setPicks(ps => ps.map((x, j) => (j === i ? e.target.value : x)))}>{plans.map(p => <option key={p.id} value={p.id}>{p.angle}</option>)}</select>
      </label>)}
      <button className="primary" onClick={() => onCombine(picks)}>組み合わせて検証する</button>
    </div>}
  </div>
}

