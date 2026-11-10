import type { OpenPeriod } from '../api/clients'

const WEEK = 7 * 1440

/** Places の regularOpeningHours.periods で、指定曜日の [start,end] 分が営業時間内か */
export function checkOpen(periods: OpenPeriod[] | undefined, day: number, start: number, end: number): { ok: boolean; unknown?: boolean; reason?: string } {
  if (!periods || periods.length === 0) return { ok: true, unknown: true }
  // 24時間営業（open: 日曜0:00 のみで close なし）
  if (periods.length === 1 && !periods[0].close) return { ok: true }
  const spans = periods.map(p => {
    const o = p.open.day * 1440 + p.open.hour * 60 + p.open.minute
    let c = p.close ? p.close.day * 1440 + p.close.hour * 60 + p.close.minute : o + 1440
    if (c <= o) c += WEEK
    return [o, c] as const
  })
  const s = day * 1440 + start, e = day * 1440 + end
  for (const shift of [0, WEEK, -WEEK]) {
    if (spans.some(([o, c]) => o <= s + shift && e + shift <= c)) return { ok: true }
  }
  const todays = spans.filter(([o]) => Math.floor(o / 1440) === day)
  if (todays.length === 0) return { ok: false, reason: '定休日' }
  const first = Math.min(...todays.map(([o]) => o)) - day * 1440
  const last = Math.max(...todays.map(([, c]) => c)) - day * 1440
  if (start < first) return { ok: false, reason: `開店前に到着（${fmt(first)}開店）` }
  if (end > last) return { ok: false, reason: `閉店・閉館後まで滞在（${fmt(last)}まで）` }
  return { ok: false, reason: '休憩時間にかかる' }
}
const fmt = (m: number) => `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`
