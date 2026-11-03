import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { asState, lbpToUsd, monthMoney, normalizeMoneyInput, rankProducts, targetBar, unitCostPreview } from './owner-dashboard.js'
import { resolveAppRoute } from '../../app/app-navigation.js'
import { ROUTES } from '../../app/routes.js'

describe('owner dashboard numbers', () => {
  test('the "= $8.00 each" preview rounds like the server (half up to cents)', () => {
    assert.equal(unitCostPreview('96', 12), '8.00')
    assert.equal(unitCostPreview('10', 3), '3.33')
    assert.equal(unitCostPreview('100', 6), '16.67')
    assert.equal(unitCostPreview('0.05', 2), '0.03')
    assert.equal(unitCostPreview('1,250.50', 2), '625.25')
    assert.equal(unitCostPreview('', 12), null)
    assert.equal(unitCostPreview('96', 0), null)
  })

  test('money input: thousands separators, a comma decimal, nothing negative or empty', () => {
    assert.equal(normalizeMoneyInput('96'), '96.00')
    assert.equal(normalizeMoneyInput('1,250.5'), '1250.50')
    assert.equal(normalizeMoneyInput('12,5'), '12.50')
    assert.equal(normalizeMoneyInput(' 750 '), '750.00')
    assert.equal(normalizeMoneyInput('-5'), null)
    assert.equal(normalizeMoneyInput('0'), null)
    assert.equal(normalizeMoneyInput('abc'), null)
  })

  test('LBP is converted with the account rate', () => {
    assert.equal(lbpToUsd('8,950,000', '89500'), '100.00')
    assert.equal(lbpToUsd('100', '89500'), null)
    assert.equal(lbpToUsd('8950000', null), null)
  })

  test('target bar: fill, pace tick and the gap to the pace', () => {
    assert.deepEqual(targetBar({ amount: '5000.00', expectedByToday: '3064.52' }, '2500.00'), { fill: 50, pace: 61.2904, percent: 50, gap: 2500 - 3064.52 })
    assert.equal(targetBar({ amount: '1000.00', expectedByToday: '500.00' }, '1500.00').fill, 100)
    assert.equal(targetBar(null, '10'), null)
  })

  test('best sellers rank by revenue, pieces or profit; the month money adds up', () => {
    const items = [{ id: 'a', salesTotal: '100.00', quantity: 2, profitTotal: '10.00' }, { id: 'b', salesTotal: '50.00', quantity: 9, profitTotal: '30.00' }]
    assert.deepEqual(rankProducts(items, 'sales').map((item) => item.id), ['a', 'b'])
    assert.deepEqual(rankProducts(items, 'quantity').map((item) => item.id), ['b', 'a'])
    assert.deepEqual(rankProducts(items, 'profit').map((item) => item.id), ['b', 'a'])
    assert.deepEqual(monthMoney({ salesTotal: '1000.00', profitTotal: '400.00', expensesTotal: '150.00', netProfit: '250.00' }), { sales: 1000, cost: 600, profit: 400, expenses: 150, net: 250 })
    assert.equal(monthMoney({ salesTotal: '1000.00', profitTotal: null }), null)
  })

  test('loading states keep the last data while the next one loads', () => {
    assert.deepEqual(asState({ data: null, error: null, loading: true }), { kind: 'loading' })
    assert.deepEqual(asState({ data: { a: 1 }, error: null, loading: false }), { kind: 'ready', body: { a: 1 } })
    assert.deepEqual(asState({ data: { a: 1 }, error: null, loading: true }), { kind: 'ready', body: { a: 1 }, refreshing: true })
    assert.deepEqual(asState({ data: null, error: new Error('down'), loading: false }), { kind: 'error', message: 'down' })
  })
})

describe('owner dashboard routes', () => {
  test('the product cost page is for the owner only', () => {
    assert.equal(resolveAppRoute(ROUTES.dashboardCosts, 'OWNER').route.key, 'dashboardCosts')
    assert.equal(resolveAppRoute(ROUTES.dashboardCosts, 'WAREHOUSE').route, null)
  })
})
