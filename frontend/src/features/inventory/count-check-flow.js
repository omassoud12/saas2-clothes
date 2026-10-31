import { authenticatedApiRequest } from '../../auth/owner-flow.js'

// Count check by the actual number: the owner types what is on the shelf, reviews "system -> counted" for every
// variant that differs, and confirms once. Each variant is one request with its own Idempotency-Key.

const MAX_COUNT = 2_147_483_647

function failure(code, message, extra = {}) { return Object.freeze({ ok: false, code, message, ...extra }) }

// "12" -> 12; an empty field means "not counted"; anything else is refused.
export function parseCountedInput(text) {
  const clean = String(text ?? '').trim()
  if (clean === '') return Object.freeze({ ok: true, value: null })
  if (!/^\d{1,10}$/.test(clean) || Number(clean) > MAX_COUNT) return Object.freeze({ ok: false, message: 'Enter a whole number, 0 or more.' })
  return Object.freeze({ ok: true, value: Number(clean) })
}

// The lines the owner reviews: only variants that were counted and differ from the system.
export function buildCountReview(variants, entries) {
  const lines = []
  const errors = new Map()
  for (const variant of variants) {
    const parsed = parseCountedInput(entries[variant.id])
    if (!parsed.ok) { errors.set(variant.id, parsed.message); continue }
    if (parsed.value === null || parsed.value === variant.currentStock) continue
    lines.push(Object.freeze({
      variantId: variant.id,
      color: variant.color || 'No color',
      size: variant.size || 'No size',
      current: variant.currentStock,
      counted: parsed.value,
      difference: parsed.value - variant.currentStock,
    }))
  }
  return Object.freeze({ lines: Object.freeze(lines), errors, ready: errors.size === 0 && lines.length > 0 })
}

export function formatDifference(value) { return value > 0 ? `+${value}` : String(value) }

const messages = {
  COUNT_STOCK_CHANGED: 'The stock changed while you were counting. Reload the product and count again.',
  COUNT_VARIANT_INACTIVE: 'This item is inactive, so it cannot be counted.',
  COUNT_IDEMPOTENCY_CONFLICT: 'This count no longer matches its first attempt. Review and count again.',
  COUNT_ACTOR_UNAVAILABLE: 'Only an owner can correct stock.',
}

export async function submitCount({ supabase, fetchImpl, variantId, operationId, countedQuantity, expectedStock }) {
  const result = await authenticatedApiRequest({
    supabase, fetchImpl, method: 'POST',
    path: `/api/inventory/variants/${encodeURIComponent(variantId)}/count-check`,
    payload: { countedQuantity, expectedStock },
    headers: { 'Idempotency-Key': operationId },
    fallbackMessage: 'The count could not be confirmed. Press Try again: it will not be counted twice.',
  })
  if (!result.ok) {
    if (result.code === 'SESSION_REQUIRED' || result.status === 401) return failure(result.code, 'Your session has expired. Sign in again.', { requiresLogin: true })
    if (result.status === 403) return failure(result.code, messages.COUNT_ACTOR_UNAVAILABLE)
    const retryable = !result.status || result.status >= 500
    return failure(result.code, messages[result.code] || (retryable ? 'The count could not be confirmed. Press Try again: it will not be counted twice.' : result.message), { retryable })
  }
  const count = result.data?.count
  if (![200, 201].includes(result.status) || count?.variantId !== variantId || !Number.isSafeInteger(count.currentStock) || !Number.isSafeInteger(count.difference)) {
    return failure('INVALID_COUNT_RESPONSE', 'The count could not be confirmed. Press Try again: it will not be counted twice.', { retryable: true })
  }
  return Object.freeze({ ok: true, difference: count.difference, currentStock: count.currentStock, idempotentReplay: result.data.idempotentReplay === true })
}
