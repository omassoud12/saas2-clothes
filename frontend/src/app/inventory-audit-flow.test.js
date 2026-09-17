import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  MOVEMENT_LABELS, appendPage, canShowMovementCost, canShowMovementNote,
  getInventoryReconciliation, listInventoryMovements, reconciliationSummary, signedQuantity,
} from './inventory-audit-flow.js'

const productId = '11111111-1111-4111-8111-111111111111'
const variantId = '22222222-2222-4222-8222-222222222222'
const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'user' }, access_token: 'test-token' } } } } } }
const row = { id: 'movement-1', type: 'RESTOCK', quantityChange: 15, unitCost: '12.3456', note: 'Supplier', createdAt: '2026-09-17T12:00:00.000Z', product: { id: productId, name: 'Shirt' }, variant: { id: variantId, sku: 'SHIRT-RED' }, performer: { name: 'Store Owner', employeeCode: null } }
const matched = { variant: { id: variantId, sku: 'SHIRT-RED', product: { id: productId, name: 'Shirt' } }, storedStock: 10, ledgerStock: 10, difference: 0, status: 'RECONCILED' }
const mismatch = { ...matched, storedStock: 10, ledgerStock: 11, difference: -1, status: 'MISMATCH' }
function json(status, data) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }

describe('inventory history frontend contract', () => {
  test('presents all movement types and signed quantities', () => {
    assert.deepEqual(MOVEMENT_LABELS, { RESTOCK: 'Restock', SALE: 'Sale', RETURN: 'Return', SALE_VOID: 'Sale Void', DAMAGE: 'Damage', ADJUSTMENT: 'Adjustment' })
    assert.equal(signedQuantity(15), '+15')
    assert.equal(signedQuantity(-2), '-2')
    assert.equal(signedQuantity(0), '0')
  })

  test('OWNER may see cost and note; WAREHOUSE never renders them', () => {
    assert.equal(canShowMovementCost('OWNER', row), true)
    assert.equal(canShowMovementNote('OWNER', row), true)
    assert.equal(canShowMovementCost('WAREHOUSE', row), false)
    assert.equal(canShowMovementNote('WAREHOUSE', row), false)
    assert.equal(canShowMovementCost('OWNER', { ...row, unitCost: null }), false)
  })

  test('history builds only approved filters and handles empty/paginated data', async () => {
    let requested
    const filters = { productId, variantId, type: 'RESTOCK', from: '2026-09-17T00:00:00.000Z', to: '2026-09-18T00:00:00.000Z', cursor: 'cursor', limit: 25, accountId: 'forged' }
    const first = await listInventoryMovements({ supabase, filters, fetchImpl: async (url, options) => { requested = { url: new URL(url, 'https://local.test'), options }; return json(200, { movements: [row], nextCursor: 'next' }) } })
    assert.equal(first.ok, true)
    assert.equal(requested.options.headers.Authorization, 'Bearer test-token')
    for (const key of ['productId', 'variantId', 'type', 'from', 'to', 'cursor', 'limit']) assert.equal(requested.url.searchParams.get(key), String(filters[key]))
    assert.equal(requested.url.searchParams.has('accountId'), false)
    assert.equal(first.nextCursor, 'next')
    const second = await listInventoryMovements({ supabase, fetchImpl: async () => json(200, { movements: [], nextCursor: null }) })
    assert.deepEqual(second.movements, [])
    assert.deepEqual(appendPage([row], [row, { ...row, id: 'movement-2' }]).map((item) => item.id), ['movement-1', 'movement-2'])
  })

  test('does not expose backend error details', async () => {
    const result = await listInventoryMovements({ supabase, fetchImpl: async () => json(503, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'SQL secret' } }) })
    assert.equal(result.ok, false)
    assert.doesNotMatch(result.message, /SQL|secret/)
  })
})

describe('inventory reconciliation frontend contract', () => {
  test('matched and mismatched results retain server difference direction', async () => {
    let requested
    const result = await getInventoryReconciliation({ supabase, filters: { productId, variantId, status: 'MISMATCH', cursor: 'next', limit: 25, accountId: 'forged' }, fetchImpl: async (url) => { requested = new URL(url, 'https://local.test'); return json(200, { variants: [matched, mismatch], nextCursor: null }) } })
    assert.equal(result.ok, true)
    assert.equal(requested.searchParams.has('accountId'), false)
    assert.equal(requested.searchParams.get('status'), 'MISMATCH')
    assert.equal(result.variants[1].difference, -1)
    assert.deepEqual(reconciliationSummary(result.variants), { reconciled: 1, mismatched: 1 })
    assert.equal(signedQuantity(result.variants[1].difference), '-1')
  })

  test('empty results are explicit; no repair request is defined', async () => {
    const result = await getInventoryReconciliation({ supabase, fetchImpl: async (_url, options) => { assert.equal(options.method, 'GET'); return json(200, { variants: [], nextCursor: null }) } })
    assert.deepEqual(result.variants, [])
    assert.deepEqual(reconciliationSummary(result.variants), { reconciled: 0, mismatched: 0 })
  })
})
