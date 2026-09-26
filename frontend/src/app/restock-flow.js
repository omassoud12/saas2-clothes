import { authenticatedApiRequest } from '../auth/owner-flow.js'

const costPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/
const messages = Object.freeze({
  ROLE_FORBIDDEN: 'Only an owner can restock inventory.',
  INVALID_RESTOCK_QUANTITY: 'Enter a whole quantity from 1 to 1,000,000.',
  INVALID_RESTOCK_UNIT_COST: 'Enter a purchase cost greater than zero with up to four decimals.',
  INVALID_RESTOCK_NOTE: 'Keep the note within 500 characters.',
  PRODUCT_INACTIVE: 'This product is inactive. Refresh inventory before trying again.',
  VARIANT_INACTIVE: 'This variant is inactive. Refresh inventory before trying again.',
  PRODUCT_NOT_FOUND: 'This product is unavailable. Refresh inventory.',
  VARIANT_NOT_FOUND: 'This variant is unavailable. Refresh inventory.',
  RESTOCK_STOCK_OVERFLOW: 'This Restock would exceed the stock limit.',
  RESTOCK_IDEMPOTENCY_CONFLICT: 'This Restock key belongs to different details. Start a new Restock if you intend another operation.',
})

const uncertainMessage = 'Restock outcome could not be confirmed. Retrying this same Restock will not add stock twice.'

export function canRestock(role, product, variant) {
  return role === 'OWNER' && product?.isActive === true && variant?.isActive === true
}

export function validateRestockDraft(draft) {
  const quantityText = String(draft?.quantity ?? '').trim()
  if (!/^[1-9]\d*$/.test(quantityText) || Number(quantityText) > 1_000_000) {
    return { ok: false, field: 'quantity', code: 'INVALID_RESTOCK_QUANTITY', message: messages.INVALID_RESTOCK_QUANTITY }
  }
  const cost = String(draft?.unitCost ?? '').trim()
  if (!costPattern.test(cost) || !/[1-9]/.test(cost)) {
    return { ok: false, field: 'unitCost', code: 'INVALID_RESTOCK_UNIT_COST', message: messages.INVALID_RESTOCK_UNIT_COST }
  }
  if (draft?.note != null && typeof draft.note !== 'string') {
    return { ok: false, field: 'note', code: 'INVALID_RESTOCK_NOTE', message: messages.INVALID_RESTOCK_NOTE }
  }
  const note = (draft.note ?? '').normalize('NFC').trim()
  if ([...note].length > 500) {
    return { ok: false, field: 'note', code: 'INVALID_RESTOCK_NOTE', message: messages.INVALID_RESTOCK_NOTE }
  }
  return { ok: true, payload: { quantity: Number(quantityText), unitCost: cost, note: note || null } }
}

function canonicalCost(cost) {
  const [whole, fraction = ''] = cost.split('.')
  return `${whole}.${fraction.padEnd(4, '0')}`
}

export async function postRestock({ supabase, fetchImpl = globalThis.fetch, productId, variantId, quantity, unitCost, note, idempotencyKey }) {
  const result = await authenticatedApiRequest({
    supabase, fetchImpl,
    path: `/api/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/restocks`,
    method: 'POST', payload: { quantity, unitCost, note },
    headers: { 'Idempotency-Key': idempotencyKey },
    fallbackMessage: uncertainMessage,
  })
  if (!result.ok) {
    if (result.code === 'SESSION_REQUIRED' || result.status === 401) return { ok: false, requiresLogin: true, message: 'Your session has expired. Sign in again.' }
    if (result.status === 403 && ['ACCOUNT_PENDING', 'ACCOUNT_REJECTED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_NOT_ACTIVE'].includes(result.code)) {
      return { ok: false, requiresAccountReview: true, message: 'Your store is not currently active.' }
    }
    if (result.status === 429) return { ok: false, code: result.code, message: result.message, retryAfterSeconds: result.retryAfterSeconds }
    if (result.code === 'API_UNAVAILABLE' || result.status >= 500) return { ok: false, uncertain: true, message: uncertainMessage }
    return { ok: false, code: result.code, message: messages[result.code] || 'Restock could not be completed. Refresh and try again.', refresh: ['PRODUCT_INACTIVE', 'VARIANT_INACTIVE', 'PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND'].includes(result.code) }
  }
  const data = result.data
  if (![200, 201].includes(result.status) || typeof data?.restock?.id !== 'string' ||
      typeof data.restock.quantity !== 'number' || typeof data.restock.unitCost !== 'string' ||
      typeof data?.variant?.currentStock !== 'number' || typeof data.variant.lastPurchaseCost !== 'string' ||
      typeof data.idempotentReplay !== 'boolean') {
    return { ok: false, uncertain: true, message: uncertainMessage }
  }
  return { ok: true, restock: data.restock, variant: data.variant, idempotentReplay: data.idempotentReplay }
}

export function createRestockWorkflow({ send, createKey = () => globalThis.crypto.randomUUID() }) {
  let pending = false
  let attempt = null

  async function perform(current) {
    if (pending) return { skipped: true }
    pending = true
    try {
      const result = await send(current)
      if (result.ok || !result.uncertain) attempt = null
      return result
    } catch {
      return { ok: false, uncertain: true, message: uncertainMessage }
    } finally { pending = false }
  }

  return {
    async submit({ productId, variantId, draft }) {
      if (pending) return { skipped: true }
      const built = validateRestockDraft(draft)
      if (!built.ok) return built
      const semantic = JSON.stringify([productId, variantId, built.payload.quantity, canonicalCost(built.payload.unitCost), built.payload.note])
      if (!attempt || attempt.semantic !== semantic) {
        attempt = { semantic, productId, variantId, payload: built.payload, idempotencyKey: createKey() }
      }
      return perform(attempt)
    },
    retry() { return attempt ? perform(attempt) : Promise.resolve({ skipped: true }) },
    hasUncertainAttempt() { return attempt !== null },
    reset() { if (!pending) attempt = null },
  }
}
