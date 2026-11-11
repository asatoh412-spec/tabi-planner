import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '../db'
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
      <p className="credit"><a href="https://developers.rakuten.com/" target="_blank" rel="noreferrer">Supported by Rakuten Developers</a></p>
    </section>
  )
}
