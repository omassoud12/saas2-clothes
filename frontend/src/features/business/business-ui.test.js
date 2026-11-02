import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { mapDailySummary, mapInvoice, mapPayments } from './domain/mappers.js'

// The shape the real backend returns (backend/src/business/daily.service.ts), for the owner and for staff.
const daily = (owner) => ({
  date: '2026-10-13', timezone: 'Asia/Beirut', currency: 'USD', exchangeRate: '89500', live: false, asOf: null, closed: false,
  salesTotal: '105.00', costTotal: owner ? '60.00' : null, profitTotal: owner ? '45.00' : null, costComplete: true,
  invoiceCount: 2, piecesSold: 3, discountsTotal: '0.00', returns: { count: 0, amountTotal: '0.00' },
  previousDay: { date: '2026-10-12', salesTotal: '140.00', invoiceCount: 3 },
  sameWeekdayLastWeek: { date: '2026-10-06', salesTotal: '0.00', invoiceCount: 0 },
  paymentSplit: [{ method: 'CASH', salesTotal: '35.00', invoiceCount: 1 }, { method: 'WHISH', salesTotal: '70.00', invoiceCount: 1 }],
  byStaff: [{ id: 'u1', name: 'Rami Haddad', storeNames: ['Hamra'], salesTotal: '70.00', profitTotal: owner ? '30.00' : null, invoiceCount: 1 }],
  products: [{ id: 'p1', name: 'Linen shirt', category: 'Shirts', quantity: 3, salesTotal: '105.00', profitTotal: owner ? '45.00' : null,
    variants: [{ id: 'v1', label: 'White · Size L', quantity: 2, salesTotal: '70.00', profitTotal: owner ? '30.00' : null }] }],
  byHour: [{ hour: 10, salesTotal: '35.00' }, { hour: 11, salesTotal: '70.00' }],
})

describe('business reports in the app', () => {
  test('the daily mapper reads the real backend shape; staff never see cost', () => {
    const owner = mapDailySummary(daily(true))
    assert.equal(owner.sales, 105); assert.equal(owner.profit, 45); assert.equal(owner.canSeeCost, true); assert.equal(owner.rate, 89500)
    assert.equal(owner.comparisons[0].sales, 140); assert.equal(owner.comparisons[1].label, 'Last Tuesday')
    const staff = mapDailySummary(daily(false))
    assert.equal(staff.cost, null); assert.equal(staff.profit, null); assert.equal(staff.canSeeCost, false)
    assert.equal(staff.staff[0].profit, null)
  })

  test('payments are Cash and Whish; an old invoice without a receipt number still maps', () => {
    assert.deepEqual(mapPayments(daily(true).paymentSplit).map((row) => row.key), ['CASH', 'WHISH'])
    const invoice = mapInvoice({ id: 'a1b2c3d4-0000-4000-8000-000000000000', number: null, createdAt: '2026-10-13T07:15:00.000Z', itemCount: 1, total: '35.00', paymentMethod: 'CARD', status: 'COMPLETED', staff: { id: 'u', name: 'Abu Ali' }, store: { id: 's', name: 'Hamra' }, customerName: null })
    assert.equal(invoice.methodLabel, 'CARD', 'card and debt show their own name')
  })

  test('the mock and "Sales by store" stay out of the app; the module goes through the app API client', () => {
    const api = readFileSync(new URL('./api/business.js', import.meta.url), 'utf8')
    assert.match(api, /import\.meta\.env\.DEV && import\.meta\.env\.VITE_USE_MOCK === 'true'/u)
    assert.doesNotMatch(api, /^import .*mockBusiness/mu, 'the mock is never imported statically')
    const client = readFileSync(new URL('./api/client.js', import.meta.url), 'utf8')
    assert.match(client, /authenticatedApiRequest/u); assert.doesNotMatch(client, /accountId/u)
    assert.doesNotMatch(readFileSync(new URL('./domain/mappers.js', import.meta.url), 'utf8'), /mapStores/u)
  })

  test('every business style is scoped under .biz, with no !important', () => {
    const css = readFileSync(new URL('./styles/business.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(css, /!important/u)
    const selectors = [...css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .flatMap((match) => match[1].split(',')).map((selector) => selector.trim()).filter(Boolean)
    assert.ok(selectors.length > 100)
    assert.deepEqual(selectors.filter((selector) => !/^\.biz(?![\w-])/.test(selector)), [])
  })
})
