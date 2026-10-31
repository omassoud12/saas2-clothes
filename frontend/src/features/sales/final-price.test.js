import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { cartTotals, lineUnitCents, setMockLinePrice } from './mock-sales-model.js'
import { prepareCheckout, toSaleLines } from './pos-checkout.js'
import { translate } from '../../i18n/translate.js'

const variant = '22222222-2222-4222-8222-222222222222'
const key = '33333333-3333-4333-8333-333333333333'
const line = (overrides = {}) => ({ key: 'k1', variantId: variant, productId: 'p', colorId: 'c', productName: 'Linen shirt', colorName: 'Blue', size: 'M', priceCents: 3000, quantity: 3, stock: 10, ...overrides })

describe('the final price of a line', () => {
  test('is the catalog price until the owner types one', () => {
    assert.equal(lineUnitCents(line()), 3000)
    assert.equal(lineUnitCents(line({ finalPriceCents: 2700 })), 2700)
    assert.equal(lineUnitCents(line({ finalPriceCents: 0 })), 3000, 'zero is not a price')
    assert.equal(lineUnitCents(line({ finalPriceCents: 12.5 })), 3000)
    assert.equal(lineUnitCents(line(), 10), 2700, 'a percent still works when no final price is set')
  })

  test('setting and clearing it', () => {
    const cart = [line(), line({ key: 'k2', variantId: 'other' })]
    const set = setMockLinePrice(cart, 'k1', 2700)
    assert.equal(set[0].finalPriceCents, 2700); assert.equal(set[1].finalPriceCents, undefined)
    const cleared = setMockLinePrice(set, 'k1', null)
    assert.equal('finalPriceCents' in cleared[0], false)
    assert.equal(setMockLinePrice(cart, 'k1', -5)[0].finalPriceCents, undefined, 'a bad price changes nothing')
    assert.equal(setMockLinePrice(cart, 'missing', 100).length, 2)
  })

  test('totals show the discount the owner gave by setting a lower price', () => {
    const totals = cartTotals([line({ finalPriceCents: 2700 })])
    assert.deepEqual({ ...totals }, { subtotalCents: 9000, discountCents: 900, totalCents: 8100 })
    const higher = cartTotals([line({ finalPriceCents: 3500 })])
    assert.equal(higher.totalCents, 10500); assert.equal(higher.discountCents, -1500, 'a higher price is not a discount')
  })
})

describe('checkout with a final price', () => {
  test('an owner sends the final price as the unit price and no percent', () => {
    const cart = [line({ finalPriceCents: 2700 })]
    assert.deepEqual(toSaleLines(cart, 0), [{ variantId: variant, quantity: 3, unitSoldPrice: '27.00' }])
    const prepared = prepareCheckout({ cart, role: 'OWNER', discountPercent: 0, uuidFactory: () => key })
    assert.equal(prepared.ok, true)
    assert.deepEqual(prepared.operation.payload, { items: [{ variantId: variant, quantity: 3, unitSoldPrice: '27.00' }] })
    assert.equal(prepared.summary.totalCents, 8100); assert.equal(prepared.summary.listSubtotalCents, 9000)
  })

  test('a warehouse user always sells at the catalog price', () => {
    const prepared = prepareCheckout({ cart: [line({ finalPriceCents: 100 })], role: 'WAREHOUSE', discountPercent: 0, uuidFactory: () => key })
    assert.equal(prepared.operation.payload.items[0].unitSoldPrice, '30.00'); assert.equal(prepared.summary.totalCents, 9000)
  })

  test('the screen text for the price field is translated', () => {
    assert.equal(translate('ar', 'Final price each ({currency})', { currency: 'USD' }), 'السعر النهائي للقطعة (USD)')
  })
})
