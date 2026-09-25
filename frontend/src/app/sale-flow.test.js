import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  addVariantToCart, buildSalePayload, calculateCart, checkoutOperation, createCheckoutGuard,
  loadSaleHistory, reconcileCart, removeCartLine, setCartPrice, setCartQuantity, settleCheckout, submitSale,
} from './sale-flow.js'

const productId = '11111111-1111-4111-8111-111111111111'
const variantId = '22222222-2222-4222-8222-222222222222'
const key = '33333333-3333-4333-8333-333333333333'
const product = { id: productId, name: 'Linen shirt', category: { name: 'Shirts' }, imageUrl: null, isActive: true }
const variant = { id: variantId, sku: 'LIN-M', color: 'Blue', size: 'M', sellingPrice: '12.50', currentStock: 3, isActive: true, lastPurchaseCost: 'private' }
const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'user' }, access_token: 'synthetic-test-token' } } } } } }

function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
function cart(role = 'WAREHOUSE', candidate = variant) {
  return addVariantToCart([], product, candidate, role).cart
}

describe('POS cart and exact money', () => {
  test('selects a safe variant snapshot without OWNER financial data', () => {
    const result = addVariantToCart([], product, variant, 'WAREHOUSE')
    assert.equal(result.ok, true)
    assert.deepEqual(result.cart[0], {
      variantId, productName: 'Linen shirt', categoryName: 'Shirts', sku: 'LIN-M', color: 'Blue', size: 'M',
      imageUrl: null, availableStock: 3, quantity: 1, unitSoldPrice: '12.50',
    })
    assert.equal(JSON.stringify(result.cart).includes('lastPurchaseCost'), false)
  })

  test('adding the same variant increments within visible stock', () => {
    const first = cart()
    assert.equal(addVariantToCart(first, product, variant, 'WAREHOUSE').cart[0].quantity, 2)
    const full = setCartQuantity(first, variantId, 3).cart
    assert.equal(addVariantToCart(full, product, variant, 'WAREHOUSE').ok, false)
  })

  test('quantity increases, decreases, and removal preserve immutable cart behavior', () => {
    const original = cart()
    const increased = setCartQuantity(original, variantId, 2)
    assert.equal(original[0].quantity, 1)
    assert.equal(increased.cart[0].quantity, 2)
    assert.equal(setCartQuantity(increased.cart, variantId, 1).cart[0].quantity, 1)
    assert.deepEqual(removeCartLine(original, variantId), [])
  })

  test('calculates exact totals beyond Number safe integer precision', () => {
    const huge = [{ ...cart('OWNER')[0], quantity: 3, unitSoldPrice: '9007199254740993.25' }]
    assert.deepEqual(calculateCart(huge), { valid: true, units: 3, total: '27021597764222979.75' })
  })

  test('OWNER may set a valid override; WAREHOUSE may not', () => {
    assert.equal(setCartPrice(cart('OWNER'), variantId, '10.5', 'OWNER').cart[0].unitSoldPrice, '10.5')
    assert.equal(setCartPrice(cart(), variantId, '10.5', 'WAREHOUSE').code, 'POS_PRICE_FORBIDDEN')
    assert.equal(setCartPrice(cart('OWNER'), variantId, '0', 'OWNER').ok, false)
  })

  test('WAREHOUSE cannot add unpriced variants while OWNER may price them in cart', () => {
    const unpriced = { ...variant, sellingPrice: null }
    assert.equal(addVariantToCart([], product, unpriced, 'WAREHOUSE').code, 'POS_VARIANT_UNPRICED')
    const owner = addVariantToCart([], product, unpriced, 'OWNER')
    assert.equal(owner.ok, true)
    assert.equal(buildSalePayload(owner.cart).code, 'INVALID_SALE_PRICE')
    assert.equal(addVariantToCart([], product, { ...variant, sellingPrice: '0.00' }, 'WAREHOUSE').code, 'POS_VARIANT_UNPRICED')
  })

  test('catalog refresh reconciles visible stock and locked WAREHOUSE price', () => {
    const refreshed = reconcileCart(cart(), [{ ...product, variants: [{ ...variant, currentStock: 1, sellingPrice: '13.00' }] }], 'WAREHOUSE')
    assert.equal(refreshed[0].availableStock, 1)
    assert.equal(refreshed[0].unitSoldPrice, '13.00')
    assert.equal(reconcileCart(cart('OWNER'), [{ ...product, variants: [{ ...variant, sellingPrice: '13.00' }] }], 'OWNER')[0].unitSoldPrice, '12.50')
  })
})

describe('POS checkout contract and idempotency', () => {
  test('builds only the exact Sale payload with canonical price strings', () => {
    const built = buildSalePayload([{ ...cart()[0], quantity: 2, unitSoldPrice: '12.5', accountId: 'forged', currentStock: 99 }])
    assert.deepEqual(built.payload, { items: [{ variantId, quantity: 2, unitSoldPrice: '12.50' }] })
  })

  test('rejects prices beyond the backend precision contract', () => {
    assert.equal(buildSalePayload([{ ...cart()[0], unitSoldPrice: '10000000000000000.00' }]).code, 'INVALID_SALE_PRICE')
  })

  test('reuses one key for the same checkout and creates a new key after cart change', () => {
    const first = checkoutOperation(cart(), null, () => key).operation
    assert.equal(checkoutOperation(cart(), first, () => { throw Error('must not regenerate') }).operation, first)
    const nextKey = '44444444-4444-4444-8444-444444444444'
    const changed = checkoutOperation(setCartQuantity(cart(), variantId, 2).cart, first, () => nextKey).operation
    assert.equal(changed.key, nextKey)
    assert.notEqual(changed.signature, first.signature)
  })

  test('double-submit guard executes only one in-flight checkout', async () => {
    const guard = createCheckoutGuard()
    let release
    const pending = new Promise((resolve) => { release = resolve })
    const first = guard.run(() => pending)
    assert.deepEqual(await guard.run(() => 'duplicate'), { skipped: true })
    release('done')
    assert.deepEqual(await first, { skipped: false, value: 'done' })
  })

  test('submits exact payload and private idempotency header, returning authoritative total', async () => {
    const operation = checkoutOperation(cart(), null, () => key).operation
    let request
    const result = await submitSale({ supabase, operation, fetchImpl: async (_url, options) => {
      request = options
      return json(201, { sale: { id: productId, currency: 'LBP', totalAmount: '12.50', items: [{ id: variantId }] }, idempotentReplay: false })
    } })
    assert.equal(result.sale.totalAmount, '12.50')
    assert.equal(request.headers['Idempotency-Key'], key)
    assert.deepEqual(JSON.parse(request.body), operation.payload)
    assert.equal(JSON.stringify(request).includes('lastPurchaseCost'), false)
  })

  test('recoverable failures preserve operation semantics and stock conflicts request refresh', async () => {
    const operation = checkoutOperation(cart(), null, () => key).operation
    const network = await submitSale({ supabase, operation, fetchImpl: async () => { throw Error('private') } })
    assert.equal(network.retryable, true)
    const stock = await submitSale({ supabase, operation, fetchImpl: async () => json(409, { error: { code: 'INSUFFICIENT_STOCK', message: 'private' } }) })
    assert.equal(stock.refreshCatalog, true)
    assert.match(stock.message, /Stock changed/)
    assert.equal(settleCheckout(cart(), operation, network).cart.length, 1)
    assert.equal(settleCheckout(cart(), operation, network).operation, operation)
  })

  test('confirmed success clears cart and operation for a new logical Sale', () => {
    const operation = checkoutOperation(cart(), null, () => key).operation
    const sale = { id: productId, totalAmount: '12.50', currency: 'USD', items: [] }
    assert.deepEqual(settleCheckout(cart(), operation, { ok: true, sale }), { cart: [], operation: null, sale })
  })

  test('401, 403, idempotency conflict, and 429 remain distinct and safe', async () => {
    const operation = checkoutOperation(cart(), null, () => key).operation
    const run = (status, code) => submitSale({ supabase, operation, fetchImpl: async () => json(status, { error: { code, message: 'provider secret' } }) })
    assert.equal((await run(401, 'TOKEN_INVALID')).requiresLogin, true)
    assert.equal((await run(403, 'ROLE_FORBIDDEN')).requiresLogin, undefined)
    assert.match((await run(409, 'SALE_IDEMPOTENCY_CONFLICT')).message, /original attempt/)
    assert.equal((await run(429, 'RATE_LIMITED')).retryable, true)
  })
})

describe('Sales history frontend contract', () => {
  test('loads bounded cursor history with operational fields only', async () => {
    let url
    const result = await loadSaleHistory({ supabase, cursor: 'safe_cursor', fetchImpl: async (input) => {
      url = new URL(input, 'https://local.test')
      return json(200, { sales: [{ id: productId, status: 'COMPLETED', totalAmount: '12.50', currency: 'USD', itemCount: 1, totalUnits: 2, createdAt: '2026-09-25T10:00:00.000Z', seller: { name: 'Cashier', employeeCode: null } }], nextCursor: null })
    } })
    assert.equal(result.ok, true)
    assert.equal(url.searchParams.get('limit'), '10')
    assert.equal(url.searchParams.get('cursor'), 'safe_cursor')
    assert.equal(JSON.stringify(result).includes('unitCostAtSale'), false)
  })
})
