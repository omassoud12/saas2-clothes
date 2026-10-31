import { decimalToMinorUnits, formatMoneyCompact, minorUnitsToDecimal } from '../../lib/money.js'
import { cartTotals, discountedUnitCents, money } from './mock-sales-model.js'
import { checkoutOperation } from './sale-flow.js'

// Cart -> POST /api/sales mapping and checkout error handling for the POS screen.
// The backend only accepts { items: [{ variantId, quantity, unitSoldPrice }] }, so a discount is applied to each unit price.

export const STOCK_REFRESH_CODES = Object.freeze(['INSUFFICIENT_STOCK', 'SALE_VARIANT_NOT_PRICED', 'SALE_VARIANT_UNAVAILABLE', 'SALE_PRODUCT_INACTIVE', 'SALE_VARIANT_INACTIVE', 'SALE_COST_UNAVAILABLE'])

function failure(code, message) { return Object.freeze({ ok: false, code, message }) }

export function canDiscount(role) { return role === 'OWNER' }

export function effectiveDiscount(role, discountPercent) { return canDiscount(role) ? discountPercent : 0 }

export function receiptNumber(saleId) { return `#${String(saleId).slice(0, 8).toUpperCase()}` }

export function toSaleLines(cart, discountPercent) {
  return cart.map(line => ({
    variantId: line.variantId,
    quantity: line.quantity,
    unitSoldPrice: Number.isSafeInteger(line.priceCents) && line.priceCents >= 0
      ? minorUnitsToDecimal(BigInt(discountedUnitCents(line.priceCents, discountPercent))) : '',
  }))
}

function payloadTotalCents(payload) {
  let total = 0n
  for (const item of payload.items) total += (decimalToMinorUnits(item.unitSoldPrice) ?? 0n) * BigInt(item.quantity)
  return total
}

// Reuses the Idempotency-Key while the payload is unchanged; a changed cart gets a new key.
export function prepareCheckout({ cart, role, discountPercent, current = null, uuidFactory }) {
  const percent = effectiveDiscount(role, discountPercent)
  const prepared = checkoutOperation(toSaleLines(cart, percent), current, uuidFactory)
  if (!prepared.ok) return prepared
  const totals = cartTotals(cart, percent)
  if (payloadTotalCents(prepared.operation.payload) !== BigInt(totals.totalCents)) {
    return failure('POS_TOTAL_MISMATCH', 'The total on screen does not match the sale. Reopen the cart and try again.')
  }
  return Object.freeze({
    ok: true,
    operation: prepared.operation,
    summary: Object.freeze({ discountPercent: percent, listSubtotalCents: totals.subtotalCents, totalCents: totals.totalCents }),
  })
}

export function checkoutFailure(result) {
  if (result.requiresLogin) return Object.freeze({ requiresLogin: true, uncertain: false, message: result.message })
  if (result.retryable) {
    return Object.freeze({ uncertain: true, refresh: null, message: 'We could not confirm the sale. It may have gone through. Press Try again: it will not create a duplicate.' })
  }
  if (result.code === 'INSUFFICIENT_STOCK') {
    return Object.freeze({ uncertain: false, refresh: 'stock', message: 'Some items do not have enough stock. Your cart was not changed. Fix the items marked below.' })
  }
  if (result.code === 'SALE_PRICE_CHANGED') {
    return Object.freeze({ uncertain: false, refresh: 'prices', message: 'A price changed after you added it. Prices were updated. Check the total and try again.' })
  }
  return Object.freeze({ uncertain: false, refresh: result.refreshCatalog || STOCK_REFRESH_CODES.includes(result.code) ? 'stock' : null, message: result.message })
}

// Compares the cart with freshly loaded catalog products. Quantities are never changed here.
export function analyzeCart(cart, products, { prices = false } = {}) {
  const variants = new Map()
  for (const product of products) {
    for (const color of product.colors) for (const size of color.sizes) variants.set(size.variantId, { product, size })
  }
  const issues = []
  const next = cart.map(line => {
    const found = variants.get(line.variantId)
    const label = `${line.productName} · ${line.colorName} · ${line.size}`
    if (!found) {
      issues.push({ key: line.key, kind: 'gone', available: 0, label })
      return { ...line, stock: 0 }
    }
    const row = { ...line, stock: found.size.stock }
    const price = Number.isSafeInteger(found.size.priceCents) ? found.size.priceCents : found.product.priceCents
    if (prices && Number.isSafeInteger(price) && price !== line.priceCents) {
      issues.push({ key: line.key, kind: 'price', from: line.priceCents, to: price, label })
      row.priceCents = price
    }
    if (found.size.stock < line.quantity) {
      issues.push({ key: line.key, kind: found.size.stock === 0 ? 'gone' : 'short', available: found.size.stock, label })
    }
    return row
  })
  return Object.freeze({ cart: next, issues })
}

export function lineIssueText(issue, currency) {
  if (issue.kind === 'price') return `Price changed from ${money(issue.from, currency)} to ${money(issue.to, currency)}.`
  if (issue.kind === 'gone') return 'No longer available. Remove it from the cart.'
  return `Only ${issue.available} left. Lower the quantity to ${issue.available} or less.`
}

export function hasBlockingIssue(cart) {
  return cart.some(line => line.quantity > line.stock)
}

export function startOfLocalDayIso(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
}

export function summarizeSales(sales, currency) {
  const completed = sales.filter(sale => sale.status === 'COMPLETED')
  let total = 0n
  for (const sale of completed) total += decimalToMinorUnits(sale.totalAmount) ?? 0n
  return Object.freeze({ count: completed.length, total: formatMoneyCompact(minorUnitsToDecimal(total), currency) })
}
