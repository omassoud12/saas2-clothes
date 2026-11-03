// Shop-local calendar helpers for the business reports. Dates are plain "YYYY-MM-DD" strings (shop-local
// calendar days); day boundaries themselves are always computed in Postgres with AT TIME ZONE.

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const monthPattern = /^\d{4}-\d{2}$/
const yearPattern = /^\d{4}$/

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && datePattern.test(value) && !value.startsWith('0000')
    && utcDate(value).toISOString().slice(0, 10) === value
}

export function isCalendarMonth(value: unknown): value is string {
  if (typeof value !== 'string' || !monthPattern.test(value)) return false
  const month = Number(value.slice(5, 7))
  return month >= 1 && month <= 12 && !value.startsWith('0000')
}

export function isCalendarYear(value: unknown): value is string {
  return typeof value === 'string' && yearPattern.test(value) && value !== '0000'
}

export function shiftDate(date: string, days: number): string {
  const value = utcDate(date)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function shiftMonth(month: string, months: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, monthNumber! - 1 + months, 1)).toISOString().slice(0, 7)
}

export function monthDates(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate()
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let date = from; date <= to; date = shiftDate(date, 1)) out.push(date)
  return out
}

/** ISO weekday: Monday 1 … Sunday 7. */
export function isoWeekday(date: string): number {
  const day = utcDate(date).getUTCDay()
  return day === 0 ? 7 : day
}

/** The Monday on or before `date` (weeks run Monday to Sunday). */
export function mondayOf(date: string): string {
  return shiftDate(date, 1 - isoWeekday(date))
}

export interface ShopNow {
  readonly date: string
  /** Minutes after local midnight. */
  readonly minute: number
  readonly hhmm: string
}

/** The shop's current local date and time. Throws RangeError for an unknown timezone. */
export function shopNow(timezone: string, now: Date = new Date()): ShopNow {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    hhmm: `${parts.hour}:${parts.minute}`,
  }
}
