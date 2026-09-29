import { authenticatedApiRequest } from '../../auth/owner-flow.js'
import { buildSalePayload, calculateCart } from './sale-flow.js'
import { decimalToMinorUnits, minorUnitsToDecimal, signedMinorUnitsToDecimal } from '../../lib/money.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maxReasonLength = 2_000

const messages = {
  RETURN_SALE_NOT_RETURNABLE: 'This sale is no longer returnable. Sale details have been refreshed.',
  RETURN_QUANTITY_EXCEEDS_REMAINING: 'A selected quantity is no longer returnable. Review the refreshed sale.',
  RETURN_SALE_ITEM_UNAVAILABLE: 'A selected sale item is no longer available.',
  RETURN_IDEMPOTENCY_CONFLICT: 'This retry no longer matches the original return. Review the selection and start a new return.',
  SALE_VOID_HAS_RETURNS: 'A sale with returns cannot be voided.',
  SALE_VOID_NOT_ALLOWED: 'This sale can no longer be voided.',
  SALE_VOID_CONFLICT: 'This sale was already voided with different details.',
  EXCHANGE_IDEMPOTENCY_CONFLICT: 'This retry no longer matches the original exchange. Review the selections and start a new exchange.',
  EXCHANGE_CONFLICT: 'The sale or catalog changed during the exchange. Review the refreshed information.',
  EXCHANGE_CURRENCY_MISMATCH: 'The original and replacement sale currencies do not match.',
  INSUFFICIENT_STOCK: 'Replacement stock changed. Review the refreshed catalog and try again.',
  SALE_PRICE_CHANGED: 'A replacement price changed. Review the refreshed catalog and try again.',
  SALE_VARIANT_NOT_PRICED: 'A replacement item no longer has a selling price.',
  SALE_VARIANT_UNAVAILABLE: 'A replacement variant is no longer available.',
  SALE_PRODUCT_INACTIVE: 'A replacement product is no longer active.',
  SALE_VARIANT_INACTIVE: 'A replacement variant is no longer active.',
  SALE_COST_UNAVAILABLE: 'A replacement item cannot be sold until its inventory cost is available.',
  INVENTORY_STOCK_OVERFLOW: 'The stock update exceeds the supported inventory limit.',
}

function failure(code, message, extra = {}) { return Object.freeze({ ok: false, code, message, ...extra }) }

function mapFailure(result, operation) {
  if (result.code === 'SESSION_REQUIRED' || result.status === 401) {
    return failure(result.code, 'Your session has expired. Sign in again.', { requiresLogin: true })
  }
  if (result.status === 403) return failure(result.code, `You are not authorized to ${operation} this sale.`)
  if (result.status === 429) {
    const wait = Number.isSafeInteger(result.retryAfterSeconds) ? ` Wait ${result.retryAfterSeconds} seconds, then` : ' Wait a moment, then'
    return failure(result.code, `Too many attempts.${wait} retry the same operation.`, { retryable: true })
  }
  const refreshDetail = [
    'RETURN_SALE_NOT_RETURNABLE', 'RETURN_QUANTITY_EXCEEDS_REMAINING', 'RETURN_SALE_ITEM_UNAVAILABLE',
    'SALE_VOID_HAS_RETURNS', 'SALE_VOID_NOT_ALLOWED', 'SALE_VOID_CONFLICT', 'EXCHANGE_CONFLICT',
  ].includes(result.code)
  const refreshCatalog = [
    'INSUFFICIENT_STOCK', 'SALE_PRICE_CHANGED', 'SALE_VARIANT_NOT_PRICED', 'SALE_VARIANT_UNAVAILABLE',
    'SALE_PRODUCT_INACTIVE', 'SALE_VARIANT_INACTIVE', 'SALE_COST_UNAVAILABLE',
  ].includes(result.code)
  const fallback = operation === 'load' ? 'Sale information could not be loaded.' :
    operation === 'return' ? 'The return could not be completed.' :
      operation === 'void' ? 'The sale could not be voided.' : 'The exchange could not be completed.'
  return failure(result.code, messages[result.code] || `${fallback} Please try again.`, {
    ...(refreshDetail ? { refreshDetail: true } : {}),
    ...(refreshCatalog ? { refreshCatalog: true } : {}),
    ...(!result.status || result.status >= 500 ? { retryable: true } : {}),
  })
}

function request({ supabase, fetchImpl = globalThis.fetch, path, method = 'GET', payload, headers }) {
  return authenticatedApiRequest({
    supabase, fetchImpl, path, method, payload, headers,
    fallbackMessage: 'Sale operations are temporarily unavailable. Please try again.',
  })
}

function safeItem(item) {
  return Object.freeze({
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    categoryName: item.categoryName,
    sku: item.sku,
    color: item.color ?? null,
    size: item.size ?? null,
    quantity: item.quantity,
    unitSoldPrice: item.unitSoldPrice,
    lineTotal: item.lineTotal,
    returnedQuantity: item.returnedQuantity,
    remainingReturnableQuantity: item.remainingReturnableQuantity,
  })
}

function validSaleDetail(sale) {
  return sale && typeof sale.id === 'string' && ['COMPLETED', 'VOIDED'].includes(sale.status) &&
    /^[A-Z]{3}$/.test(sale.currency) && decimalToMinorUnits(sale.totalAmount) !== null &&
    typeof sale.seller?.name === 'string' && sale.returnSummary &&
    typeof sale.returnSummary.hasReturns === 'boolean' && Number.isSafeInteger(sale.returnSummary.returnCount) &&
    Number.isSafeInteger(sale.returnSummary.totalReturnedUnits) && decimalToMinorUnits(sale.returnSummary.totalReturnedAmount) !== null &&
    sale.exchangeSummary && Number.isSafeInteger(sale.exchangeSummary.originalExchangeCount) &&
    (sale.exchangeSummary.replacementForExchangeId === null || typeof sale.exchangeSummary.replacementForExchangeId === 'string') &&
    Array.isArray(sale.items) && sale.items.every((item) => typeof item.id === 'string' && typeof item.variantId === 'string' &&
      typeof item.productName === 'string' && typeof item.sku === 'string' &&
      Number.isSafeInteger(item.quantity) && item.quantity > 0 && Number.isSafeInteger(item.returnedQuantity) && item.returnedQuantity >= 0 &&
      Number.isSafeInteger(item.remainingReturnableQuantity) && item.remainingReturnableQuantity >= 0 &&
      item.returnedQuantity + item.remainingReturnableQuantity === item.quantity && decimalToMinorUnits(item.unitSoldPrice) !== null &&
      decimalToMinorUnits(item.lineTotal) !== null)
}

export async function loadSaleDetail({ supabase, fetchImpl, saleId }) {
  const result = await request({ supabase, fetchImpl, path: `/api/sales/${encodeURIComponent(saleId)}` })
  if (!result.ok) return mapFailure(result, 'load')
  const sale = result.data?.sale
  if (result.status !== 200 || !validSaleDetail(sale)) return failure('INVALID_SALE_DETAIL_RESPONSE', 'Sale details could not be loaded.')
  return Object.freeze({
    ok: true,
    sale: Object.freeze({
      id: sale.id, status: sale.status, currency: sale.currency, subtotal: sale.subtotal,
      totalAmount: sale.totalAmount, createdAt: sale.createdAt, seller: sale.seller,
      void: sale.void ?? null, returnSummary: sale.returnSummary,
      exchangeSummary: sale.exchangeSummary, items: Object.freeze(sale.items.map(safeItem)),
    }),
  })
}

export async function loadSaleReturns({ supabase, fetchImpl, saleId, cursor = null }) {
  const query = new URLSearchParams({ limit: '25' })
  if (cursor) query.set('cursor', cursor)
  const result = await request({ supabase, fetchImpl, path: `/api/sales/${encodeURIComponent(saleId)}/returns?${query}` })
  if (!result.ok) return mapFailure(result, 'load')
  if (result.status !== 200 || !Array.isArray(result.data?.returns)) return failure('INVALID_RETURN_HISTORY_RESPONSE', 'Return history could not be loaded.')
  const returns = result.data.returns.map((entry) => Object.freeze({
    id: entry.id, saleId: entry.saleId, exchangeId: entry.exchangeId ?? null, createdAt: entry.createdAt,
    reason: entry.reason ?? null, processor: entry.processor, totalRefund: entry.totalRefund,
    itemCount: entry.itemCount, totalUnits: entry.totalUnits,
  }))
  return Object.freeze({ ok: true, returns, nextCursor: typeof result.data.nextCursor === 'string' ? result.data.nextCursor : null })
}

export function canReturnSale(sale) {
  return sale?.status === 'COMPLETED' && sale.items?.some((item) => item.remainingReturnableQuantity > 0) === true
}

export function canVoidSale(role, sale) {
  return role === 'OWNER' && sale?.status === 'COMPLETED' && sale.returnSummary?.hasReturns === false
}

export function setReturnQuantity(quantities, item, quantity) {
  if (!item || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > item.remainingReturnableQuantity) {
    return failure('INVALID_RETURN_QUANTITY', `Choose a quantity from 0 to ${item?.remainingReturnableQuantity ?? 0}.`)
  }
  const next = { ...quantities }
  if (quantity === 0) delete next[item.id]
  else next[item.id] = quantity
  return { ok: true, quantities: next }
}

function normalizeReason(reason) {
  const normalized = typeof reason === 'string' ? reason.normalize('NFC').trim() : ''
  if ([...normalized].length > maxReasonLength) return failure('INVALID_REASON', `Reason must not exceed ${maxReasonLength} characters.`)
  return { ok: true, reason: normalized || null }
}

export function calculateReturnPreview(sale, quantities) {
  let amount = 0n
  let units = 0
  for (const item of sale?.items ?? []) {
    const quantity = quantities[item.id] ?? 0
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > item.remainingReturnableQuantity) return { valid: false, units, total: null }
    if (quantity === 0) continue
    const price = decimalToMinorUnits(item.unitSoldPrice)
    if (price === null) return { valid: false, units, total: null }
    amount += price * BigInt(quantity)
    units += quantity
  }
  return Object.freeze({ valid: units > 0, units, total: minorUnitsToDecimal(amount) })
}

function buildReturnPayload(sale, quantities, reason) {
  const normalized = normalizeReason(reason)
  if (!normalized.ok) return normalized
  const items = []
  for (const item of sale?.items ?? []) {
    const quantity = quantities[item.id] ?? 0
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > item.remainingReturnableQuantity) {
      return failure('INVALID_RETURN_QUANTITY', 'Review the selected return quantities.')
    }
    if (quantity > 0) items.push({ saleItemId: item.id, quantity })
  }
  if (items.length === 0) return failure('RETURN_ITEMS_EMPTY', 'Select at least one item to return.')
  return { ok: true, payload: { reason: normalized.reason, items } }
}

function operation(payload, current, uuidFactory) {
  const signature = JSON.stringify(payload)
  if (current?.signature === signature) return { ok: true, operation: current }
  const key = uuidFactory()
  if (typeof key !== 'string' || !uuidPattern.test(key)) return failure('IDEMPOTENCY_UNAVAILABLE', 'This operation cannot start safely. Refresh and try again.')
  return { ok: true, operation: Object.freeze({ key: key.toLowerCase(), payload, signature }) }
}

export function returnOperation({ sale, quantities, reason, current, uuidFactory = () => globalThis.crypto.randomUUID() }) {
  const built = buildReturnPayload(sale, quantities, reason)
  return built.ok ? operation(built.payload, current, uuidFactory) : built
}

export function exchangeOperation({ sale, quantities, reason, replacementCart, current, uuidFactory = () => globalThis.crypto.randomUUID() }) {
  const returned = buildReturnPayload(sale, quantities, reason)
  if (!returned.ok) return returned
  const replacement = buildSalePayload(replacementCart)
  if (!replacement.ok) return replacement
  return operation({
    reason: returned.payload.reason,
    returnItems: returned.payload.items,
    replacementItems: replacement.payload.items,
  }, current, uuidFactory)
}

export function calculateExchangePreview(sale, quantities, replacementCart) {
  const returned = calculateReturnPreview(sale, quantities)
  const replacement = calculateCart(replacementCart)
  if (!returned.valid || !replacement.valid || returned.total === null || replacement.total === null) {
    return Object.freeze({ valid: false, returned: returned.total, replacement: replacement.total, difference: null })
  }
  const difference = decimalToMinorUnits(replacement.total) - decimalToMinorUnits(returned.total)
  return Object.freeze({ valid: true, returned: returned.total, replacement: replacement.total, difference: signedMinorUnitsToDecimal(difference) })
}

export async function submitReturn({ supabase, fetchImpl, saleId, operation: prepared }) {
  const result = await request({
    supabase, fetchImpl, path: `/api/sales/${encodeURIComponent(saleId)}/returns`, method: 'POST',
    payload: prepared.payload, headers: { 'Idempotency-Key': prepared.key },
  })
  if (!result.ok) return mapFailure(result, 'return')
  if (![200, 201].includes(result.status) || typeof result.data?.return?.id !== 'string' || typeof result.data.return.totalRefund !== 'string') {
    return failure('INVALID_RETURN_RESPONSE', 'The return response could not be confirmed. Retry the same return.', { retryable: true })
  }
  return Object.freeze({
    ok: true,
    return: Object.freeze({ id: result.data.return.id, totalRefund: result.data.return.totalRefund }),
    idempotentReplay: result.data.idempotentReplay === true,
  })
}

export async function submitVoid({ supabase, fetchImpl, saleId, reason }) {
  const normalized = normalizeReason(reason)
  if (!normalized.ok) return normalized
  if (!normalized.reason) return failure('INVALID_SALE_VOID_REASON', 'Enter a reason for voiding this sale.')
  const result = await request({
    supabase, fetchImpl, path: `/api/sales/${encodeURIComponent(saleId)}/void`, method: 'POST',
    payload: { reason: normalized.reason },
  })
  if (!result.ok) return mapFailure(result, 'void')
  if (![200, 201].includes(result.status) || result.data?.sale?.status !== 'VOIDED') {
    return failure('INVALID_SALE_VOID_RESPONSE', 'The void response could not be confirmed. Refresh the sale before retrying.')
  }
  return Object.freeze({ ok: true, sale: Object.freeze({ id: result.data.sale.id, status: 'VOIDED' }), idempotentReplay: result.data.idempotentReplay === true })
}

export async function submitExchange({ supabase, fetchImpl, saleId, operation: prepared }) {
  const result = await request({
    supabase, fetchImpl, path: `/api/sales/${encodeURIComponent(saleId)}/exchanges`, method: 'POST',
    payload: prepared.payload, headers: { 'Idempotency-Key': prepared.key },
  })
  if (!result.ok) return mapFailure(result, 'exchange')
  const exchange = result.data?.exchange
  if (![200, 201].includes(result.status) || typeof exchange?.id !== 'string' || typeof exchange.differenceAmount !== 'string' || !exchange.return || !exchange.replacementSale) {
    return failure('INVALID_EXCHANGE_RESPONSE', 'The exchange response could not be confirmed. Retry the same exchange.', { retryable: true })
  }
  return Object.freeze({
    ok: true,
    exchange: Object.freeze({ id: exchange.id, differenceAmount: exchange.differenceAmount }),
    idempotentReplay: result.data.idempotentReplay === true,
  })
}
