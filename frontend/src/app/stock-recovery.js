const prefix = 'saas2:quick-stock:v1:'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function stockRecoveryKey(accountId, userId, productId) {
  return `${prefix}${accountId}:${userId}:${productId}`
}
export function readStockRecovery(key, storage = globalThis.localStorage) {
  const records = JSON.parse(storage.getItem(key) || '[]')
  if (!Array.isArray(records)) throw new Error('Invalid stock recovery data')
  if (!records.every(record => record && uuid.test(record.operationId) && uuid.test(record.variantId) && [1, -1].includes(record.delta) && Number.isFinite(record.createdAt))) throw new Error('Invalid stock recovery data')
  // Old unresolved requests must never expire into a new ambiguous mutation.
  // Their original UUID remains usable; resolved metadata is removed on confirmation.
  return records.map(({ variantId, operationId, delta, createdAt }) => ({ variantId, operationId, delta, createdAt, ...(Date.now() - createdAt > 30 * 86400000 ? { requiresReview: true } : {}) }))
}
export function writeStockRecovery(key, records, storage = globalThis.localStorage) {
  if (records.length) storage.setItem(key, JSON.stringify(records.map(({ variantId, operationId, delta, createdAt }) => ({ variantId, operationId, delta, createdAt }))))
  else storage.removeItem(key)
}

export function newStockOperation(variantId, delta) { return { variantId, delta, operationId: crypto.randomUUID(), createdAt: Date.now() } }
