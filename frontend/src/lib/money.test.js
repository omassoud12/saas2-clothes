import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { decimalToMinorUnits, formatMoney, formatMoneyCompact, formatSignedMoney, minorUnitsToDecimal, signedMinorUnitsToDecimal, summarizeProductCatalog } from './money.js'

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
    assert.deepEqual(summary, { stock: '7', inactiveStock:'0', price: '12.00 EUR – 25.50 EUR' })
  })

  test('converts exact decimal strings to and from minor units without Number', () => {
    assert.equal(decimalToMinorUnits('9007199254740993.25'), 900719925474099325n)
    assert.equal(minorUnitsToDecimal(900719925474099325n), '9007199254740993.25')
    assert.equal(decimalToMinorUnits('1.234'), null)
    assert.equal(decimalToMinorUnits(12), null)
  })

  test('formats signed Exchange differences exactly', () => {
    assert.equal(signedMinorUnitsToDecimal(-350n), '-3.50')
    assert.equal(signedMinorUnitsToDecimal(250n), '2.50')
    assert.equal(formatSignedMoney('-3.50', 'USD'), '-3.50 USD')
    assert.equal(formatSignedMoney('2.50', 'USD'), '2.50 USD')
  })
})

test('inactive stock is secondary and inactive prices do not pollute range',()=>{
 assert.deepEqual(summarizeProductCatalog({isActive:true,variants:[{isActive:true,currentStock:1,sellingPrice:'15'},{isActive:false,currentStock:9,sellingPrice:'99'}]},'USD'),{stock:'1',inactiveStock:'9',price:'15.00 USD'})

  test('compact money drops empty decimals and groups thousands', () => {
    assert.equal(formatMoneyCompact('12.00', 'USD'), '$12')
    assert.equal(formatMoneyCompact('12', 'USD'), '$12')
    assert.equal(formatMoneyCompact('12.50', 'USD'), '$12.50')
    assert.equal(formatMoneyCompact('12.5', 'USD'), '$12.50')
    assert.equal(formatMoneyCompact('0.00', 'USD'), '$0')
    assert.equal(formatMoneyCompact('0.05', 'USD'), '$0.05')
    assert.equal(formatMoneyCompact('1250.00', 'USD'), '$1,250')
    assert.equal(formatMoneyCompact('1234567.89', 'USD'), '$1,234,567.89')
    assert.equal(formatMoneyCompact('9.99', 'EUR'), '€9.99')
    assert.equal(formatMoneyCompact('7.00', 'GBP'), '£7')
  })

  test('compact money keeps the currency code when there is no symbol', () => {
    assert.equal(formatMoneyCompact('1500000.00', 'LBP'), '1,500,000 LBP')
    assert.equal(formatMoneyCompact('1500000.50', 'LBP'), '1,500,000.50 LBP')
  })

  test('compact money follows the requested precision and rejects what formatMoney rejects', () => {
    assert.equal(formatMoneyCompact('12.1234', 'USD', 4), '$12.1234')
    assert.equal(formatMoneyCompact('12.1200', 'USD', 4), '$12.12')
    assert.equal(formatMoneyCompact('12.00', undefined), 'Unavailable')
    assert.equal(formatMoneyCompact(12, 'USD'), 'Unavailable')
    assert.equal(formatMoneyCompact('12.001', 'USD'), 'Unavailable')
    assert.equal(formatMoneyCompact('-5.00', 'USD'), 'Unavailable')
  })
})
