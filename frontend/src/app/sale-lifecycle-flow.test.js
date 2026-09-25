import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  calculateExchangePreview, calculateReturnPreview, canReturnSale, canVoidSale, exchangeOperation,
  loadSaleDetail, loadSaleReturns, returnOperation, setReturnQuantity, submitExchange, submitReturn, submitVoid,
} from './sale-lifecycle-flow.js'
import { addVariantToCart, createCheckoutGuard, setCartQuantity } from './sale-flow.js'

const saleId = '11111111-1111-4111-8111-111111111111'
const itemId = '22222222-2222-4222-8222-222222222222'
const variantId = '33333333-3333-4333-8333-333333333333'
const returnKey = '44444444-4444-4444-8444-444444444444'
const exchangeKey = '55555555-5555-4555-8555-555555555555'
const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'user' }, access_token: 'synthetic-test-token' } } } } } }
const sale = {
  id: saleId, status: 'COMPLETED', currency: 'USD', subtotal: '30.00', totalAmount: '30.00',
  createdAt: '2026-09-25T10:00:00.000Z', seller: { name: 'Cashier', employeeCode: 'C1' }, void: null,
  returnSummary: { hasReturns: true, returnCount: 1, totalReturnedUnits: 1, totalReturnedAmount: '10.00' },
  exchangeSummary: { originalExchangeCount: 0, replacementForExchangeId: null },
  items: [{
    id: itemId, productId: saleId, variantId, productName: 'Linen shirt', categoryName: 'Shirts', sku: 'LIN-M',
    color: 'Blue', size: 'M', quantity: 3, unitSoldPrice: '10.00', lineTotal: '30.00',
    returnedQuantity: 1, remainingReturnableQuantity: 2,
  }],
}
const product = { id: saleId, name: 'Replacement shirt', category: { name: 'Shirts' }, imageUrl: null, isActive: true }
const replacement = { id: variantId, sku: 'REP-M', color: 'Black', size: 'M', sellingPrice: '12.50', currentStock: 4, isActive: true }

function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
function replacementCart(role = 'WAREHOUSE') { return addVariantToCart([], product, replacement, role).cart }

describe('Sale lifecycle detail and permissions', () => {
  test('loads operational detail and strips OWNER economics and item costs from frontend state', async () => {
    const result = await loadSaleDetail({ supabase, saleId, fetchImpl: async () => json(200, {
      sale: { ...sale, economics: { totalCOGS: '4.00', grossProfit: '26.00' }, items: [{ ...sale.items[0], unitCostAtSale: '4.0000', lineCost: '12.0000', lineGrossProfit: '18.0000' }] },
    }) })
    assert.equal(result.ok, true)
    assert.equal(JSON.stringify(result).includes('unitCostAtSale'), false)
    assert.equal(JSON.stringify(result).includes('grossProfit'), false)
    assert.equal(result.sale.items[0].remainingReturnableQuantity, 2)
  })

  test('uses actual status and role rules for Return, Exchange, and Void availability', () => {
    assert.equal(canReturnSale(sale), true)
    assert.equal(canVoidSale('OWNER', sale), false)
    assert.equal(canVoidSale('WAREHOUSE', { ...sale, returnSummary: { ...sale.returnSummary, hasReturns: false } }), false)
    assert.equal(canVoidSale('OWNER', { ...sale, returnSummary: { ...sale.returnSummary, hasReturns: false } }), true)
    assert.equal(canReturnSale({ ...sale, status: 'VOIDED' }), false)
  })

  test('loads bounded per-Sale Return history without financial-private fields', async () => {
    let requested
    const result = await loadSaleReturns({ supabase, saleId, cursor: 'safe_cursor', fetchImpl: async (url) => {
      requested = new URL(url, 'https://local.test')
      return json(200, { returns: [{ id: returnKey, saleId, exchangeId: null, createdAt: sale.createdAt, reason: null, processor: { name: 'Cashier', employeeCode: null }, totalRefund: '10.00', itemCount: 1, totalUnits: 1, privateCost: 'secret' }], nextCursor: null })
    } })
    assert.equal(requested.searchParams.get('limit'), '25')
    assert.equal(requested.searchParams.get('cursor'), 'safe_cursor')
    assert.equal(JSON.stringify(result).includes('privateCost'), false)
  })
})

describe('Return selection, money, and idempotency', () => {
  test('enforces visible remaining quantity and calculates an exact refund preview', () => {
    const selected = setReturnQuantity({}, sale.items[0], 2)
    assert.deepEqual(selected.quantities, { [itemId]: 2 })
    assert.equal(setReturnQuantity(selected.quantities, sale.items[0], 3).ok, false)
    assert.deepEqual(calculateReturnPreview(sale, selected.quantities), { valid: true, units: 2, total: '20.00' })
    assert.deepEqual(setReturnQuantity(selected.quantities, sale.items[0], 0).quantities, {})
  })

  test('builds only the backend Return payload and normalizes an optional reason', () => {
    const prepared = returnOperation({ sale, quantities: { [itemId]: 1 }, reason: '  Wrong size  ', current: null, uuidFactory: () => returnKey })
    assert.deepEqual(prepared.operation.payload, { reason: 'Wrong size', items: [{ saleItemId: itemId, quantity: 1 }] })
    assert.equal(JSON.stringify(prepared).includes('accountId'), false)
  })

  test('reuses one key for the same Return and replaces it after semantic changes', () => {
    const first = returnOperation({ sale, quantities: { [itemId]: 1 }, reason: '', current: null, uuidFactory: () => returnKey }).operation
    assert.equal(returnOperation({ sale, quantities: { [itemId]: 1 }, reason: '', current: first, uuidFactory: () => { throw Error('must not run') } }).operation, first)
    const changed = returnOperation({ sale, quantities: { [itemId]: 2 }, reason: '', current: first, uuidFactory: () => exchangeKey }).operation
    assert.equal(changed.key, exchangeKey)
  })

  test('submits the exact Return body/header and trusts the authoritative refund', async () => {
    const operation = returnOperation({ sale, quantities: { [itemId]: 1 }, reason: '', current: null, uuidFactory: () => returnKey }).operation
    let request
    const result = await submitReturn({ supabase, saleId, operation, fetchImpl: async (_url, options) => {
      request = options
      return json(201, { return: { id: returnKey, totalRefund: '10.00', items: [] }, idempotentReplay: false })
    } })
    assert.equal(result.return.totalRefund, '10.00')
    assert.equal(request.headers['Idempotency-Key'], returnKey)
    assert.deepEqual(JSON.parse(request.body), operation.payload)
  })

  test('preserves retry semantics and maps auth, conflict, and rate-limit failures safely', async () => {
    const operation = returnOperation({ sale, quantities: { [itemId]: 1 }, reason: '', current: null, uuidFactory: () => returnKey }).operation
    const run = (status, code) => submitReturn({ supabase, saleId, operation, fetchImpl: async () => json(status, { error: { code, message: 'private' } }) })
    assert.equal((await run(401, 'TOKEN_INVALID')).requiresLogin, true)
    assert.equal((await run(403, 'ROLE_FORBIDDEN')).requiresLogin, undefined)
    assert.equal((await run(409, 'RETURN_QUANTITY_EXCEEDS_REMAINING')).refreshDetail, true)
    assert.equal((await run(409, 'RETURN_IDEMPOTENCY_CONFLICT')).refreshDetail, undefined)
    assert.equal((await run(429, 'RATE_LIMITED')).retryable, true)
    assert.equal((await submitReturn({ supabase, saleId, operation, fetchImpl: async () => { throw Error('private') } })).retryable, true)
    assert.equal(operation.key, returnKey)
  })

  test('blocks duplicate Return submissions while one request is pending', async () => {
    const guard = createCheckoutGuard(); let release
    const first = guard.run(() => new Promise((resolve) => { release = resolve }))
    assert.deepEqual(await guard.run(() => 'duplicate'), { skipped: true })
    release('confirmed'); assert.deepEqual(await first, { skipped: false, value: 'confirmed' })
  })
})

describe('OWNER-only Sale Void', () => {
  test('submits only the normalized reason and no invented idempotency header', async () => {
    let request
    const result = await submitVoid({ supabase, saleId, reason: '  Duplicate checkout  ', fetchImpl: async (_url, options) => {
      request = options
      return json(201, { sale: { id: saleId, status: 'VOIDED' }, idempotentReplay: false })
    } })
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(request.body), { reason: 'Duplicate checkout' })
    assert.equal(request.headers['Idempotency-Key'], undefined)
  })

  test('accepts backend same-reason replay and maps forbidden/conflict safely', async () => {
    const replay = await submitVoid({ supabase, saleId, reason: 'Duplicate', fetchImpl: async () => json(200, { sale: { id: saleId, status: 'VOIDED' }, idempotentReplay: true }) })
    assert.equal(replay.idempotentReplay, true)
    const forbidden = await submitVoid({ supabase, saleId, reason: 'Duplicate', fetchImpl: async () => json(403, { error: { code: 'ROLE_FORBIDDEN' } }) })
    assert.match(forbidden.message, /not authorized/)
    const conflict = await submitVoid({ supabase, saleId, reason: 'Duplicate', fetchImpl: async () => json(409, { error: { code: 'SALE_VOID_CONFLICT' } }) })
    assert.equal(conflict.refreshDetail, true)
  })
})

describe('Atomic Exchange workflow', () => {
  test('builds one atomic Return plus replacement Sale payload with exact money', () => {
    const prepared = exchangeOperation({ sale, quantities: { [itemId]: 1 }, reason: 'Size exchange', replacementCart: replacementCart(), current: null, uuidFactory: () => exchangeKey })
    assert.deepEqual(prepared.operation.payload, {
      reason: 'Size exchange', returnItems: [{ saleItemId: itemId, quantity: 1 }],
      replacementItems: [{ variantId, quantity: 1, unitSoldPrice: '12.50' }],
    })
    assert.deepEqual(calculateExchangePreview(sale, { [itemId]: 1 }, replacementCart()), { valid: true, returned: '10.00', replacement: '12.50', difference: '2.50' })
  })

  test('formats a negative exact difference without floating-point arithmetic', () => {
    const cheaper = [{ ...replacementCart()[0], unitSoldPrice: '3.25', quantity: 2 }]
    assert.deepEqual(calculateExchangePreview(sale, { [itemId]: 1 }, cheaper), { valid: true, returned: '10.00', replacement: '6.50', difference: '-3.50' })
  })

  test('reuses Exchange key for retry and creates a new key after replacement quantity changes', () => {
    const first = exchangeOperation({ sale, quantities: { [itemId]: 1 }, reason: '', replacementCart: replacementCart(), current: null, uuidFactory: () => exchangeKey }).operation
    assert.equal(exchangeOperation({ sale, quantities: { [itemId]: 1 }, reason: '', replacementCart: replacementCart(), current: first, uuidFactory: () => { throw Error('must not run') } }).operation, first)
    const changedCart = setCartQuantity(replacementCart(), variantId, 2).cart
    const changed = exchangeOperation({ sale, quantities: { [itemId]: 1 }, reason: '', replacementCart: changedCart, current: first, uuidFactory: () => returnKey }).operation
    assert.equal(changed.key, returnKey)
  })

  test('submits one Exchange endpoint request and accepts authoritative values', async () => {
    const operation = exchangeOperation({ sale, quantities: { [itemId]: 1 }, reason: '', replacementCart: replacementCart(), current: null, uuidFactory: () => exchangeKey }).operation
    let url; let request
    const result = await submitExchange({ supabase, saleId, operation, fetchImpl: async (input, options) => {
      url = input; request = options
      return json(201, { exchange: { id: exchangeKey, differenceAmount: '2.50', return: { totalRefund: '10.00' }, replacementSale: { totalAmount: '12.50' } }, idempotentReplay: false })
    } })
    assert.match(url, new RegExp(`/api/sales/${saleId}/exchanges$`))
    assert.equal(request.headers['Idempotency-Key'], exchangeKey)
    assert.deepEqual(JSON.parse(request.body), operation.payload)
    assert.equal(result.exchange.differenceAmount, '2.50')
  })

  test('maps stock, stale price, idempotency, and authorization errors without losing the operation', async () => {
    const operation = exchangeOperation({ sale, quantities: { [itemId]: 1 }, reason: '', replacementCart: replacementCart(), current: null, uuidFactory: () => exchangeKey }).operation
    const run = (status, code) => submitExchange({ supabase, saleId, operation, fetchImpl: async () => json(status, { error: { code, message: 'private' } }) })
    assert.equal((await run(409, 'INSUFFICIENT_STOCK')).refreshCatalog, true)
    assert.equal((await run(409, 'SALE_PRICE_CHANGED')).refreshCatalog, true)
    assert.match((await run(409, 'EXCHANGE_IDEMPOTENCY_CONFLICT')).message, /original exchange/)
    assert.equal((await run(403, 'ROLE_FORBIDDEN')).requiresLogin, undefined)
    assert.equal((await run(429, 'RATE_LIMITED')).retryable, true)
    assert.equal(operation.key, exchangeKey)
  })
})
