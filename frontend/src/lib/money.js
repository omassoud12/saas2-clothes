const currencyPattern = /^[A-Z]{3}$/
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/

export function formatMoney(amount, currency, fractionDigits = 2) {
  if (typeof currency !== 'string' || !currencyPattern.test(currency)) return 'Unavailable'
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 4) return 'Unavailable'

  if (typeof amount !== 'string') return 'Unavailable'
  const text = amount
  const match = decimalPattern.exec(text)
  if (!match || (match[1]?.length ?? 0) > fractionDigits) return 'Unavailable'

  const [integer, fraction = ''] = text.split('.')
  const normalized = fractionDigits === 0
    ? integer
    : `${integer}.${fraction.padEnd(fractionDigits, '0')}`
  return `${normalized} ${currency}`
}

export function decimalToMinorUnits(amount, fractionDigits = 2) {
  if (typeof amount !== 'string' || !Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 4) return null
  const match = decimalPattern.exec(amount)
  if (!match || (match[1]?.length ?? 0) > fractionDigits) return null
  const [integer, fraction = ''] = amount.split('.')
  return BigInt(integer) * (10n ** BigInt(fractionDigits)) + BigInt(fraction.padEnd(fractionDigits, '0'))
}

export function minorUnitsToDecimal(amount, fractionDigits = 2) {
  if (typeof amount !== 'bigint' || amount < 0n || !Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 4) return null
  if (fractionDigits === 0) return amount.toString()
  const scale = 10n ** BigInt(fractionDigits)
  return `${amount / scale}.${(amount % scale).toString().padStart(fractionDigits, '0')}`
}

export function signedMinorUnitsToDecimal(amount, fractionDigits = 2) {
  if (typeof amount !== 'bigint') return null
  const absolute = minorUnitsToDecimal(amount < 0n ? -amount : amount, fractionDigits)
  return absolute === null ? null : `${amount < 0n ? '-' : ''}${absolute}`
}

export function formatSignedMoney(amount, currency, fractionDigits = 2) {
  if (typeof amount !== 'string') return 'Unavailable'
  const negative = amount.startsWith('-')
  const formatted = formatMoney(negative ? amount.slice(1) : amount, currency, fractionDigits)
  return formatted === 'Unavailable' ? formatted : `${negative ? '-' : ''}${formatted}`
}

export function summarizeProductCatalog(product, currency) {
  const variants = Array.isArray(product?.variants) ? product.variants : []
  let stock = 0n
  let inactiveStock = 0n
  const prices = []

  for (const variant of variants) {
    if (variant.isActive === false || product.isActive === false) { if (Number.isInteger(variant.currentStock)) inactiveStock += BigInt(variant.currentStock); continue }
    if (Number.isInteger(variant?.currentStock)) stock += BigInt(variant.currentStock)
    const priceMatch = typeof variant?.sellingPrice === 'string' ? decimalPattern.exec(variant.sellingPrice) : null
    if (priceMatch && (priceMatch[1]?.length ?? 0) <= 2) {
      const [integer, fraction = ''] = variant.sellingPrice.split('.')
      prices.push({ raw: variant.sellingPrice, scaled: BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0')) })
    }
  }

  prices.sort((left, right) => left.scaled < right.scaled ? -1 : left.scaled > right.scaled ? 1 : 0)
  const unique = prices.filter((price, index) => index === 0 || price.scaled !== prices[index - 1].scaled)
  let price = 'Price unavailable'
  if (unique.length > 0 && (typeof currency !== 'string' || !currencyPattern.test(currency))) {
    price = 'Currency unavailable'
  } else if (unique.length === 1) {
    price = formatMoney(unique[0].raw, currency)
  } else if (unique.length > 1) {
    price = `${formatMoney(unique[0].raw, currency)} – ${formatMoney(unique.at(-1).raw, currency)}`
  }

  return Object.freeze({ stock: stock.toString(), inactiveStock: inactiveStock.toString(), price })
}
