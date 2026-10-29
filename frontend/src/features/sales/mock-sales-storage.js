const CART_KEY_PREFIX = 'saas2.sales-cart.v1'
const CHECKOUT_KEY_PREFIX = 'saas2.sales-checkout.v1'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validCartLine(line) {
  return Boolean(line) && typeof line === 'object' && typeof line.key === 'string' && typeof line.variantId === 'string' && line.variantId !== ''
    && typeof line.productId === 'string' && typeof line.colorId === 'string' && typeof line.productName === 'string'
    && typeof line.colorName === 'string' && typeof line.size === 'string'
    && Number.isSafeInteger(line.priceCents) && line.priceCents >= 0
    && Number.isInteger(line.quantity) && line.quantity >= 1
    && Number.isInteger(line.stock) && line.stock >= 0
}

function validCheckout(record) {
  return Boolean(record) && typeof record === 'object' && typeof record.key === 'string' && uuidPattern.test(record.key)
    && Boolean(record.payload) && Array.isArray(record.payload.items) && record.payload.items.length > 0
    && record.payload.items.every(item => item && typeof item.variantId === 'string' && Number.isInteger(item.quantity)
      && item.quantity > 0 && typeof item.unitSoldPrice === 'string')
    && record.signature === JSON.stringify(record.payload)
    && Boolean(record.summary) && Number.isSafeInteger(record.summary.discountPercent) && record.summary.discountPercent >= 0
    && Number.isSafeInteger(record.summary.listSubtotalCents) && Number.isSafeInteger(record.summary.totalCents)
}

export function createMockSalesStorage(storage) {
  return Object.freeze({
    // The unfinished cart is keyed by account and user so a shared phone never shows another store's cart.
    loadCart(scope) {
      if (!storage || !scope) return []
      try {
        const saved = JSON.parse(storage.getItem(`${CART_KEY_PREFIX}:${scope}`))
        return Array.isArray(saved) ? saved.filter(validCartLine) : []
      } catch {
        return []
      }
    },
    saveCart(scope, cart) {
      if (!storage || !scope) return false
      const key = `${CART_KEY_PREFIX}:${scope}`
      try {
        if (cart.length) storage.setItem(key, JSON.stringify(cart))
        else storage.removeItem(key)
        return true
      } catch { return false }
    },
    // A checkout that may or may not have reached the server keeps its Idempotency-Key here, so a refresh cannot create a duplicate sale.
    loadCheckout(scope) {
      if (!storage || !scope) return null
      try {
        const saved = JSON.parse(storage.getItem(`${CHECKOUT_KEY_PREFIX}:${scope}`))
        return validCheckout(saved) ? saved : null
      } catch {
        return null
      }
    },
    saveCheckout(scope, record) {
      if (!storage || !scope) return false
      const key = `${CHECKOUT_KEY_PREFIX}:${scope}`
      try {
        if (record) storage.setItem(key, JSON.stringify(record))
        else storage.removeItem(key)
        return true
      } catch { return false }
    },
  })
}

export function browserMockSalesStorage() {
  return createMockSalesStorage(typeof window === 'undefined' ? null : window.localStorage)
}
