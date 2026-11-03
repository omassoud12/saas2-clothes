// Owner Dashboard: the small pieces of arithmetic the screens show (API calls are in owner-api.js).
// Every number comes from the backend (one source of truth); the only math done here is for display
// (percent of a bar) and the live "= $8.00 each" preview, which uses the server's rounding rule.

export const BEST_SELLER_PERIODS = Object.freeze(['today', 'week', 'month'])
export const QUANTITY_CHIPS = Object.freeze([1, 6, 12, 24])

/** useAsync result → { kind: loading | error | ready } (the last data stays while the next one loads). */
export function asState({ data, error, loading }) {
  if (error) return { kind: 'error', message: error.message }
  if (data && !loading) return { kind: 'ready', body: data }
  return data ? { kind: 'ready', body: data, refreshing: true } : { kind: 'loading' }
}

const MONEY = /^(?:0|[1-9]\d{0,13})(?:[.,]\d{1,2})?$/

/** "1,250.5" style input → "1250.50", or null when it is not a valid positive amount. */
export function normalizeMoneyInput(value) {
  const text = String(value ?? '').trim().replace(/[\s٬]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  if (!MONEY.test(text)) return null
  const amount = Number(text.replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null
  return amount.toFixed(2)
}

/** Whole cents, half up, without floating point drift: "96.00" / 12 → "8.00". */
export function unitCostPreview(totalCost, quantity) {
  const total = normalizeMoneyInput(totalCost)
  if (!total || !Number.isInteger(quantity) || quantity < 1) return null
  const cents = BigInt(total.replace('.', ''))
  const q = BigInt(quantity)
  const rounded = (cents * 2n + q) / (2n * q)
  return `${rounded / 100n}.${String(rounded % 100n).padStart(2, '0')}`
}

/** An amount typed in LBP → USD with the account rate (2 decimals), or null. */
export function lbpToUsd(lbp, rate) {
  const amount = normalizeMoneyInput(lbp)
  const perUsd = Number(rate)
  if (!amount || !Number.isFinite(perUsd) || perUsd <= 0) return null
  const usd = Math.round((Number(amount) / perUsd) * 100) / 100
  return usd > 0 ? usd.toFixed(2) : null
}

/** Progress bar of the monthly target: fill and pace tick in percent (0–100). */
export function targetBar(target, salesTotal) {
  if (!target) return null
  const amount = Number(target.amount)
  if (!(amount > 0)) return null
  const sales = Number(salesTotal) || 0
  return {
    fill: Math.min(100, (sales / amount) * 100),
    pace: Math.min(100, (Number(target.expectedByToday) / amount) * 100),
    percent: Math.round((sales / amount) * 100),
    gap: sales - Number(target.expectedByToday),
  }
}

/** Best sellers for a ranking mode (sales / quantity / profit), biggest first. */
export function rankProducts(items, mode) {
  const value = (item) => mode === 'quantity' ? item.quantity : Number(mode === 'profit' ? item.profitTotal : item.salesTotal) || 0
  return [...(items || [])].sort((a, b) => value(b) - value(a) || Number(b.salesTotal) - Number(a.salesTotal))
}

/** The month's money in the order the owner reads it: sales − cost = gross profit − expenses = net profit. */
export function monthMoney(month) {
  if (!month || month.profitTotal === null || month.profitTotal === undefined) return null
  const sales = Number(month.salesTotal)
  const profit = Number(month.profitTotal)
  return { sales, cost: sales - profit, profit, expenses: Number(month.expensesTotal ?? 0), net: Number(month.netProfit ?? profit) }
}

/** The month a target is for: the current shop month from the summary. */
export function monthLabel(month, locale) {
  const [year, value] = String(month).split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, value - 1, 1)))
}
