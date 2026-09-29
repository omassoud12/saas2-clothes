import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildExpensePayload, canAccessFinance, createExpense, createLatestRequestGuard,
  isBusinessDate, isZeroReport, listExpenses, loadDailyReport, loadSummaryReport,
  localBusinessDate, validateBusinessDateRange,
} from './finance-flow.js'
import { createSubmissionGuard } from '../auth/owner-flow.js'

const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'owner' }, access_token: 'test-token' } } } } } }
const expense = { id: 'expense-1', amount: '12.50', currency: 'USD', description: 'Packaging', expenseDate: '2026-09-26', createdById: 'owner', createdAt: '2026-09-26T08:00:00.000Z' }
const totals = {
  currency: 'USD', salesCount: 2, totalUnitsSold: 3,
  grossRevenue: '100.00', returnedRevenue: '10.00', voidedRevenue: '20.00', netRevenue: '70.00',
  grossCOGS: '50.00', returnedCOGS: '5.00', voidedCOGS: '10.00', netCOGS: '35.00',
  grossProfit: '35.00', operatingExpenses: '40.00', netProfit: '-5.00', costStatus:'COMPLETE', stockValue: null,
}
function json(status, data, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }) }

describe('finance business dates and expense input', () => {
  test('validates calendar dates without changing the business date', () => {
    assert.equal(isBusinessDate('2024-02-29'), true)
    assert.equal(isBusinessDate('2026-02-29'), false)
    assert.equal(isBusinessDate('2026-09-31'), false)
    assert.equal(localBusinessDate(new Date(2026, 8, 26, 23, 59)), '2026-09-26')
  })

  test('enforces inclusive summary order and 366-day maximum', () => {
    assert.deepEqual(validateBusinessDateRange('2024-01-01', '2024-12-31'), { ok: true, daysCount: 366 })
    assert.equal(validateBusinessDateRange('2024-01-01', '2025-01-01').code, 'DATE_RANGE_TOO_LONG')
    assert.equal(validateBusinessDateRange('2026-09-27', '2026-09-26').code, 'INVALID_DATE_ORDER')
  })

  test('normalizes expense money exactly with BigInt-safe decimal handling', () => {
    assert.deepEqual(buildExpensePayload({ amount: '9007199254740993.2', description: '  Rent  ', expenseDate: '2026-09-26' }).payload, { amount: '9007199254740993.20', description: 'Rent', expenseDate: '2026-09-26' })
    assert.equal(buildExpensePayload({ amount: '0', description: 'Rent', expenseDate: '2026-09-26' }).code, 'INVALID_EXPENSE_AMOUNT')
    assert.equal(buildExpensePayload({ amount: '1.001', description: 'Rent', expenseDate: '2026-09-26' }).code, 'INVALID_EXPENSE_AMOUNT')
  })

  test('rejects missing descriptions and invalid dates before a request', () => {
    assert.equal(buildExpensePayload({ amount: '1', description: ' ', expenseDate: '2026-09-26' }).code, 'INVALID_EXPENSE_DESCRIPTION')
    assert.equal(buildExpensePayload({ amount: '1', description: 'Rent', expenseDate: '2026-02-30' }).code, 'INVALID_EXPENSE_DATE')
  })
})

describe('expense API frontend contract', () => {
  test('lists only approved date/cursor filters and never sends accountId', async () => {
    let request
    const result = await listExpenses({ supabase, filters: { from: '2026-09-01', to: '2026-09-26', cursor: 'next', limit: 25, accountId: 'forged' }, fetchImpl: async (url, options) => { request = { url: new URL(url, 'https://local.test'), options }; return json(200, { expenses: [expense], nextCursor: null }) } })
    assert.equal(result.ok, true)
    assert.equal(request.options.headers.Authorization, 'Bearer test-token')
    assert.equal(request.url.searchParams.has('accountId'), false)
    assert.equal(request.url.searchParams.get('from'), '2026-09-01')
  })

  test('creates exactly the validated backend payload', async () => {
    let body
    const result = await createExpense({ supabase, input: { amount: '12.5', description: ' Packaging ', expenseDate: '2026-09-26', accountId: 'forged' }, fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return json(201, { expense }) } })
    assert.equal(result.ok, true)
    assert.deepEqual(body, { amount: '12.50', description: 'Packaging', expenseDate: '2026-09-26' })
  })

  test('keeps authorization and backend details private', async () => {
    const denied = await listExpenses({ supabase, fetchImpl: async () => json(403, { error: { code: 'EXPENSE_OWNER_REQUIRED', message: 'private detail' } }) })
    assert.equal(denied.forbidden, true)
    assert.doesNotMatch(denied.message, /private detail/)
    const failure = await listExpenses({ supabase, fetchImpl: async () => json(503, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'SQL password' } }) })
    assert.doesNotMatch(failure.message, /SQL|password/)
  })

  test('preserves bounded Retry-After feedback', async () => {
    const result = await createExpense({ supabase, input: { amount: '1', description: 'Rent', expenseDate: '2026-09-26' }, fetchImpl: async () => json(429, { error: { code: 'RATE_LIMITED' } }, { 'Retry-After': '12' }) })
    assert.equal(result.retryAfterSeconds, 12)
  })

  test('duplicate-submit guard permits only one pending Expense create', async () => {
    const guard = createSubmissionGuard()
    let release
    let calls = 0
    const operation = () => guard.run(async () => { calls += 1; await new Promise((resolve) => { release = resolve }); return 'saved' })
    const first = operation()
    const second = await operation()
    assert.equal(second.skipped, true)
    assert.equal(calls, 1)
    release()
    assert.equal((await first).value, 'saved')
  })
})

describe('authoritative report frontend contract', () => {
  test('loads the exact daily endpoint and accepts negative calculated totals', async () => {
    let request
    const result = await loadDailyReport({ supabase, date: '2026-09-26', fetchImpl: async (url, options) => { request = { url, options }; return json(200, { report: { ...totals, reportDate: '2026-09-26' } }) } })
    assert.equal(result.ok, true)
    assert.equal(request.url, '/api/reports/daily?date=2026-09-26')
    assert.equal(request.options.method, 'GET')
    assert.equal(result.report.netProfit, '-5.00')
  })

  test('loads summary data without recalculating backend values', async () => {
    const supplied = { ...totals, from: '2026-09-01', to: '2026-09-26', daysCount: 26, grossProfit: '-999.00' }
    const result = await loadSummaryReport({ supabase, from: supplied.from, to: supplied.to, fetchImpl: async (url) => { assert.equal(url, '/api/reports/summary?from=2026-09-01&to=2026-09-26'); return json(200, { report: supplied }) } })
    assert.equal(result.ok, true)
    assert.equal(result.report.grossProfit, '-999.00')
  })

  test('rejects malformed reports and non-authoritative stock values', async () => {
    const malformed = await loadDailyReport({ supabase, date: '2026-09-26', fetchImpl: async () => json(200, { report: { ...totals, reportDate: '2026-09-26', netProfit: 1 } }) })
    assert.equal(malformed.code, 'INVALID_REPORT_RESPONSE')
    const guessedStock = await loadDailyReport({ supabase, date: '2026-09-26', fetchImpl: async () => json(200, { report: { ...totals, reportDate: '2026-09-26', stockValue: '0.00' } }) })
    assert.equal(guessedStock.code, 'INVALID_REPORT_RESPONSE')
    const negativeMagnitude = await loadDailyReport({ supabase, date: '2026-09-26', fetchImpl: async () => json(200, { report: { ...totals, reportDate: '2026-09-26', grossRevenue: '-1.00' } }) })
    assert.equal(negativeMagnitude.code, 'INVALID_REPORT_RESPONSE')
  })

  test('recognizes explicit all-zero periods', () => {
    const zero = Object.fromEntries(Object.keys(totals).filter((key) => typeof totals[key] === 'string' && key !== 'currency').map((key) => [key, '0.00']))
    assert.equal(isZeroReport({ ...totals, ...zero, salesCount: 0, totalUnitsSold: 0 }), true)
    assert.equal(isZeroReport(totals), false)
  })

  test('latest-request guard rejects stale asynchronous results', () => {
    const guard = createLatestRequestGuard()
    const first = guard.begin()
    const second = guard.begin()
    assert.equal(guard.isCurrent(first), false)
    assert.equal(guard.isCurrent(second), true)
    guard.invalidate()
    assert.equal(guard.isCurrent(second), false)
  })

  test('financial access is OWNER-only in the client as defense in depth', () => {
    assert.equal(canAccessFinance('OWNER'), true)
    assert.equal(canAccessFinance('WAREHOUSE'), false)
    assert.equal(canAccessFinance('SUPER_ADMIN'), false)
  })

  test('report auth, rate-limit, and network failures remain distinct and safe', async () => {
    const expired = await loadSummaryReport({ supabase, from: '2026-09-01', to: '2026-09-26', fetchImpl: async () => json(401, { error: { code: 'SESSION_REQUIRED', message: 'token detail' } }) })
    assert.equal(expired.requiresLogin, true)
    const forbidden = await loadSummaryReport({ supabase, from: '2026-09-01', to: '2026-09-26', fetchImpl: async () => json(403, { error: { code: 'REPORT_OWNER_REQUIRED', message: 'role detail' } }) })
    assert.equal(forbidden.forbidden, true)
    const limited = await loadSummaryReport({ supabase, from: '2026-09-01', to: '2026-09-26', fetchImpl: async () => json(429, { error: { code: 'RATE_LIMITED' } }, { 'Retry-After': '9' }) })
    assert.equal(limited.retryAfterSeconds, 9)
    const offline = await loadSummaryReport({ supabase, from: '2026-09-01', to: '2026-09-26', fetchImpl: async () => { throw new Error('provider hostname') } })
    assert.doesNotMatch(offline.message, /provider|hostname/)
  })
})

test('incomplete report accepts null economics and rejects falsely complete amounts',async()=>{
 const report={...totals,reportDate:'2026-09-26',costStatus:'INCOMPLETE',grossCOGS:null,returnedCOGS:null,voidedCOGS:null,netCOGS:null,grossProfit:null,netProfit:null}
 assert.equal((await loadDailyReport({supabase,date:'2026-09-26',fetchImpl:async()=>json(200,{report})})).ok,true)
 assert.equal(isZeroReport(report),false)
 assert.equal((await loadDailyReport({supabase,date:'2026-09-26',fetchImpl:async()=>json(200,{report:{...report,netProfit:'70.00'}})})).ok,false)
})
