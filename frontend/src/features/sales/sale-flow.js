import { authenticatedApiRequest } from '../../auth/owner-flow.js'
import { decimalToMinorUnits, minorUnitsToDecimal } from '../../lib/money.js'

export const POS_PAGE_SIZE = 12
const maxLines = 100
const maxQuantity = 1_000_000
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const salePricePattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/

const safeMessages = {
  INSUFFICIENT_STOCK: 'Stock changed before checkout. Review the cart quantities and try again.',
  SALE_PRICE_CHANGED: 'A catalog price changed before checkout. Prices have been refreshed; review the cart and try again.',
  SALE_VARIANT_NOT_PRICED: 'An item no longer has a selling price and cannot be sold.',
  SALE_VARIANT_UNAVAILABLE: 'An item is no longer available. Review the refreshed catalog.',
  SALE_PRODUCT_INACTIVE: 'A product in the cart is no longer active.',
  SALE_VARIANT_INACTIVE: 'A variant in the cart is no longer active.',
  SALE_IDEMPOTENCY_CONFLICT: 'This checkout no longer matches its original attempt. Review the cart and start a new sale.',
  SALE_CART_TOO_LARGE: 'A sale may contain at most 100 different variants.',
  SALE_TOTAL_OVERFLOW: 'The sale total exceeds the supported limit.',
}

function failure(code, message, extra = {}) { return Object.freeze({ ok: false, code, message, ...extra }) }

function mapFailure(result) {
  if (result.code === 'SESSION_REQUIRED' || result.status === 401) {
    return failure(result.code, 'Your session has expired. Sign in again.', { requiresLogin: true })
  }
  if (result.status === 403) return failure(result.code, 'You are not authorized to complete this sale.')
  if (result.status === 429) return failure(result.code, 'Checkout is temporarily limited. Wait a moment and retry the same sale.', { retryable: true })
  const refreshCatalog = ['INSUFFICIENT_STOCK', 'SALE_PRICE_CHANGED', 'SALE_VARIANT_NOT_PRICED', 'SALE_VARIANT_UNAVAILABLE', 'SALE_PRODUCT_INACTIVE', 'SALE_VARIANT_INACTIVE', 'SALE_COST_UNAVAILABLE'].includes(result.code)
  return failure(result.code, safeMessages[result.code] || 'The sale could not be completed. Please try again.', {
    ...(refreshCatalog ? { refreshCatalog: true } : {}),
    ...(!result.status || result.status >= 500 ? { retryable: true } : {}),
  })
}

function safeLine(product, variant, role) {
  if (!product?.isActive || !variant?.isActive || !Number.isInteger(variant.currentStock) || variant.currentStock <= 0) {
    return failure('POS_VARIANT_UNAVAILABLE', 'This variant is not currently available to sell.')
  }
  const price = typeof variant.sellingPrice === 'string' ? variant.sellingPrice : ''
  if (role === 'WAREHOUSE' && (decimalToMinorUnits(price) ?? 0n) <= 0n) {
    return failure('POS_VARIANT_UNPRICED', 'This variant needs an owner-set selling price before it can be sold.')
  }
  return { ok: true, line: Object.freeze({
    variantId: variant.id,
    productName: product.name,
    categoryName: product.category?.name || '',
    sku: variant.sku,
    color: variant.color ?? null,
    size: variant.size ?? null,
    imageUrl: product.imageUrl ?? null,
    availableStock: variant.currentStock,
    quantity: 1,
    unitSoldPrice: price,
  }) }
}

export function addVariantToCart(cart, product, variant, role) {
  const existing = cart.find((line) => line.variantId === variant?.id)
  if (existing) return setCartQuantity(cart, existing.variantId, existing.quantity + 1)
  if (cart.length >= maxLines) return failure('SALE_CART_TOO_LARGE', safeMessages.SALE_CART_TOO_LARGE)
  const built = safeLine(product, variant, role)
  return built.ok ? { ok: true, cart: [...cart, built.line] } : built
}

export function setCartQuantity(cart, variantId, quantity) {
  const line = cart.find((item) => item.variantId === variantId)
  if (!line) return failure('POS_CART_LINE_MISSING', 'This cart item is no longer available.')
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > maxQuantity || quantity > line.availableStock) {
    return failure('POS_QUANTITY_INVALID', `Choose a quantity from 1 to ${line.availableStock}.`)
  }
  return { ok: true, cart: cart.map((item) => item.variantId === variantId ? { ...item, quantity } : item) }
}

export function setCartPrice(cart, variantId, price, role) {
  if (role !== 'OWNER') return failure('POS_PRICE_FORBIDDEN', 'Only an owner may override a sale price.')
  const normalized = typeof price === 'string' ? price.trim() : ''
  const minor = salePricePattern.test(normalized) ? decimalToMinorUnits(normalized) : null
  if (minor === null || minor <= 0n) return failure('POS_PRICE_INVALID', 'Enter a price greater than zero with at most two decimals.')
  return { ok: true, cart: cart.map((item) => item.variantId === variantId ? { ...item, unitSoldPrice: normalized } : item) }
}

export function removeCartLine(cart, variantId) { return cart.filter((line) => line.variantId !== variantId) }

export function reconcileCart(cart, products, role) {
  const currentVariants = new Map()
  for (const product of Array.isArray(products) ? products : []) {
    for (const variant of Array.isArray(product.variants) ? product.variants : []) currentVariants.set(variant.id, variant)
  }
  return cart.map((line) => {
    const variant = currentVariants.get(line.variantId)
    if (!variant) return line
    return {
      ...line,
      availableStock: Number.isInteger(variant.currentStock) ? variant.currentStock : line.availableStock,
      ...(role === 'WAREHOUSE' && typeof variant.sellingPrice === 'string' ? { unitSoldPrice: variant.sellingPrice } : {}),
    }
  })
}

export function calculateCart(cart) {
  let total = 0n
  let units = 0
  for (const line of cart) {
    const price = decimalToMinorUnits(line.unitSoldPrice)
    if (price === null || price <= 0n || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      return Object.freeze({ valid: false, units, total: null })
    }
    total += price * BigInt(line.quantity)
    units += line.quantity
  }
  return Object.freeze({ valid: true, units, total: minorUnitsToDecimal(total) })
}

export function buildSalePayload(cart) {
  if (!Array.isArray(cart) || cart.length === 0) return failure('SALE_CART_EMPTY', 'Add at least one item before checkout.')
  if (cart.length > maxLines) return failure('SALE_CART_TOO_LARGE', safeMessages.SALE_CART_TOO_LARGE)
  const items = []
  for (const line of cart) {
    if (typeof line.variantId !== 'string' || !uuidPattern.test(line.variantId)) return failure('INVALID_SALE_VARIANT_ID', 'A cart item is invalid. Remove it and add it again.')
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > maxQuantity) return failure('INVALID_SALE_QUANTITY', 'A cart quantity is invalid.')
    const minor = salePricePattern.test(line.unitSoldPrice) ? decimalToMinorUnits(line.unitSoldPrice) : null
    if (minor === null || minor <= 0n) return failure('INVALID_SALE_PRICE', 'Every cart item needs a valid selling price.')
    items.push({ variantId: line.variantId.toLowerCase(), quantity: line.quantity, unitSoldPrice: minorUnitsToDecimal(minor) })
  }
  return { ok: true, payload: { items } }
}

export function checkoutOperation(cart, current, uuidFactory = () => globalThis.crypto.randomUUID()) {
  const built = buildSalePayload(cart)
  if (!built.ok) return built
  const signature = JSON.stringify(built.payload)
  if (current?.signature === signature) return { ok: true, operation: current }
  const key = uuidFactory()
  if (typeof key !== 'string' || !uuidPattern.test(key)) return failure('POS_IDEMPOTENCY_UNAVAILABLE', 'Checkout cannot start safely. Refresh and try again.')
  return { ok: true, operation: Object.freeze({ key: key.toLowerCase(), payload: built.payload, signature }) }
}

export function createCheckoutGuard() {
  let pending = false
  return Object.freeze({ async run(operation) {
    if (pending) return Object.freeze({ skipped: true })
    pending = true
    try { return Object.freeze({ skipped: false, value: await operation() }) }
    finally { pending = false }
  } })
}

export function settleCheckout(cart, operation, result) {
  return result.ok
    ? Object.freeze({ cart: [], operation: null, sale: result.sale })
    : Object.freeze({ cart, operation, sale: null })
}

function request({ supabase, fetchImpl = globalThis.fetch, path, method = 'GET', payload, headers }) {
  return authenticatedApiRequest({ supabase, fetchImpl, path, method, payload, headers, fallbackMessage: 'Sales are temporarily unavailable. Please try again.' })
}

export async function submitSale({ supabase, fetchImpl, operation }) {
  const result = await request({ supabase, fetchImpl, path: '/api/sales', method: 'POST', payload: operation.payload, headers: { 'Idempotency-Key': operation.key } })
  if (!result.ok) return mapFailure(result)
  const sale = result.data?.sale
  if (![200, 201].includes(result.status) || typeof sale?.id !== 'string' || !Array.isArray(sale.items) || typeof sale.totalAmount !== 'string' || typeof sale.currency !== 'string') {
    return failure('INVALID_SALE_RESPONSE', 'The sale response could not be confirmed. Retry the same checkout.', { retryable: true })
  }
  return Object.freeze({ ok: true, sale, idempotentReplay: result.data.idempotentReplay === true })
}

export async function loadSaleHistory({ supabase, fetchImpl, cursor = null, limit = 10 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return failure('INVALID_SALE_LIMIT', 'Recent Sales limit is invalid.')
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursor) query.set('cursor', cursor)
  const result = await request({ supabase, fetchImpl, path: `/api/sales?${query}` })
  if (!result.ok) return mapFailure(result)
  if (result.status !== 200 || !Array.isArray(result.data?.sales) || !result.data.sales.every((sale) => typeof sale.id === 'string' && typeof sale.totalAmount === 'string')) {
    return failure('INVALID_SALES_RESPONSE', 'Recent sales could not be loaded.')
  }
  return Object.freeze({ ok: true, sales: result.data.sales, nextCursor: typeof result.data.nextCursor === 'string' ? result.data.nextCursor : null })
}
