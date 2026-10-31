import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createSeedSalesState, UNCATEGORIZED_ID } from './mock-sales-data.js'
import { addCartSelection, cartTotals, decrementCatalogStock, deleteMockCategory, discountedUnitCents, money, productStock, reconcileMockCart, restoreMockCartLine, setMockCartQuantity } from './mock-sales-model.js'
import { createMockSalesStorage } from './mock-sales-storage.js'
import { analyzeCart, checkoutFailure, effectiveDiscount, hasBlockingIssue, lineIssueText, prepareCheckout, receiptNumber, startOfLocalDayIso, summarizeSales, toSaleLines } from './pos-checkout.js'
import { submitSale } from './sale-flow.js'
import { buildReceipt, buildReceiptText, shareReceipt, whatsappUrl } from './pos-receipt.js'

const variant1 = '22222222-2222-4222-8222-222222222222'
const variant2 = '44444444-4444-4444-8444-444444444444'
const key1 = '33333333-3333-4333-8333-333333333333'
const key2 = '55555555-5555-4555-8555-555555555555'

function cartLine(overrides = {}) {
  return { key: variant1, variantId: variant1, productId: 'p1', colorId: 'p1:0', productName: 'Linen shirt', colorName: 'Blue', size: 'M',
    sku: 'LIN-M', priceCents: 2400, quantity: 2, stock: 5, ...overrides }
}

describe('local mock Sales model', () => {
  test('starts with eight products across the two default categories', () => {
    const state = createSeedSalesState()
    assert.deepEqual(state.categories.map(row => row.name), ['Tops', 'Bottoms'])
    assert.equal(state.products.length, 8)
    assert.ok(state.products.every(product => product.colors.length > 0 && productStock(product) >= 0))
  })

  test('tracks color and size stock while the cart reserves units', () => {
    const state = createSeedSalesState()
    const product = state.products[0]
    const color = product.colors[0]
    const size = color.sizes[0]
    const first = addCartSelection([], product, color, size, 2)
    assert.equal(first.ok, true)
    const second = addCartSelection(first.cart, product, color, size, 2)
    assert.equal(second.ok, true)
    assert.equal(second.cart[0].quantity, 4)
    assert.equal(addCartSelection(second.cart, product, color, size, 1).ok, false)
    assert.equal(setMockCartQuantity(second.cart, second.cart[0].key, 3)[0].quantity, 3)
  })

  test('applies the discount to each unit price and keeps screen totals equal to the payload', () => {
    const state = createSeedSalesState()
    const product = state.products[0]
    const color = product.colors[0]
    const size = color.sizes[0]
    const cart = addCartSelection([], product, color, size, 2).cart
    assert.deepEqual(cartTotals(cart, 10), { subtotalCents: 4800, discountCents: 480, totalCents: 4320 })
    // Per-unit rounding: 3 x 19.95 with 5% off is 3 x 18.95, not 5.0% of the 59.85 sum.
    const odd = [{ priceCents: 1995, quantity: 3 }]
    assert.equal(discountedUnitCents(1995, 5), 1895)
    assert.deepEqual(cartTotals(odd, 5), { subtotalCents: 5985, discountCents: 300, totalCents: 5685 })
    assert.equal(discountedUnitCents(1, 20), 1, 'a discounted price never reaches zero')
  })

  test('money uses the same format as the rest of the app', () => {
    assert.equal(money(4500, 'USD'), '45.00 USD')
    assert.equal(money(5, 'USD'), '0.05 USD')
    assert.equal(money(null, 'USD'), 'Price missing')
  })

  test('deleting a used category moves its products to Uncategorized', () => {
    const state = createSeedSalesState()
    const topIds = state.products.filter(product => product.categoryId === 'tops').map(product => product.id)
    const next = deleteMockCategory(state, 'tops')
    assert.equal(next.categories.some(row => row.id === 'tops'), false)
    assert.ok(next.products.filter(product => topIds.includes(product.id)).every(product => product.categoryId === UNCATEGORIZED_ID))
  })

  test('storage is isolated behind a replaceable adapter and no longer keeps local receipts', () => {
    const adapter = createMockSalesStorage({ getItem: () => null, setItem: () => {}, removeItem: () => {} })
    assert.equal(adapter.load, undefined)
    assert.equal(adapter.save, undefined)
    assert.deepEqual(adapter.loadCart('scope'), [])
  })

  function memoryStorage() {
    const values = new Map()
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  }

  function cartWithTwoLines() {
    // The live catalog always supplies variant ids; the seed fixtures do not.
    const [seed] = createSeedSalesState().products
    const product = { ...seed, colors: seed.colors.map(row => ({ ...row, sizes: row.sizes.map(size => ({ ...size, variantId: `variant-${row.id}-${size.name}` })) })) }
    const [color] = product.colors
    const first = addCartSelection([], product, color, color.sizes[0], 1)
    return { product, color, cart: addCartSelection(first.cart, product, color, color.sizes[1], 1).cart }
  }

  test('an unfinished cart persists per account and user and clears when emptied', () => {
    const adapter = createMockSalesStorage(memoryStorage())
    const { cart } = cartWithTwoLines()
    assert.equal(adapter.saveCart('account-a:user-1', cart), true)
    assert.deepEqual(adapter.loadCart('account-a:user-1'), cart)
    assert.deepEqual(adapter.loadCart('account-b:user-1'), [], 'another store never sees this cart')
    assert.deepEqual(adapter.loadCart(''), [])
    assert.equal(adapter.saveCart('account-a:user-1', []), true)
    assert.deepEqual(adapter.loadCart('account-a:user-1'), [])
  })

  test('a corrupted saved cart is ignored line by line', () => {
    const values = memoryStorage()
    const adapter = createMockSalesStorage(values)
    const { cart } = cartWithTwoLines()
    values.setItem('saas2.sales-cart.v1:scope', JSON.stringify([cart[0], { key: 'x', quantity: -1 }, null]))
    assert.deepEqual(adapter.loadCart('scope'), [cart[0]])
    values.setItem('saas2.sales-cart.v1:scope', '{not json')
    assert.deepEqual(adapter.loadCart('scope'), [])
  })

  test('a restored cart is reconciled with the live catalog', () => {
    const { product, color, cart } = cartWithTwoLines()
    const unchanged = reconcileMockCart(cart, [product])
    assert.equal(unchanged.changed, false)
    const [firstSize, secondSize] = color.sizes
    const live = { ...product, colors: [{ ...color, sizes: [{ ...firstSize, stock: 0 }, { ...secondSize, priceCents: 3100 }] }] }
    const next = reconcileMockCart(cart, [live])
    assert.equal(next.changed, true)
    assert.equal(next.cart.length, 1, 'a sold-out variant is dropped')
    assert.equal(next.cart[0].priceCents, 3100)
    assert.equal(reconcileMockCart(cart, []).cart.length, 0)
  })

  test('undo puts a removed line back where it was, once', () => {
    const { cart } = cartWithTwoLines()
    const [first, second] = cart
    const removed = cart.filter(row => row.key !== first.key)
    assert.deepEqual(restoreMockCartLine(removed, first, 0).map(row => row.key), [first.key, second.key])
    assert.equal(restoreMockCartLine(cart, first, 0), cart, 'no duplicate when the line is already back')
  })

  test('a pending checkout record is stored per user and rejected when it was tampered with', () => {
    const values = memoryStorage()
    const adapter = createMockSalesStorage(values)
    const operation = prepareCheckout({ cart: [cartLine()], role: 'OWNER', discountPercent: 10, uuidFactory: () => key1 })
    const record = { ...operation.operation, summary: operation.summary }
    assert.equal(adapter.saveCheckout('a:u', record), true)
    assert.deepEqual(adapter.loadCheckout('a:u'), record)
    assert.equal(adapter.loadCheckout('b:u'), null)
    values.setItem('saas2.sales-checkout.v1:a:u', JSON.stringify({ ...record, payload: { items: [{ ...record.payload.items[0], quantity: 9 }] } }))
    assert.equal(adapter.loadCheckout('a:u'), null, 'a payload that no longer matches its signature is ignored')
    assert.equal(adapter.saveCheckout('a:u', null), true)
    assert.equal(adapter.loadCheckout('a:u'), null)
  })

  test('maps the cart to the sale payload with the discount applied to each unit price', () => {
    const cart = [cartLine({ priceCents: 1995, quantity: 3 }), cartLine({ key: variant2, variantId: variant2, priceCents: 5000, quantity: 1 })]
    assert.deepEqual(toSaleLines(cart, 5), [
      { variantId: variant1, quantity: 3, unitSoldPrice: '18.95' },
      { variantId: variant2, quantity: 1, unitSoldPrice: '47.50' },
    ])
    const prepared = prepareCheckout({ cart, role: 'OWNER', discountPercent: 5, uuidFactory: () => key1 })
    assert.equal(prepared.ok, true)
    assert.deepEqual(prepared.operation.payload, { items: toSaleLines(cart, 5) })
    assert.equal(prepared.summary.totalCents, cartTotals(cart, 5).totalCents, 'the sent total equals the screen total')
    assert.equal(prepared.summary.listSubtotalCents, 10_985)
  })

  test('the screen total always equals the sent total for every discount and many prices', () => {
    for (const percent of [0, 5, 10, 20]) {
      for (const priceCents of [1, 99, 100, 1995, 2499, 99_999]) {
        for (const quantity of [1, 2, 7]) {
          const cart = [cartLine({ priceCents, quantity, stock: 10 })]
          const prepared = prepareCheckout({ cart, role: 'OWNER', discountPercent: percent, uuidFactory: () => key1 })
          assert.equal(prepared.ok, true, `${percent}% of ${priceCents} x ${quantity}`)
        }
      }
    }
  })

  test('a WAREHOUSE user never sends a discount', () => {
    const cart = [cartLine({ priceCents: 2400 })]
    assert.equal(effectiveDiscount('WAREHOUSE', 20), 0)
    const prepared = prepareCheckout({ cart, role: 'WAREHOUSE', discountPercent: 20, uuidFactory: () => key1 })
    assert.equal(prepared.operation.payload.items[0].unitSoldPrice, '24.00')
    assert.equal(prepared.summary.discountPercent, 0)
  })

  test('the Idempotency-Key is reused for the same cart and changes only when the cart changes', () => {
    let calls = 0
    const uuidFactory = () => (calls += 1) === 1 ? key1 : key2
    const cart = [cartLine()]
    const first = prepareCheckout({ cart, role: 'OWNER', discountPercent: 0, uuidFactory })
    const again = prepareCheckout({ cart, role: 'OWNER', discountPercent: 0, current: first.operation, uuidFactory })
    assert.equal(again.operation.key, key1)
    const changed = prepareCheckout({ cart: [cartLine({ quantity: 3 })], role: 'OWNER', discountPercent: 0, current: first.operation, uuidFactory })
    assert.equal(changed.operation.key, key2)
    const discounted = prepareCheckout({ cart, role: 'OWNER', discountPercent: 10, current: first.operation, uuidFactory: () => key2 })
    assert.equal(discounted.operation.key, key2, 'a different discount is a different sale')
  })

  test('rejects an invalid cart before anything is sent', () => {
    assert.equal(prepareCheckout({ cart: [], role: 'OWNER', discountPercent: 0 }).ok, false)
    assert.equal(prepareCheckout({ cart: [cartLine({ variantId: 'not-a-uuid' })], role: 'OWNER', discountPercent: 0 }).ok, false)
    assert.equal(prepareCheckout({ cart: [cartLine({ priceCents: null })], role: 'OWNER', discountPercent: 0 }).ok, false)
  })

  test('a retry after a network failure sends the same Idempotency-Key and payload', async () => {
    const seen = []
    const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'user' }, access_token: 'synthetic-test-token' } } } } } }
    const sale = { id: key2, status: 'COMPLETED', currency: 'USD', subtotal: '48.00', totalAmount: '43.20', createdAt: '2026-10-14T10:30:00.000Z', seller: { name: 'Owner', employeeCode: null }, items: [] }
    const fetchImpl = async (input, init) => {
      seen.push({ key: init.headers['Idempotency-Key'] ?? new Headers(init.headers).get('Idempotency-Key'), body: init.body })
      if (seen.length === 1) throw new TypeError('network down')
      return new Response(JSON.stringify({ sale, idempotentReplay: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const prepared = prepareCheckout({ cart: [cartLine()], role: 'OWNER', discountPercent: 10, uuidFactory: () => key1 })
    const first = await submitSale({ supabase, fetchImpl, operation: prepared.operation })
    assert.equal(first.ok, false)
    assert.equal(checkoutFailure(first).uncertain, true, 'a network failure must lock the cart for a safe retry')
    const retry = await submitSale({ supabase, fetchImpl, operation: prepared.operation })
    assert.equal(retry.ok, true)
    assert.equal(retry.idempotentReplay, true)
    assert.equal(seen[0].key, key1)
    assert.equal(seen[1].key, key1)
    assert.equal(seen[0].body, seen[1].body)
    assert.deepEqual(JSON.parse(seen[0].body), { items: [{ variantId: variant1, quantity: 2, unitSoldPrice: '21.60' }] })
  })

  test('explains each backend failure in simple words', () => {
    assert.equal(checkoutFailure({ ok: false, code: 'X', retryable: true, message: 'raw' }).uncertain, true)
    assert.equal(checkoutFailure({ ok: false, code: 'INSUFFICIENT_STOCK', refreshCatalog: true, message: 'raw' }).refresh, 'stock')
    assert.match(checkoutFailure({ ok: false, code: 'INSUFFICIENT_STOCK', message: 'raw' }).message, /Your cart was not changed/)
    assert.equal(checkoutFailure({ ok: false, code: 'SALE_PRICE_CHANGED', refreshCatalog: true, message: 'raw' }).refresh, 'prices')
    assert.equal(checkoutFailure({ ok: false, code: 'SALE_VARIANT_UNAVAILABLE', refreshCatalog: true, message: 'Gone' }).refresh, 'stock')
    assert.equal(checkoutFailure({ ok: false, code: 'SESSION_REQUIRED', requiresLogin: true, message: 'Sign in' }).requiresLogin, true)
    const validation = checkoutFailure({ ok: false, code: 'INVALID_SALE_PRICE', message: 'Every cart item needs a valid selling price.' })
    assert.equal(validation.uncertain, false)
    assert.equal(validation.message, 'Every cart item needs a valid selling price.')
  })

  test('shows which items are short after a stock failure without touching the quantities', () => {
    const cart = [cartLine({ quantity: 3, stock: 5 }), cartLine({ key: variant2, variantId: variant2, productName: 'Wool coat', quantity: 1, stock: 4 })]
    const live = [{ name: 'Linen shirt', priceCents: 2400, colors: [{ name: 'Blue', sizes: [{ variantId: variant1, name: 'M', stock: 2, priceCents: 2400 }, { variantId: variant2, name: 'M', stock: 0, priceCents: 2400 }] }] }]
    const analysis = analyzeCart(cart, live)
    assert.deepEqual(analysis.cart.map(line => [line.quantity, line.stock]), [[3, 2], [1, 0]])
    assert.deepEqual(analysis.issues.map(issue => [issue.kind, issue.available]), [['short', 2], ['gone', 0]])
    assert.match(lineIssueText(analysis.issues[0], 'USD'), /Only 2 left/)
    assert.equal(hasBlockingIssue(analysis.cart), true)
    assert.equal(analyzeCart(cart, [], {}).issues.every(issue => issue.kind === 'gone'), true)
  })

  test('refreshes prices only when asked (WAREHOUSE price mismatch)', () => {
    const cart = [cartLine({ quantity: 1, stock: 5 })]
    const live = [{ name: 'Linen shirt', priceCents: 2600, colors: [{ name: 'Blue', sizes: [{ variantId: variant1, name: 'M', stock: 5, priceCents: 2600 }] }] }]
    assert.equal(analyzeCart(cart, live).cart[0].priceCents, 2400)
    const refreshed = analyzeCart(cart, live, { prices: true })
    assert.equal(refreshed.cart[0].priceCents, 2600)
    assert.match(lineIssueText(refreshed.issues[0], 'USD'), /24\.00 USD to 26\.00 USD/)
  })

  test('applies a confirmed sale to the loaded stock and summarizes today from server sales', () => {
    const product = { id: 'p1', colors: [{ sizes: [{ variantId: variant1, stock: 5 }, { variantId: variant2, stock: 1 }] }] }
    const next = decrementCatalogStock([product], [{ variantId: variant1, quantity: 2 }, { variantId: variant2, quantity: 3 }])
    assert.deepEqual(next[0].colors[0].sizes.map(size => size.stock), [3, 0])
    assert.equal(product.colors[0].sizes[0].stock, 5, 'the input is not mutated')
    const summary = summarizeSales([
      { status: 'COMPLETED', totalAmount: '12.50' }, { status: 'COMPLETED', totalAmount: '25.00' }, { status: 'VOIDED', totalAmount: '99.00' },
    ], 'USD')
    assert.deepEqual(summary, { count: 2, total: '37.50 USD' })
    assert.equal(receiptNumber('a1b2c3d4-0000-4000-8000-000000000000'), '#A1B2C3D4')
    assert.match(startOfLocalDayIso(new Date(2026, 9, 14, 15, 30)), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
  })

  const discountedSale = { id: 'a1b2c3d4-0000-4000-8000-000000000000', currency: 'USD', subtotal: '43.20', totalAmount: '43.20', createdAt: '2026-10-14T10:30:00.000Z',
    items: [{ id: 'i1', productName: 'Linen shirt', color: 'Blue', size: 'M', quantity: 2, unitSoldPrice: '21.60', lineTotal: '43.20' }] }
  const plainSale = { ...discountedSale, subtotal: '143.20', totalAmount: '143.20', items: [
    { id: 'i1', productName: 'Linen shirt', color: 'Blue', size: 'M', quantity: 2, unitSoldPrice: '21.60', lineTotal: '43.20' },
    { id: 'i2', productName: 'Wool coat', color: null, size: null, quantity: 1, unitSoldPrice: '100.00', lineTotal: '100.00' }] }
  const discountSummary = { discountPercent: 10, listSubtotalCents: 4800, totalCents: 4320 }

  test('the receipt shows the server sale with the discount taken from the checked-out cart', () => {
    const receipt = buildReceipt({ sale: discountedSale, summary: discountSummary, storeName: ' Mini Store ', locale: 'en-GB', timeZone: 'UTC' })
    assert.equal(receipt.storeName, 'Mini Store')
    assert.equal(receipt.number, '#A1B2C3D4')
    assert.match(receipt.dateText, /14 Oct 2026/)
    assert.match(receipt.dateText, /10:30/)
    assert.deepEqual(receipt.lines.map(line => [line.name, line.detail, line.quantity, line.unitPrice, line.lineTotal]), [['Linen shirt', 'Blue · M', 2, '21.60 USD', '43.20 USD']])
    assert.deepEqual([receipt.subtotal, receipt.discount, receipt.discountPercent, receipt.total, receipt.units], ['48.00 USD', '4.80 USD', 10, '43.20 USD', 2])
    assert.equal(JSON.stringify(receipt).includes('Cash'), false, 'no payment method is shown')
  })

  test('a sale without a discount shows only the total, and items without color or size stay clean', () => {
    const receipt = buildReceipt({ sale: plainSale, storeName: '', locale: 'en-GB', timeZone: 'UTC' })
    assert.equal(receipt.discount, null)
    assert.equal(receipt.discountPercent, null)
    assert.equal(receipt.subtotal, '143.20 USD')
    assert.equal(receipt.total, '143.20 USD')
    assert.equal(receipt.lines[1].detail, '')
    const none = buildReceipt({ sale: discountedSale, summary: { discountPercent: 0, listSubtotalCents: 4320, totalCents: 4320 } })
    assert.equal(none.discount, null)
  })

  test('the WhatsApp text is a clean receipt and long carts are shortened', () => {
    const text = buildReceiptText(buildReceipt({ sale: discountedSale, summary: discountSummary, storeName: 'Mini Store', locale: 'en-GB', timeZone: 'UTC' }))
    for (const part of ['*Mini Store*', 'Receipt #A1B2C3D4', 'Linen shirt (Blue · M)', '  2 × 21.60 USD = 43.20 USD', 'Subtotal: 48.00 USD', 'Discount (10%): -4.80 USD', '*Total: 43.20 USD*', 'Thank you!']) {
      assert.ok(text.includes(part), part)
    }
    assert.equal(/payment|cash|card/i.test(text), false)
    const plain = buildReceiptText(buildReceipt({ sale: plainSale }), { maxItems: 1 })
    assert.equal(plain.includes('Subtotal:'), false)
    assert.ok(plain.includes('…and 1 more item'))
    assert.equal(plain.includes('Wool coat'), false)
    const url = whatsappUrl(text)
    assert.ok(url.startsWith('https://wa.me/?text='))
    assert.equal(decodeURIComponent(url.slice('https://wa.me/?text='.length)), text)
  })

  test('sharing uses the share sheet when there is one and falls back to WhatsApp otherwise', async () => {
    const receipt = buildReceipt({ sale: discountedSale, summary: discountSummary })
    const shared = []
    const opened = []
    const open = url => { opened.push(url); return { opener: 'x' } }
    assert.deepEqual(await shareReceipt(receipt, { nav: { share: async data => { shared.push(data) } }, open }), { ok: true, method: 'share' })
    assert.ok(shared[0].text.includes('43.20 USD'))
    assert.equal(opened.length, 0)
    const cancel = Object.assign(new Error('closed'), { name: 'AbortError' })
    assert.deepEqual(await shareReceipt(receipt, { nav: { share: async () => { throw cancel } }, open }), { ok: true, method: 'cancelled' })
    assert.equal(opened.length, 0, 'cancelling the share sheet does not open WhatsApp')
    assert.deepEqual(await shareReceipt(receipt, { nav: { share: async () => { throw new Error('unsupported') } }, open }), { ok: true, method: 'whatsapp' })
    assert.deepEqual(await shareReceipt(receipt, { nav: {}, open }), { ok: true, method: 'whatsapp' })
    assert.ok(opened.every(url => url.startsWith('https://wa.me/?text=')))
    assert.deepEqual(await shareReceipt(receipt, { nav: {}, open: () => null }), { ok: false, method: 'blocked' })
  })
})
