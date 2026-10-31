import { decimalToMinorUnits } from './money.js'

// USD <-> LBP at the till. USD is the main currency; the owner sets how many Lebanese pounds one dollar is worth.
// Everything is whole numbers: USD in cents, LBP in pounds (no decimals), converted with exact integer math and
// rounded half up, so the same sale always shows the same LBP total.

// "89500" or "89500.50" -> 8950050n (hundredths of a pound per dollar); null when it is not a positive rate.
export function parseRate(rate) {
  if (typeof rate !== 'string' && typeof rate !== 'number') return null
  const hundredths = decimalToMinorUnits(String(rate).trim())
  return hundredths !== null && hundredths > 0n ? hundredths : null
}

function divideHalfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator
}

function toSafeNumber(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
}

// 8100 cents at 89500 LBP per dollar -> 7,249,500 pounds.
export function usdCentsToLbp(cents, rate) {
  const hundredths = parseRate(rate)
  if (hundredths === null || !Number.isSafeInteger(cents) || cents < 0) return null
  return toSafeNumber(divideHalfUp(BigInt(cents) * hundredths, 10000n))
}

// 90,000 pounds at 89500 -> 101 cents ($1.01).
export function lbpToUsdCents(lbp, rate) {
  const hundredths = parseRate(rate)
  if (hundredths === null || !Number.isSafeInteger(lbp) || lbp < 0) return null
  return toSafeNumber(divideHalfUp(BigInt(lbp) * 10000n, hundredths))
}

// Text a person typed: "1,500,000" or "1 500 000" -> 1500000. LBP has no decimals; an empty field is 0.
export function parseLbpAmount(text) {
  const clean = String(text ?? '').replace(/[\s,٬،]/g, '')
  if (clean === '') return 0
  return /^\d{1,13}$/.test(clean) ? Number(clean) : null
}

// "20" or "12.50" -> cents. An empty field is 0.
export function parseUsdAmount(text) {
  const clean = String(text ?? '').replace(/[\s,]/g, '')
  if (clean === '') return 0
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(clean)) return null
  const cents = decimalToMinorUnits(clean)
  return cents === null ? null : toSafeNumber(cents)
}

// What the customer handed over (USD and/or LBP) against the total: still due, exact, or change to give back.
// With a rate the difference is worked out in pounds and also shown in dollars; without one only dollars are used.
export function calculateChange({ totalCents, rate = null, receivedUsdCents = 0, receivedLbp = 0 }) {
  const usd = Number.isSafeInteger(receivedUsdCents) && receivedUsdCents >= 0 ? receivedUsdCents : 0
  const lbp = Number.isSafeInteger(receivedLbp) && receivedLbp >= 0 ? receivedLbp : 0
  const hasRate = parseRate(rate) !== null
  const totalLbp = hasRate ? usdCentsToLbp(totalCents, rate) : null
  if (usd === 0 && lbp === 0) return Object.freeze({ status: 'none', totalLbp, difference: null })

  if (!hasRate) {
    if (usd === 0) return Object.freeze({ status: 'none', totalLbp: null, difference: null })
    const diff = usd - totalCents
    return Object.freeze({
      status: diff === 0 ? 'exact' : diff > 0 ? 'change' : 'short',
      totalLbp: null,
      difference: Object.freeze({ usdCents: Math.abs(diff), lbp: null }),
    })
  }
  const receivedValueLbp = usdCentsToLbp(usd, rate) + lbp
  const diff = receivedValueLbp - totalLbp
  const amount = Math.abs(diff)
  return Object.freeze({
    status: diff === 0 ? 'exact' : diff > 0 ? 'change' : 'short',
    totalLbp,
    difference: Object.freeze({ usdCents: lbpToUsdCents(amount, rate), lbp: amount }),
  })
}
