import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createSeedSalesState, UNCATEGORIZED_ID } from './mock-sales-data.js'
import { addCartSelection, cartTotals, completeMockSale, deleteMockCategory, productStock, reconcileMockCart, restoreMockCartLine, setMockCartQuantity } from './mock-sales-model.js'
import { createMockSalesStorage } from './mock-sales-storage.js'

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

  test('completes a discounted cash sale, decrements stock and creates a receipt', () => {
    const state = createSeedSalesState()
    const product = state.products[0]
    const color = product.colors[0]
    const size = color.sizes[0]
    const cart = addCartSelection([], product, color, size, 2).cart
    assert.deepEqual(cartTotals(cart, 10), { subtotalCents: 4800, discountCents: 480, totalCents: 4320 })
    const result = completeMockSale(state, cart, 10, 'Cash', new Date('2026-10-14T10:30:00Z'))
    assert.equal(result.ok, true)
    assert.equal(result.state.products[0].colors[0].sizes[0].stock, size.stock - 2)
    assert.equal(result.receipt.totalCents, 4320)
    assert.equal(result.receipt.paymentMethod, 'Cash')
    assert.equal(state.products[0].colors[0].sizes[0].stock, size.stock, 'input stays immutable')
  })

  test('deleting a used category moves its products to Uncategorized', () => {
    const state = createSeedSalesState()
    const topIds = state.products.filter(product => product.categoryId === 'tops').map(product => product.id)
    const next = deleteMockCategory(state, 'tops')
    assert.equal(next.categories.some(row => row.id === 'tops'), false)
    assert.ok(next.products.filter(product => topIds.includes(product.id)).every(product => product.categoryId === UNCATEGORIZED_ID))
  })

  test('storage is isolated behind a replaceable adapter', () => {
    const values = new Map()
    const adapter = createMockSalesStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) })
    const state = createSeedSalesState()
    state.receipts.push({ id: 'receipt-1' })
    assert.equal(adapter.save(state), true)
    assert.deepEqual(adapter.load(), { receipts: [{ id: 'receipt-1' }] })
    assert.equal(adapter.load().products, undefined, 'catalog products never persist as local mock data')
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
})
