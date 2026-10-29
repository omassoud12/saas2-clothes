import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createSeedSalesState, UNCATEGORIZED_ID } from './mock-sales-data.js'
import { addCartSelection, cartTotals, completeMockSale, deleteMockCategory, productStock, setMockCartQuantity } from './mock-sales-model.js'
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
})
