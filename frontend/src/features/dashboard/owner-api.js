// Owner Dashboard API calls (the account comes from the session; it is never sent).
import { apiGet, apiSend } from '../business/api/client.js'

export function loadSummary(storeId, options) {
  return apiGet('/api/dashboard/summary', { storeId }, options)
}

export function loadBestSellers({ period, storeId }, options) {
  return apiGet('/api/dashboard/best-sellers', { period, storeId, limit: 50 }, options)
}

export function loadStores(options) {
  return apiGet('/api/stores', {}, options)
}

export function saveMonthTarget({ month, amount, storeId = null }) {
  return apiSend('PUT', '/api/business/targets', { period: 'MONTH', periodStart: `${month}-01`, amount, storeId })
}

export function loadMissingCost(options) {
  return apiGet('/api/products/missing-cost', {}, options)
}

export function loadCostHistory(productId, cursor, options) {
  return apiGet(`/api/products/${encodeURIComponent(productId)}/cost-history`, { cursor, limit: 10 }, options)
}

export function addCostEntry(productId, body) {
  return apiSend('POST', `/api/products/${encodeURIComponent(productId)}/cost-entries`, body)
}

export function loadSettings(options) {
  return apiGet('/api/settings', {}, options)
}

export function searchProducts(search, options) {
  return apiGet('/api/products', { search, page: 1, limit: 12, view: 'summary' }, options)
}
