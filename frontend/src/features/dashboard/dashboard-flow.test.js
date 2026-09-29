import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  dashboardQuickActions, dashboardRecentSales, loadDashboardCatalog,
  loadDashboardFinance, loadDashboardRecentSales, summarizeDashboardCatalog,
} from './dashboard-flow.js'
import { createLatestRequestGuard, isZeroReport } from '../finance/finance-flow.js'
import { ROUTES } from '../../app/routes.js'

const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'user' }, access_token: 'test-token' } } } } } }
const product = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Linen shirt', category: { id: 'category', name: 'Shirts' },
  isActive: true, imageUrl: null, profitMarginOverride: 'private', variants: [
    { id: 'variant-1', sku: 'LIN-S', color: 'Blue', size: 'S', currentStock: 0, isActive: true, lastPurchaseCost: 'private' },
    { id: 'variant-2', sku: 'LIN-M', color: 'Blue', size: 'M', currentStock: 7, isActive: true, lastPurchaseCost: 'private' },
    { id: 'variant-3', sku: 'OLD', currentStock: 9, isActive: false },
  ],
}
const sale = { id: '22222222-2222-4222-8222-222222222222', status: 'COMPLETED', totalAmount: '9007199254740993.25', currency: 'USD', itemCount: 2, totalUnits: 3, createdAt: '2026-09-26T09:00:00.000Z', seller: { name: 'Store Owner', employeeCode: null } }
const report = {
  reportDate: '2026-09-26', currency: 'USD', salesCount: 1, totalUnitsSold: 3,
  grossRevenue: '100.00', returnedRevenue: '0.00', voidedRevenue: '0.00', netRevenue: '100.00',
  grossCOGS: '40.00', returnedCOGS: '0.00', voidedCOGS: '0.00', netCOGS: '40.00',
  grossProfit: '60.00', operatingExpenses: '65.00', netProfit: '-5.00', costStatus:'COMPLETE', stockValue: null,
}
function json(status, data, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }) }

describe('Dashboard role and presentation contract', () => {
  test('OWNER quick actions use centralized permitted routes', () => {
    assert.deepEqual(dashboardQuickActions('OWNER').map((action) => action.path), [ROUTES.sales, ROUTES.products, ROUTES.inventory, ROUTES.expenses, ROUTES.reports])
  })

  test('WAREHOUSE quick actions omit all finance routes', () => {
    const paths = dashboardQuickActions('WAREHOUSE').map((action) => action.path)
    assert.deepEqual(paths, [ROUTES.sales, ROUTES.products, ROUTES.inventory])
    assert.equal(paths.includes(ROUTES.expenses), false)
    assert.equal(paths.includes(ROUTES.reports), false)
    assert.deepEqual(dashboardQuickActions('SUPER_ADMIN'), [])
  })

  test('WAREHOUSE recent Sales state strips transaction money', () => {
    const rows = dashboardRecentSales([sale], 'WAREHOUSE')
    assert.equal(rows[0].totalUnits, 3)
    assert.equal(Object.hasOwn(rows[0], 'totalAmount'), false)
    assert.equal(Object.hasOwn(rows[0], 'currency'), false)
  })

  test('OWNER recent Sales preserves exact decimal strings without arithmetic', () => {
    const rows = dashboardRecentSales([sale], 'OWNER')
    assert.equal(rows[0].totalAmount, '9007199254740993.25')
    assert.equal(rows[0].currency, 'USD')
  })
})

describe('Dashboard authoritative loaders', () => {
  test('WAREHOUSE never requests the OWNER report endpoint', async () => {
    let called = false
    const result = await loadDashboardFinance({ supabase, role: 'WAREHOUSE', date: '2026-09-26', currency: 'USD', fetchImpl: async () => { called = true; throw new Error('must not request') } })
    assert.deepEqual(result, { ok: true, skipped: true })
    assert.equal(called, false)
  })

  test('OWNER uses authoritative daily finance and preserves backend net profit', async () => {
    let url
    const result = await loadDashboardFinance({ supabase, role: 'OWNER', date: '2026-09-26', currency: 'USD', fetchImpl: async (input) => { url = input; return json(200, { report }) } })
    assert.equal(url, '/api/reports/daily?date=2026-09-26')
    assert.equal(result.report.netProfit, '-5.00')
    assert.equal(result.report.operatingExpenses, '65.00')
  })

  test('OWNER fails safely if report currency differs from profile authority', async () => {
    const result = await loadDashboardFinance({ supabase, role: 'OWNER', date: '2026-09-26', currency: 'LBP', fetchImpl: async () => json(200, { report }) })
    assert.equal(result.code, 'DASHBOARD_CURRENCY_MISMATCH')
  })

  test('an authoritative zero-activity day remains a deliberate zero state', async () => {
    const zeroReport = { ...report, salesCount: 0, totalUnitsSold: 0, grossRevenue: '0.00', netRevenue: '0.00', grossCOGS: '0.00', netCOGS: '0.00', grossProfit: '0.00', operatingExpenses: '0.00', netProfit: '0.00' }
    const result = await loadDashboardFinance({ supabase, role: 'OWNER', date: '2026-09-26', currency: 'USD', fetchImpl: async () => json(200, { report: zeroReport }) })
    assert.equal(result.ok, true)
    assert.equal(isZeroReport(result.report), true)
  })

  test('catalog summary is bounded and omits OWNER-only Product data', async () => {
    let url
    const result = await loadDashboardCatalog({ supabase, fetchImpl: async (input) => { url = new URL(input, 'https://local.test'); return json(200, { products: [product], total: 8, page: 1, limit: 12 }) } })
    assert.equal(url.searchParams.get('page'), '1')
    assert.equal(url.searchParams.get('limit'), '12')
    assert.deepEqual(result.summary, { activeProducts: 8, sampledProducts: 1, activeVariants: 2, unitsOnHand: '7', outOfStock: [{ productId: product.id, productName: 'Linen shirt', variantId: 'variant-1', sku: 'LIN-S', details: 'Blue / S' }] })
    assert.equal(JSON.stringify(result).includes('lastPurchaseCost'), false)
    assert.equal(JSON.stringify(result).includes('profitMarginOverride'), false)
  })

  test('recent Sales request is intentionally limited to six', async () => {
    let url
    const result = await loadDashboardRecentSales({ supabase, role: 'OWNER', fetchImpl: async (input) => { url = new URL(input, 'https://local.test'); return json(200, { sales: [sale], nextCursor: null }) } })
    assert.equal(result.ok, true)
    assert.equal(url.searchParams.get('limit'), '6')
  })

  test('independent section results preserve useful data during partial failure', async () => {
    const [catalog, sales] = await Promise.all([
      loadDashboardCatalog({ supabase, fetchImpl: async () => json(200, { products: [product], total: 1, page: 1, limit: 12 }) }),
      loadDashboardRecentSales({ supabase, role: 'OWNER', fetchImpl: async () => json(503, { error: { code: 'SALES_HISTORY_UNAVAILABLE', message: 'database detail' } }) }),
    ])
    assert.equal(catalog.ok, true)
    assert.equal(sales.ok, false)
    assert.doesNotMatch(sales.message, /database detail/)
  })

  test('401 and 429 remain safe while stale request tokens are rejected', async () => {
    const expired = await loadDashboardRecentSales({ supabase, role: 'OWNER', fetchImpl: async () => json(401, { error: { code: 'SESSION_REQUIRED' } }) })
    assert.equal(expired.requiresLogin, true)
    const limited = await loadDashboardFinance({ supabase, role: 'OWNER', date: '2026-09-26', currency: 'USD', fetchImpl: async () => json(429, { error: { code: 'RATE_LIMITED' } }, { 'Retry-After': '10' }) })
    assert.equal(limited.retryAfterSeconds, 10)
    const forbidden = await loadDashboardFinance({ supabase, role: 'OWNER', date: '2026-09-26', currency: 'USD', fetchImpl: async () => json(403, { error: { code: 'REPORT_OWNER_REQUIRED', message: 'private role detail' } }) })
    assert.equal(forbidden.forbidden, true)
    assert.equal(forbidden.requiresLogin, undefined)
    const guard = createLatestRequestGuard()
    const first = guard.begin()
    const second = guard.begin()
    assert.equal(guard.isCurrent(first), false)
    assert.equal(guard.isCurrent(second), true)
  })
})

describe('Dashboard stock semantics', () => {
  test('stock signals are exact operational counts, not a financial valuation', () => {
    const summary = summarizeDashboardCatalog([product], 1)
    assert.equal(summary.unitsOnHand, '7')
    assert.equal(Object.hasOwn(summary, 'stockValue'), false)
    assert.equal(Object.hasOwn(summary, 'lowStock'), false)
  })

  test('new stores have intentional empty operational data', () => {
    assert.deepEqual(summarizeDashboardCatalog([], 0), { activeProducts: 0, sampledProducts: 0, activeVariants: 0, unitsOnHand: '0', outOfStock: [] })
    assert.deepEqual(dashboardRecentSales([], 'WAREHOUSE'), [])
  })
})
