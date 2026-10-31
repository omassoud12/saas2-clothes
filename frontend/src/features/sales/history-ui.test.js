import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
let vite
let HistoryPage
let SaleRow

before(async () => {
  const authFixture = { name: 'history-auth-fixture', enforce: 'pre',
    resolveId(id) { if (id.endsWith('/lib/supabase.js')) return '\0history-auth' },
    load(id) { if (id === '\0history-auth') return 'export const supabase = null' },
  }
  vite = await createServer({ root, configFile: false, plugins: [authFixture, react()], logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null } })
  HistoryPage = (await vite.ssrLoadModule('/src/pages/app/HistoryPage.jsx')).HistoryPage
  SaleRow = (await vite.ssrLoadModule('/src/features/sales/SalesHistory.jsx')).SaleRow
})

after(async () => { await vite?.close() })

describe('Sales history page', () => {
  test('opens on Today with all statuses, the period and status filters, and a loading list', () => {
    const html = renderToStaticMarkup(createElement(HistoryPage, { profile: { user: { role: 'OWNER' }, account: { baseCurrency: 'USD', name: 'Store' } } }))
    assert.match(html, /<h1>Sales history<\/h1>/u)
    for (const label of ['Today', 'Yesterday', 'This week', 'Custom', 'All', 'Completed', 'Voided', 'Returned']) assert.ok(html.includes(`>${label}<`), label)
    assert.match(html, /aria-label="Period"/u); assert.match(html, /aria-label="Status"/u)
    assert.match(html, /aria-pressed="true">Today</u); assert.match(html, /aria-pressed="true">All</u)
    assert.match(html, /Loading sales/u)
    assert.doesNotMatch(html, /type="date"|Open Sell and tap|coming next/u, 'the date fields appear only for Custom')
  })

  const sale = (overrides = {}) => ({ id: 'abcdef12-0000-4000-8000-000000000001', status: 'COMPLETED', currency: 'USD', subtotal: '45.00', totalAmount: '45.00',
    createdAt: new Date(2026, 9, 14, 9, 5).toISOString(), seller: { name: 'Rana', employeeCode: null }, itemCount: 2, totalUnits: 3,
    hasReturns: false, totalReturnedAmount: '0.00', ...overrides })
  const row = (role, overrides) => renderToStaticMarkup(createElement(SaleRow, { sale: sale(overrides), role, currency: 'USD', withDay: false, onOpen() {} }))

  test('an owner sees the receipt number, items, seller and amount; a warehouse user sees no amounts', () => {
    const owner = row('OWNER')
    assert.ok(owner.includes('#ABCDEF12') && owner.includes('3 items') && owner.includes('Rana') && owner.includes('$45'))
    const warehouse = row('WAREHOUSE', { hasReturns: true, totalReturnedAmount: '10.00' })
    assert.ok(warehouse.includes('#ABCDEF12') && warehouse.includes('3 items'))
    assert.doesNotMatch(warehouse, /\$|Rana|mock-history-amount/u)
  })

  test('voided and returned sales are marked, with the refunded amount for the owner', () => {
    const voided = row('OWNER', { status: 'VOIDED' })
    assert.match(voided, /mock-history-badge is-void">Voided/u); assert.match(voided, /is-struck/u)
    const returned = row('OWNER', { hasReturns: true, totalReturnedAmount: '10.50' })
    assert.match(returned, /mock-history-badge is-returned">Returned/u); assert.ok(returned.includes('−$10.50'))
    assert.doesNotMatch(row('OWNER'), /mock-history-badge/u)
  })
})
