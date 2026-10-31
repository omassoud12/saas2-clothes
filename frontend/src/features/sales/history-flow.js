// Pure helpers for the Sales history page: which dates and status the filters mean, and how rows are described.

export const HISTORY_PAGE_SIZE = 25

export const HISTORY_RANGES = Object.freeze([
  Object.freeze({ id: 'today', label: 'Today' }),
  Object.freeze({ id: 'yesterday', label: 'Yesterday' }),
  Object.freeze({ id: 'week', label: 'This week' }),
  Object.freeze({ id: 'custom', label: 'Custom' }),
])

export const HISTORY_STATUSES = Object.freeze([
  Object.freeze({ id: 'all', label: 'All' }),
  Object.freeze({ id: 'completed', label: 'Completed' }),
  Object.freeze({ id: 'voided', label: 'Voided' }),
  Object.freeze({ id: 'returned', label: 'Returned' }),
  Object.freeze({ id: 'unpaid', label: 'Unpaid debts' }),
])

export const HISTORY_PAYMENTS = Object.freeze([
  Object.freeze({ id: 'all', label: 'All payments' }),
  Object.freeze({ id: 'CASH', label: 'Cash' }),
  Object.freeze({ id: 'CARD', label: 'Card' }),
  Object.freeze({ id: 'WHISH_OMT', label: 'Whish / OMT' }),
  Object.freeze({ id: 'DEBT', label: 'Debt' }),
])

const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
const pad = (value) => String(value).padStart(2, '0')

// The week starts on Monday.
export function startOfWeek(now = new Date()) {
  const day = dayStart(now)
  return addDays(day, -((day.getDay() + 6) % 7))
}

// "2026-10-31" from a date input, as a local date; null when it is not a real calendar day.
export function parseDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value : '')
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

export function dateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function statusQuery(status) {
  if (status === 'completed') return { status: 'COMPLETED' }
  if (status === 'voided') return { status: 'VOIDED' }
  if (status === 'returned') return { returned: true }
  if (status === 'unpaid') return { unpaid: true }
  return {}
}

// The server query for the chosen filters. Dates are the shop's local days, sent as exact instants.
export function historyQuery({ range, status = 'all', payment = 'all', customFrom = '', customTo = '', now = new Date() }) {
  if (!HISTORY_STATUSES.some((item) => item.id === status)) return Object.freeze({ ok: false, message: 'Choose a valid status.' })
  if (!HISTORY_PAYMENTS.some((item) => item.id === payment)) return Object.freeze({ ok: false, message: 'Choose a valid payment method.' })
  if (status === 'unpaid' && payment !== 'all' && payment !== 'DEBT') return Object.freeze({ ok: false, message: 'Unpaid debts are always paid by debt. Choose All payments or Debt.' })
  const today = dayStart(now)
  let from
  let to = null
  if (range === 'today') from = today
  else if (range === 'yesterday') { from = addDays(today, -1); to = new Date(today.getTime() - 1) }
  else if (range === 'week') from = startOfWeek(now)
  else if (range === 'custom') {
    const start = parseDateInput(customFrom)
    const end = parseDateInput(customTo)
    if (!start || !end) return Object.freeze({ ok: false, message: 'Choose a start date and an end date.' })
    if (start > end) return Object.freeze({ ok: false, message: 'The start date must not be after the end date.' })
    from = start
    to = new Date(addDays(end, 1).getTime() - 1)
  } else return Object.freeze({ ok: false, message: 'Choose a valid period.' })
  return Object.freeze({ ok: true, query: Object.freeze({ from: from.toISOString(), ...(to ? { to: to.toISOString() } : {}), ...statusQuery(status), ...(payment !== 'all' && status !== 'unpaid' ? { paymentMethod: payment } : {}) }) })
}

// Today and yesterday show only the time; longer periods also show the day.
export function saleTimeText(iso, { withDay = false, locale } = {}) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return withDay ? `${date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}` : time
}

// Small labels shown on a row: a voided sale, a sale that has returns, and how it was paid (a debt shows if it is still open).
export function saleBadges(sale) {
  return [
    ...(sale.status === 'VOIDED' ? [Object.freeze({ tone: 'is-void', text: 'Voided' })] : []),
    ...(sale.hasReturns === true ? [Object.freeze({ tone: 'is-returned', text: 'Returned' })] : []),
    ...(sale.paymentMethod === 'DEBT'
      ? [Object.freeze(sale.paidAt ? { tone: 'is-paid', text: 'Debt paid' } : { tone: 'is-debt', text: 'Unpaid debt' })]
      : sale.paymentMethod && sale.paymentMethod !== 'CASH' ? [Object.freeze({ tone: 'is-method', text: sale.paymentMethod === 'CARD' ? 'Card' : 'Whish / OMT' })] : []),
  ]
}
