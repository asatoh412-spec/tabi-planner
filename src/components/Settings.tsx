import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '../db'
import { BUILD, hardUpdate } from '../lib/update'
import type { Settings as S } from '../types'
import { claudeMessage, gsiGeocode, placesTextSearch, rakutenVacant, routesCompute } from '../api/clients'

type Result = { ok: boolean; text: string }

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export default function Settings() {
  const [s, setS] = useState<S | null>(null)
  const [saved, setSaved] = useState(false)
  const [res, setRes] = useState<Record<string, Result>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => { getSettings().then(setS) }, [])
  if (!s) return null

  const set = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => { setS({ ...s, [k]: e.target.value.trim() }); setSaved(false) }

  async function runTests() {
    if (!s) return
    await saveSettings(s); setSaved(true); setBusy(true); setRes({})
    // 弘前城付近と弘前駅（テスト用の固定地点）
    const castle = { lat: 40.6077, lng: 140.4637 }, station = { lat: 40.5986, lng: 140.4851 }
    const put = (k: string, r: Result) => setRes(prev => ({ ...prev, [k]: r }))
    const tests: [string, () => Promise<string>][] = [
      ['国土地理院 住所検索', async () => { const r = await gsiGeocode('青森県弘前市下白銀町1'); return `${r.length}件: ${r[0]?.title ?? ''}` }],
      ['Places（場所IDのみ・無料）', async () => { const r = await placesTextSearch(s, '弘前城', castle, 2000); return `${r.places?.length ?? 0}件` }],
      ['Routes 徒歩', async () => { const r = await routesCompute(s, station, castle, 'WALK'); const x = r.routes?.[0]; return x ? `${Math.round(parseInt(x.duration) / 60)}分・${x.distanceMeters}m` : '経路なし' }],
      ['Routes 電車（日本は対象外の想定）', async () => { const r = await routesCompute(s, station, { lat: 40.8222, lng: 140.7474 }, 'TRANSIT'); const x = r.routes?.[0]; return x ? `経路あり ${Math.round(parseInt(x.duration) / 60)}分` : '経路なし（想定どおり）' }],
      ['Claude', async () => { const r = await claudeMessage(s, '「接続OK」とだけ返してください。'); return `${r.content.find(c => c.type === 'text')?.text ?? ''}（入力${r.usage.input_tokens}・出力${r.usage.output_tokens}トークン）` }],
      ['楽天トラベル空室検索（任意）', async () => { if (!s.rakutenAppId) return '未設定（宿はGoogleと予約サイトへのリンクで探します）'; const d = new Date(Date.now() + 30 * 864e5); const r = await rakutenVacant(s, castle, 3, ymd(d), ymd(new Date(d.getTime() + 864e5))); return `${r.hotels.length}件: ${r.hotels[0]?.hotelName ?? '（空室なし）'}` }],
    ]
    for (const [k, fn] of tests) {
      try { put(k, { ok: true, text: await fn() }) } catch (e) { put(k, { ok: false, text: (e as Error).message }) }
    }
    setBusy(false)
  }

  return (
    <section className="page">
      <h1>設定</h1>
      <p className="note">キーはこの端末の中にだけ保存されます。Googleのキーは、Google Cloudの管理画面でこのサイトのドメインに制限してください。</p>
      <label>Google Maps Platform APIキー<input type="password" value={s.googleKey} onChange={set('googleKey')} autoComplete="off" /></label>
      <label>Claude APIキー<input type="password" value={s.anthropicKey} onChange={set('anthropicKey')} autoComplete="off" /></label>
      <label>Claudeのモデル<input value={s.claudeModel} onChange={set('claudeModel')} /></label>
      <h2>いつもの条件（新しい旅行の初期値）</h2>
      <label>自宅（最寄り駅など）<input value={s.home ?? ''} onChange={e => { setS({ ...s, home: e.target.value }); setSaved(false) }} placeholder="例：中野駅" /></label>
      <div className="grid2">
        <label>いつもの家を出る時刻<input type="time" value={s.leaveTime ?? '07:00'} onChange={e => { setS({ ...s, leaveTime: e.target.value }); setSaved(false) }} /></label>
        <label>いつもの家に着く時刻<input type="time" value={s.returnTime ?? '21:00'} onChange={e => { setS({ ...s, returnTime: e.target.value }); setSaved(false) }} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={s.homeTravelBasis ?? true} onChange={e => { setS({ ...s, homeTravelBasis: e.target.checked }); setSaved(false) }} />時刻は「家を出る・家に着く」で入れる</label>
      <label>いつもの移動手段
        <select value={s.defaultMode ?? ''} onChange={e => { setS({ ...s, defaultMode: (e.target.value || null) as S['defaultMode'] }); setSaved(false) }}>
          <option value="">おまかせ</option><option value="train">電車中心</option><option value="car">車</option><option value="walk_transit">徒歩＋公共交通</option>
        </select></label>
      <label>いつものペース
        <select value={s.defaultPace ?? ''} onChange={e => { setS({ ...s, defaultPace: (e.target.value || null) as S['defaultPace'] }); setSaved(false) }}>
          <option value="">おまかせ</option><option value="relaxed">ゆったり</option><option value="standard">標準</option><option value="packed">詰め込み</option>
        </select></label>
      <label>人数<input type="number" min={1} max={10} value={s.defaultAdults ?? ''} onChange={e => { setS({ ...s, defaultAdults: e.target.value ? Number(e.target.value) : null }); setSaved(false) }} placeholder="1" /></label>
      <h2>APIと動作</h2>
      <label>組み直しの上限回数<input type="number" min={0} max={5} value={s.maxRepair} onChange={e => { setS({ ...s, maxRepair: Number(e.target.value) }); setSaved(false) }} /></label>
      <label>楽天 アプリID<input value={s.rakutenAppId} onChange={set('rakutenAppId')} autoComplete="off" /></label>
      <label>楽天 アクセスキー<input type="password" value={s.rakutenAccessKey} onChange={set('rakutenAccessKey')} autoComplete="off" /></label>
      <div className="row">
        <button onClick={async () => { await saveSettings(s); setSaved(true) }}>保存</button>
        <button className="primary" disabled={busy} onClick={runTests}>{busy ? '確認中…' : '保存して接続テスト'}</button>
        {saved && <span className="note">保存しました</span>}
      </div>
      {Object.keys(res).length > 0 && (
        <table className="tests">
          <tbody>
            {Object.entries(res).map(([k, r]) => (
              <tr key={k}><td>{r.ok ? '✓' : '✗'}</td><td>{k}</td><td className={r.ok ? '' : 'err'}>{r.text}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <Transfer current={s} onImport={async x => { await saveSettings(x); setS(x); setSaved(true) }} />
      <div className="box">
        <h3>アプリの版</h3>
        <p className="note">この端末の版：{BUILD.slice(0, 16).replace('T', ' ')}（UTC）。表示がおかしいときは下のボタンで更新してください。サイトのデータを消す必要はなく、キーや旅行は残ります。</p>
        <button onClick={hardUpdate}>最新の版に更新する</button>
      </div>
      <p className="credit"><a href="https://developers.rakuten.com/" target="_blank" rel="noreferrer">Supported by Rakuten Developers</a></p>
    </section>
  )
}

/** 設定（キー・いつもの条件）を別の端末に移す。文字列にして、移す先で貼り付ける */
function Transfer({ current, onImport }: { current: S; onImport: (s: S) => void }) {
  const [code, setCode] = useState('')
  const [inp, setInp] = useState('')
  const [msg, setMsg] = useState('')
  const enc = (o: unknown) => 'tabi1:' + btoa(unescape(encodeURIComponent(JSON.stringify(o))))
  const dec = (t: string) => JSON.parse(decodeURIComponent(escape(atob(t.trim().replace(/^tabi1:/, '')))))
  return <div className="box">
    <h3>設定を別の端末に移す</h3>
    <p className="note">キーといつもの条件を1つの文字列にします。移す先の端末の「読み込む」に貼り付けてください。文字列にはAPIキーが入っているので、自分宛てのメモやメールなど、他人に見えない方法で送ってください。</p>
    <div className="row wrap">
      <button onClick={() => { setCode(enc(current)); setMsg('') }}>書き出す</button>
      {code && <button onClick={async () => { try { await navigator.clipboard.writeText(code); setMsg('コピーしました') } catch { setMsg('コピーできませんでした。下の文字列を選んでコピーしてください') } }}>コピー</button>}
    </div>
    {code && <textarea readOnly value={code} rows={3} onFocus={e => e.target.select()} />}
    <label>読み込む<textarea value={inp} onChange={e => setInp(e.target.value)} rows={3} placeholder="tabi1:… を貼り付け" /></label>
    <button disabled={!inp.trim()} onClick={() => { try { const x = dec(inp) as S; if (typeof x !== 'object' || !('googleKey' in x)) throw new Error(); onImport({ ...current, ...x }); setInp(''); setMsg('読み込みました') } catch { setMsg('読み込めませんでした（文字列が途中で切れていないか確認してください）') } }}>読み込む</button>
    {msg && <p className="note">{msg}</p>}
  </div>
}
