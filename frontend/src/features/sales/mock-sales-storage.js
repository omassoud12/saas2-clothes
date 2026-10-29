const STORAGE_KEY = 'saas2.sales-ui.v2'
const CART_KEY_PREFIX = 'saas2.sales-cart.v1'

function validState(value) {
  return value && Array.isArray(value.receipts)
}

function validCartLine(line) {
  return Boolean(line) && typeof line === 'object' && typeof line.key === 'string' && typeof line.variantId === 'string' && line.variantId !== ''
    && typeof line.productId === 'string' && typeof line.colorId === 'string' && typeof line.productName === 'string'
    && typeof line.colorName === 'string' && typeof line.size === 'string'
    && Number.isSafeInteger(line.priceCents) && line.priceCents >= 0
    && Number.isInteger(line.quantity) && line.quantity >= 1
    && Number.isInteger(line.stock) && line.stock >= line.quantity
}

export function createMockSalesStorage(storage) {
  return Object.freeze({
    load() {
      if (!storage) return { receipts: [] }
      try {
        const saved = JSON.parse(storage.getItem(STORAGE_KEY))
        return validState(saved) ? { receipts: saved.receipts } : { receipts: [] }
      } catch {
        return { receipts: [] }
      }
    },
    save(state) {
      if (!storage) return false
      try { storage.setItem(STORAGE_KEY, JSON.stringify({ receipts: state.receipts || [] })); return true } catch { return false }
    },
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
  })
}

export function browserMockSalesStorage() {
  return createMockSalesStorage(typeof window === 'undefined' ? null : window.localStorage)
}
