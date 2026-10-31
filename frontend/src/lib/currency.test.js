import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { calculateChange, lbpToUsdCents, parseLbpAmount, parseRate, parseUsdAmount, usdCentsToLbp } from './currency.js'

describe('exchange rate', () => {
  test('reads a positive rate with up to two decimals', () => {
    assert.equal(parseRate('89500'), 8950000n)
    assert.equal(parseRate('89500.5'), 8950050n)
    assert.equal(parseRate(' 90000.00 '), 9000000n)
    for (const bad of [null, undefined, '', '0', '0.00', '-5', 'abc', '1.234', {}, []]) assert.equal(parseRate(bad), null)
  })
})

describe('USD to LBP', () => {
  test('converts cents to whole pounds, rounding half up', () => {
    assert.equal(usdCentsToLbp(100, '89500'), 89500)
    assert.equal(usdCentsToLbp(8100, '89500'), 7249500)
    assert.equal(usdCentsToLbp(1, '89500'), 895)
    assert.equal(usdCentsToLbp(0, '89500'), 0)
    // 3 cents at 89500.50 = 2685.015 -> 2685; 5 cents = 4475.025 -> 4475; 1 cent at 50.00 = 0.5 -> 1 (half up)
    assert.equal(usdCentsToLbp(3, '89500.50'), 2685)
    assert.equal(usdCentsToLbp(5, '89500.50'), 4475)
    assert.equal(usdCentsToLbp(1, '50'), 1)
    assert.equal(usdCentsToLbp(1, '49.99'), 0)
  })

  test('refuses a missing rate or a bad amount', () => {
    assert.equal(usdCentsToLbp(100, null), null)
    assert.equal(usdCentsToLbp(100, '0'), null)
    assert.equal(usdCentsToLbp(-1, '89500'), null)
    assert.equal(usdCentsToLbp(1.5, '89500'), null)
  })

  test('large totals stay exact', () => {
    assert.equal(usdCentsToLbp(123456789, '89500.25'), 110494134797)
    assert.equal(usdCentsToLbp(99999999999, '1000000000'), null, 'a result beyond the safe integer range is refused, never rounded')
  })
})

describe('LBP to USD', () => {
  test('converts pounds to cents, rounding half up', () => {
    assert.equal(lbpToUsdCents(89500, '89500'), 100)
    assert.equal(lbpToUsdCents(40000, '89500'), 45)
    assert.equal(lbpToUsdCents(0, '89500'), 0)
    assert.equal(lbpToUsdCents(447, '89500'), 0)
    assert.equal(lbpToUsdCents(448, '89500'), 1)
    assert.equal(lbpToUsdCents(10, null), null)
  })
})

describe('typed amounts', () => {
  test('LBP accepts digits with separators and no decimals', () => {
    assert.equal(parseLbpAmount('1,500,000'), 1500000)
    assert.equal(parseLbpAmount('1 500 000'), 1500000)
    assert.equal(parseLbpAmount(''), 0)
    assert.equal(parseLbpAmount(undefined), 0)
    for (const bad of ['1.5', '-5', 'abc', '1e6', '12345678901234']) assert.equal(parseLbpAmount(bad), null)
  })

  test('USD accepts up to two decimals', () => {
    assert.equal(parseUsdAmount('20'), 2000)
    assert.equal(parseUsdAmount('12.5'), 1250)
    assert.equal(parseUsdAmount('0.05'), 5)
    assert.equal(parseUsdAmount(''), 0)
    for (const bad of ['1.234', '-1', 'x', '1,5,5.']) assert.equal(parseUsdAmount(bad), null)
  })
})

describe('change at the till', () => {
  const total = 8100 // $81 = 7,249,500 LBP at 89,500

  test('nothing received yet', () => {
    assert.deepEqual(calculateChange({ totalCents: total, rate: '89500' }), { status: 'none', totalLbp: 7249500, difference: null })
    assert.deepEqual(calculateChange({ totalCents: total }), { status: 'none', totalLbp: null, difference: null })
  })

  test('paid in dollars only: change comes back in pounds and dollars', () => {
    const result = calculateChange({ totalCents: total, rate: '89500', receivedUsdCents: 10000 })
    assert.equal(result.status, 'change')
    assert.equal(result.difference.lbp, 1700500) // $100 = 8,950,000; minus 7,249,500
    assert.equal(result.difference.usdCents, 1900) // about $19.00
  })

  test('paid in pounds only', () => {
    const exact = calculateChange({ totalCents: total, rate: '89500', receivedLbp: 7249500 })
    assert.equal(exact.status, 'exact'); assert.equal(exact.difference.lbp, 0)
    const short = calculateChange({ totalCents: total, rate: '89500', receivedLbp: 7000000 })
    assert.equal(short.status, 'short'); assert.equal(short.difference.lbp, 249500); assert.equal(short.difference.usdCents, 279)
  })

  test('paid in both currencies', () => {
    // $50 + 3,000,000 LBP = 4,475,000 + 3,000,000 = 7,475,000; total 7,249,500 -> change 225,500
    const result = calculateChange({ totalCents: total, rate: '89500', receivedUsdCents: 5000, receivedLbp: 3000000 })
    assert.equal(result.status, 'change'); assert.equal(result.difference.lbp, 225500); assert.equal(result.difference.usdCents, 252)
  })

  test('without a rate only dollars are compared', () => {
    assert.deepEqual(calculateChange({ totalCents: total, receivedUsdCents: 10000 }), { status: 'change', totalLbp: null, difference: { usdCents: 1900, lbp: null } })
    assert.equal(calculateChange({ totalCents: total, receivedUsdCents: 8100 }).status, 'exact')
    assert.deepEqual(calculateChange({ totalCents: total, receivedUsdCents: 5000 }), { status: 'short', totalLbp: null, difference: { usdCents: 3100, lbp: null } })
    assert.equal(calculateChange({ totalCents: total, receivedLbp: 5000000 }).status, 'none', 'pounds mean nothing without a rate')
  })

  test('the LBP total is rounded once, so received and total are compared in whole pounds', () => {
    // $0.03 at 89,500.50 -> 2,685 LBP; paying exactly 2,685 LBP is exact
    assert.equal(calculateChange({ totalCents: 3, rate: '89500.50', receivedLbp: 2685 }).status, 'exact')
  })
})
