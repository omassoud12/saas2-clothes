const STORAGE_KEY = 'saas2.sales-ui.v2'

function validState(value) {
  return value && Array.isArray(value.receipts)
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
  })
}

export function browserMockSalesStorage() {
  return createMockSalesStorage(typeof window === 'undefined' ? null : window.localStorage)
}
