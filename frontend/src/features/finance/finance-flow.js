import { authenticatedApiRequest } from '../../auth/owner-flow.js'
import { decimalToMinorUnits, minorUnitsToDecimal } from '../../lib/money.js'

const currencyPattern = /^[A-Z]{3}$/
const signedMoneyPattern = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
const unsignedMoneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const reportMoneyFields = Object.freeze([
  'grossRevenue', 'returnedRevenue', 'voidedRevenue', 'netRevenue',
  'grossCOGS', 'returnedCOGS', 'voidedCOGS', 'netCOGS',
  'grossProfit', 'operatingExpenses', 'netProfit',
])
const costFields = new Set(['grossCOGS', 'returnedCOGS', 'voidedCOGS', 'netCOGS', 'grossProfit', 'netProfit'])
const reportMagnitudeFields = Object.freeze([
  'grossRevenue', 'returnedRevenue', 'voidedRevenue',
  'grossCOGS', 'returnedCOGS', 'voidedCOGS', 'operatingExpenses',
])

function error(code, message) {
  return Object.freeze({ ok: false, code, message })
}

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function isBusinessDate(value) {
  const match = typeof value === 'string' ? datePattern.exec(value) : null
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

export function localBusinessDate(date = new Date()) {
  const year = date.getFullYear().toString().padStart(4, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateOrdinal(value) {
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

export function validateBusinessDateRange(from, to, maximumDays = 366) {
  if (!isBusinessDate(from) || !isBusinessDate(to)) return error('INVALID_DATE', 'Choose valid from and to dates.')
  const daysCount = dateOrdinal(to) - dateOrdinal(from) + 1
  if (daysCount < 1) return error('INVALID_DATE_ORDER', 'The from date must be on or before the to date.')
  if (daysCount > maximumDays) return error('DATE_RANGE_TOO_LONG', `Choose a range of ${maximumDays} days or fewer.`)
  return Object.freeze({ ok: true, daysCount })
}

export function buildExpensePayload(input) {
  const amount = typeof input?.amount === 'string' ? input.amount.trim() : ''
  const minorUnits = decimalToMinorUnits(amount, 2)
  if (minorUnits === null || minorUnits <= 0n || amount.split('.')[0].length > 16) {
    return error('INVALID_EXPENSE_AMOUNT', 'Enter a positive amount with no more than two decimal places.')
  }
  const description = typeof input?.description === 'string' ? input.description.normalize('NFC').trim() : ''
  if (!description || description.length > 2000) return error('INVALID_EXPENSE_DESCRIPTION', 'Enter a description of 2,000 characters or fewer.')
  if (!isBusinessDate(input?.expenseDate)) return error('INVALID_EXPENSE_DATE', 'Choose a valid expense date.')
  return Object.freeze({
    ok: true,
    payload: Object.freeze({ amount: minorUnitsToDecimal(minorUnits, 2), description, expenseDate: input.expenseDate }),
  })
}

function safeFailure(result, fallback) {
  if (result.code === 'SESSION_REQUIRED' || result.status === 401) return { ok: false, requiresLogin: true, message: 'Your session has expired. Sign in again.' }
  if (result.status === 403 && ['ACCOUNT_PENDING', 'ACCOUNT_REJECTED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_NOT_ACTIVE'].includes(result.code)) {
    return { ok: false, requiresAccountReview: true, message: 'Your store is not currently active.' }
  }
  if (result.status === 403) return { ok: false, forbidden: true, message: 'Only the store owner can access financial information.' }
  if (result.status === 429) return { ok: false, retryAfterSeconds: result.retryAfterSeconds, message: result.message }
  if (result.status === 422) return { ok: false, message: 'Check the entered dates and values, then try again.' }
  return { ok: false, message: fallback }
}

function expenseIsValid(expense) {
  return typeof expense?.id === 'string' && unsignedMoneyPattern.test(expense.amount) &&
    currencyPattern.test(expense.currency) && typeof expense.description === 'string' &&
    isBusinessDate(expense.expenseDate) && typeof expense.createdAt === 'string'
}

function expenseQuery(filters) {
  const query = new URLSearchParams()
  for (const key of ['from', 'to', 'cursor', 'limit']) {
    if (filters?.[key] !== undefined && filters[key] !== null && filters[key] !== '') query.set(key, String(filters[key]))
  }
  return query.toString()
}

export async function listExpenses({ supabase, fetchImpl = globalThis.fetch, filters = {} }) {
  const result = await authenticatedApiRequest({ supabase, fetchImpl, path: `/api/expenses?${expenseQuery(filters)}`, method: 'GET', fallbackMessage: 'Expense history is unavailable.' })
  if (!result.ok) return safeFailure(result, 'Expense history is unavailable. Please try again.')
  if (result.status !== 200 || !Array.isArray(result.data?.expenses) || !result.data.expenses.every(expenseIsValid) ||
      !(result.data.nextCursor === null || typeof result.data.nextCursor === 'string')) {
    return error('INVALID_EXPENSE_RESPONSE', 'Expense history response was invalid. Refresh and try again.')
  }
  return Object.freeze({ ok: true, expenses: result.data.expenses, nextCursor: result.data.nextCursor })
}

export async function createExpense({ supabase, fetchImpl = globalThis.fetch, input }) {
  const validation = buildExpensePayload(input)
  if (!validation.ok) return validation
  const result = await authenticatedApiRequest({ supabase, fetchImpl, path: '/api/expenses', method: 'POST', payload: validation.payload, fallbackMessage: 'The expense could not be saved.' })
  if (!result.ok) return safeFailure(result, 'The expense could not be saved. Please try again.')
  if (result.status !== 201 || !expenseIsValid(result.data?.expense)) return error('INVALID_EXPENSE_RESPONSE', 'The expense response was invalid. Refresh and try again.')
  return Object.freeze({ ok: true, expense: result.data.expense })
}

function reportIsValid(report, kind) {
  if (!report || !currencyPattern.test(report.currency) || !Number.isInteger(report.salesCount) || report.salesCount < 0 ||
      !Number.isInteger(report.totalUnitsSold) || report.totalUnitsSold < 0 || report.stockValue !== null ||
      !['COMPLETE', 'INCOMPLETE'].includes(report.costStatus) ||
      !reportMoneyFields.every((field) => report.costStatus === 'INCOMPLETE' && costFields.has(field) ? report[field] === null : typeof report[field] === 'string' && signedMoneyPattern.test(report[field])) ||
      !reportMagnitudeFields.every((field) => report.costStatus === 'INCOMPLETE' && costFields.has(field) ? report[field] === null : unsignedMoneyPattern.test(report[field]))) return false
  if (kind === 'daily') return isBusinessDate(report.reportDate)
  const range = validateBusinessDateRange(report.from, report.to)
  return range.ok && report.daysCount === range.daysCount
}

async function loadReport({ supabase, fetchImpl, path, kind }) {
  const result = await authenticatedApiRequest({ supabase, fetchImpl, path, method: 'GET', fallbackMessage: 'Financial reporting is unavailable.' })
  if (!result.ok) return safeFailure(result, 'Financial reporting is unavailable. Please try again.')
  if (result.status !== 200 || !reportIsValid(result.data?.report, kind)) return error('INVALID_REPORT_RESPONSE', 'The financial report response was invalid. Refresh and try again.')
  return Object.freeze({ ok: true, report: result.data.report })
}

export function loadDailyReport({ supabase, fetchImpl = globalThis.fetch, date }) {
  if (!isBusinessDate(date)) return Promise.resolve(error('INVALID_DAILY_DATE', 'Choose a valid report date.'))
  return loadReport({ supabase, fetchImpl, kind: 'daily', path: `/api/reports/daily?date=${encodeURIComponent(date)}` })
}

export function loadSummaryReport({ supabase, fetchImpl = globalThis.fetch, from, to }) {
  const validation = validateBusinessDateRange(from, to)
  if (!validation.ok) return Promise.resolve(validation)
  return loadReport({ supabase, fetchImpl, kind: 'summary', path: `/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` })
}

export function createLatestRequestGuard() {
  let latest = 0
  return Object.freeze({
    begin() { latest += 1; return latest },
    isCurrent(request) { return request === latest },
    invalidate() { latest += 1 },
  })
}

export function isZeroReport(report) {
  return report?.salesCount === 0 && report?.totalUnitsSold === 0 && reportMoneyFields.every((field) => decimalToMinorUnits(report[field]?.replace(/^-/, ''), 2) === 0n)
}

export function canAccessFinance(role) {
  return role === 'OWNER'
}
