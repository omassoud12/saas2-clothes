const prefix = 'saas2:quick-stock:v1:'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const stockRecoveryEvent = 'saas2:quick-stock-change'
export function stockRecoveryKey(accountId, userId, productId) {
  return `${prefix}${accountId}:${userId}:${productId}`
}
function clean(record) {
  if (!record || !uuid.test(record.operationId) || !uuid.test(record.variantId) || ![1, -1].includes(record.delta) || !Number.isFinite(record.createdAt) || record.createdAt < 0) throw new Error('Invalid stock recovery data')
  const { variantId, operationId, delta, createdAt } = record
  return { variantId, operationId, delta, createdAt }
}
function operationKey(scope, operationId) {
  if (!uuid.test(operationId)) throw new Error('Invalid stock operation ID')
  return `${scope}:operation:${operationId}`
}
function notify(scope) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(stockRecoveryEvent, { detail: scope }))
}
function legacy(scope, storage) {
  const records = JSON.parse(storage.getItem(scope) || '[]')
  if (!Array.isArray(records)) throw new Error('Invalid stock recovery data')
  return records.map(clean)
}
export function readStockRecovery(scope, storage = globalThis.localStorage) {
  const records = new Map()
  function add(value) {
    const record = clean(value)
    const existing = records.get(record.operationId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('Conflicting stock recovery data')
    records.set(record.operationId, record)
  }
  legacy(scope, storage).forEach(add)
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
  for (const key of keys) {
    if (!key?.startsWith(`${scope}:operation:`)) continue
    const raw = storage.getItem(key)
    if (raw === null) continue
    const record = clean(JSON.parse(raw))
    if (key !== operationKey(scope, record.operationId)) throw new Error('Invalid stock recovery key')
    add(record)
  }
  return [...records.values()].sort((a, b) => a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId)).map(record => ({ ...record, ...(Date.now() - record.createdAt > 30 * 86400000 ? { requiresReview: true } : {}) }))
}
export function persistStockOperation(scope, value, storage = globalThis.localStorage) {
  const record = clean(value), key = operationKey(scope, record.operationId)
  const previous = storage.getItem(key)
  if (previous !== null && JSON.stringify(clean(JSON.parse(previous))) !== JSON.stringify(record)) throw new Error('Conflicting stock recovery data')
  if (previous === null) storage.setItem(key, JSON.stringify(record))
  notify(scope)
}
export function resolveStockOperation(scope, operationId, storage = globalThis.localStorage) {
  storage.removeItem(operationKey(scope, operationId))
  notify(scope)
}
// Serialize short metadata reads/writes, without holding up another variant's network request.
export async function withStockMetadataLock(scope, action, locks = globalThis.navigator?.locks) {
  if (!locks?.request) throw new Error('Safe stock coordination unavailable')
  return locks.request(`${scope}:migration`, { mode: 'exclusive' }, action)
}
export async function migrateStockRecovery(scope, storage = globalThis.localStorage, locks = globalThis.navigator?.locks) {
  if (!locks?.request) return false
  await withStockMetadataLock(scope, () => {
    const records = legacy(scope, storage)
    records.forEach(record => persistStockOperation(scope, record, storage))
    if (storage.getItem(scope) !== null) storage.removeItem(scope)
    notify(scope)
  }, locks)
  return true
}
export async function withStockRecoveryLock(scope, variantId, action, locks = globalThis.navigator?.locks) {
  if (!locks?.request) return { acquired: false, unsupported: true }
  return locks.request(`${scope}:variant:${variantId}`, { mode: 'exclusive', ifAvailable: true }, async lock => lock ? { acquired: true, value: await action() } : { acquired: false, unsupported: false })
}
export function newStockOperation(variantId, delta) { return { variantId, delta, operationId: crypto.randomUUID(), createdAt: Date.now() } }
