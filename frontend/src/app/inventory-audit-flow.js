import { authenticatedApiRequest } from '../auth/owner-flow.js'

export const MOVEMENT_LABELS = Object.freeze({
  RESTOCK: 'Restock', SALE: 'Sale', RETURN: 'Return', SALE_VOID: 'Sale Void',
  DAMAGE: 'Damage', ADJUSTMENT: 'Adjustment',
})

function failure(result) {
  if (result.code === 'SESSION_REQUIRED' || result.status === 401) return { ok: false, requiresLogin: true, message: 'Your session has expired. Sign in again.' }
  if (result.status === 403 && ['ACCOUNT_PENDING', 'ACCOUNT_REJECTED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_NOT_ACTIVE'].includes(result.code)) {
    return { ok: false, requiresAccountReview: true, message: 'Your store is not currently active.' }
  }
  if (result.code === 'INVALID_INVENTORY_FILTER' || result.code === 'INVALID_CATALOG_ID') return { ok: false, message: 'Check the inventory filters and try again.' }
  if (result.code === 'PRODUCT_NOT_FOUND' || result.code === 'VARIANT_NOT_FOUND') return { ok: false, message: 'This catalog item is unavailable. Refresh and try again.' }
  return { ok: false, message: 'Inventory audit is unavailable. Please try again.' }
}

function queryString(filters, allowed) {
  const query = new URLSearchParams()
  for (const key of allowed) if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') query.set(key, String(filters[key]))
  return query.toString()
}

export function signedQuantity(quantity) {
  return quantity > 0 ? `+${quantity}` : String(quantity)
}

export function canShowMovementCost(role, movement) {
  return role === 'OWNER' && Object.hasOwn(movement, 'unitCost') && movement.unitCost !== null
}

export function canShowMovementNote(role, movement) {
  return role === 'OWNER' && Object.hasOwn(movement, 'note') && Boolean(movement.note)
}

export function reconciliationSummary(variants) {
  return {
    reconciled: variants.filter((row) => row.status === 'RECONCILED').length,
    mismatched: variants.filter((row) => row.status === 'MISMATCH').length,
  }
}

export function appendPage(existing, incoming) {
  const known = new Set(existing.map((row) => row.id ?? row.variant?.id))
  return [...existing, ...incoming.filter((row) => !known.has(row.id ?? row.variant?.id))]
}

export async function listInventoryMovements({ supabase, fetchImpl = globalThis.fetch, filters = {} }) {
  const query = queryString(filters, ['productId', 'variantId', 'type', 'from', 'to', 'cursor', 'limit'])
  const result = await authenticatedApiRequest({ supabase, fetchImpl, path: `/api/inventory/movements?${query}`, method: 'GET', fallbackMessage: 'Inventory history is unavailable.' })
  if (!result.ok) return failure(result)
  if (result.status !== 200 || !Array.isArray(result.data?.movements) ||
      !result.data.movements.every((row) => typeof row.id === 'string' && typeof row.quantityChange === 'number' && typeof row.type === 'string') ||
      !(result.data.nextCursor === null || typeof result.data.nextCursor === 'string')) {
    return { ok: false, message: 'Inventory history response was invalid. Refresh and try again.' }
  }
  return { ok: true, movements: result.data.movements, nextCursor: result.data.nextCursor }
}

export async function getInventoryReconciliation({ supabase, fetchImpl = globalThis.fetch, filters = {} }) {
  const query = queryString(filters, ['productId', 'variantId', 'status', 'cursor', 'limit'])
  const result = await authenticatedApiRequest({ supabase, fetchImpl, path: `/api/inventory/reconciliation?${query}`, method: 'GET', fallbackMessage: 'Stock reconciliation is unavailable.' })
  if (!result.ok) return failure(result)
  if (result.status !== 200 || !Array.isArray(result.data?.variants) ||
      !result.data.variants.every((row) => typeof row.variant?.id === 'string' && typeof row.storedStock === 'number' && typeof row.ledgerStock === 'number' && typeof row.difference === 'number' && ['RECONCILED', 'MISMATCH'].includes(row.status)) ||
      !(result.data.nextCursor === null || typeof result.data.nextCursor === 'string')) {
    return { ok: false, message: 'Stock reconciliation response was invalid. Refresh and try again.' }
  }
  return { ok: true, variants: result.data.variants, nextCursor: result.data.nextCursor }
}
