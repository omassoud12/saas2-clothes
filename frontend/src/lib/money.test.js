import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { formatMoney, summarizeProductCatalog } from './money.js'

describe('decimal-safe money presentation', () => {
  test('uses the authoritative currency for OWNER and WAREHOUSE display', () => {
    assert.equal(formatMoney('12', 'LBP'), '12.00 LBP')
    assert.equal(formatMoney('25.5', 'EUR'), '25.50 EUR')
  })

  test('does not guess a currency or coerce invalid decimal values', () => {
    assert.equal(formatMoney('12.00', undefined), 'Unavailable')
    assert.equal(formatMoney(12.00, 'USD'), 'Unavailable')
    assert.equal(formatMoney('12.001', 'USD'), 'Unavailable')
    assert.equal(formatMoney('9007199254740993.25', 'USD'), '9007199254740993.25 USD')
  })

  test('catalog summary fails safely when tenant currency is missing', () => {
    assert.equal(summarizeProductCatalog({ variants: [{ sellingPrice: '12.00', currentStock: 1 }] }).price, 'Currency unavailable')
    assert.equal(summarizeProductCatalog({ variants: [{ sellingPrice: '12.345', currentStock: 1 }] }, 'USD').price, 'Price unavailable')
  })

  test('summarizes variant price range and stock without floating-point arithmetic', () => {
    const summary = summarizeProductCatalog({ variants: [
      { sellingPrice: '25.50', currentStock: 4 },
      { sellingPrice: '12.00', currentStock: 3 },
      { sellingPrice: null, currentStock: 0 },
    ] }, 'EUR')
    assert.deepEqual(summary, { stock: '7', price: '12.00 EUR – 25.50 EUR' })
  })
})
