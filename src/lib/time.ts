export const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`
/** 'YYYY-MM-DD' の曜日（0=日曜） */
export const dow = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
export const addDays = (date: string, n: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
export const daysBetween = (a: string, b: string) => {
  const out: string[] = []
  for (let d = a; d <= b && out.length < 14; d = addDays(d, 1)) out.push(d)
  return out
}
const W = ['日', '月', '火', '水', '木', '金', '土']
export const fmtDate = (date: string) => { const [, m, d] = date.split('-').map(Number); return `${m}/${d}（${W[dow(date)]}）` }
export const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
