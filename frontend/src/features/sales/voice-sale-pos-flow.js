import { addVariantToCart, setCartQuantity } from './sale-flow.js'
import { requestTextMatch } from '../voice-sales/text-matching-flow.js'

const actionableStatuses = new Set(['MATCHED', 'AMBIGUOUS'])
const failure = (code, message, extra = {}) => Object.freeze({ ok: false, code, message, ...extra })

/** Select one new successful STT result. Repeated or older revisions cannot overwrite the current draft. */
export function selectFreshVoiceTranscript(voice, lastAppliedRevision = 0) {
  if (voice?.phase !== 'review' || typeof voice.transcriptText !== 'string' || !voice.transcriptText.trim()
    || !Number.isSafeInteger(voice.transcriptRevision) || voice.transcriptRevision <= lastAppliedRevision) return null
  const originalText = typeof voice.originalTranscriptText === 'string' && voice.originalTranscriptText.trim()
    ? voice.originalTranscriptText
    : voice.transcriptText
  return Object.freeze({ text: voice.transcriptText, originalText, revision: voice.transcriptRevision })
}

function candidateReady(candidate) {
  return candidate && typeof candidate.variantId === 'string' && typeof candidate.sku === 'string' && candidate.sku.length > 0
    && Number.isSafeInteger(candidate.quantity) && candidate.quantity > 0
    && typeof candidate.sellingPrice === 'string' && /^(?:0|[1-9]\d{0,15})\.\d{2}$/u.test(candidate.sellingPrice)
    && candidate.sellingPrice !== '0.00' && Number.isSafeInteger(candidate.availableStock) && candidate.availableStock >= candidate.quantity
    && Array.isArray(candidate.missingFields) && candidate.missingFields.length === 0
    && Array.isArray(candidate.unresolvedConstraints) && candidate.unresolvedConstraints.length === 0
}

function candidatesFor(result) {
  if (!result || !actionableStatuses.has(result.status)) return []
  if (result.status === 'MATCHED') return candidateReady(result.match) ? [result.match] : []
  return result.candidates.filter(candidateReady)
}

/** Convert the backward-compatible single/multi match contract into independent POS review items. */
export function createVoiceReviewItems(result) {
  const source = Array.isArray(result?.items) && result.items.length
    ? result.items.map(item => ({ index: item.index, text: item.segment.text, result: item.result }))
    : result ? [{ index: 0, text: result.parser?.originalText || result.parser?.normalizedText || '', result }] : []
  return Object.freeze(source.map(item => {
    const candidates = candidatesFor(item.result)
    return Object.freeze({
      index: item.index,
      text: item.text,
      status: item.result.status,
      reason: item.result.reason,
      parser: item.result.parser,
      missingFields: Object.freeze([...(item.result.missingFields || [])]),
      ambiguities: Object.freeze([...(item.result.parser?.ambiguities || [])]),
      candidates: Object.freeze(candidates),
      discovery: item.result.discovery || null,
      defaultVariantId: item.result.status === 'MATCHED' && candidates.length === 1 ? candidates[0].variantId : null,
      canSelect: candidates.length > 0,
    })
  }))
}

export function validateVoiceReview(items, decisions) {
  if (!Array.isArray(items) || items.length === 0) return failure('VOICE_REVIEW_EMPTY', 'Run a catalog match before adding items.')
  const selected = []
  for (const item of items) {
    const decision = decisions?.[item.index]
    if (decision?.excluded === true) continue
    if (!decision?.confirmed) return failure('VOICE_ITEM_REVIEW_REQUIRED', `Confirm or exclude item ${item.index + 1}.`, { itemIndex: item.index })
    const candidate = item.candidates.find(row => row.variantId === decision.variantId)
    if (!candidate || !candidateReady(candidate)) {
      return failure('VOICE_ITEM_NOT_ADDABLE', `Item ${item.index + 1} does not have a confirmed, sellable variant.`, { itemIndex: item.index })
    }
    selected.push(Object.freeze({ itemIndex: item.index, candidate }))
  }
  if (selected.length === 0) return failure('VOICE_SELECTION_EMPTY', 'Keep and confirm at least one matched item.')
  return Object.freeze({ ok: true, selected: Object.freeze(selected) })
}

function operationalSnapshot(candidate) {
  return JSON.stringify({ productId: candidate.productId, categoryId: candidate.categoryId || null,
    productName: candidate.productName, categoryName: candidate.categoryName, variantId: candidate.variantId,
    sku: candidate.sku, barcode: candidate.barcode || null, color: candidate.color, size: candidate.size,
    quantity: candidate.quantity, sellingPrice: candidate.sellingPrice,
    availableStock: candidate.availableStock, currency: candidate.currency })
}

function variantSnapshot(candidate) {
  return JSON.stringify({ productId: candidate.productId, categoryId: candidate.categoryId || null,
    productName: candidate.productName, categoryName: candidate.categoryName, variantId: candidate.variantId,
    sku: candidate.sku, barcode: candidate.barcode || null, color: candidate.color, size: candidate.size,
    sellingPrice: candidate.sellingPrice, availableStock: candidate.availableStock, currency: candidate.currency })
}

export function createVoiceCartAddGuard() {
  let pending = false
  return Object.freeze({ async run(operation) {
    if (pending) return Object.freeze({ skipped: true })
    pending = true
    try { return Object.freeze({ skipped: false, value: await operation() }) }
    finally { pending = false }
  } })
}

/** Re-run the authenticated matcher and require every selected operational snapshot to remain identical. */
export async function revalidateVoiceReview({ supabase, text, items, decisions, request = requestTextMatch }) {
  const reviewed = validateVoiceReview(items, decisions)
  if (!reviewed.ok) return reviewed
  const response = await request({ supabase, text })
  if (!response.ok) return response
  const freshItems = createVoiceReviewItems(response.result)
  const selected = []
  for (const previous of reviewed.selected) {
    const freshItem = freshItems.find(item => item.index === previous.itemIndex)
    const candidate = freshItem?.candidates.find(row => row.variantId === previous.candidate.variantId)
    if (!candidate || operationalSnapshot(candidate) !== operationalSnapshot(previous.candidate)) {
      return failure('VOICE_REVIEW_STALE', 'Catalog price, stock, quantity, or variant availability changed. Review and confirm the refreshed results.', {
        stale: true, result: response.result, items: freshItems, itemIndex: previous.itemIndex,
      })
    }
    selected.push(Object.freeze({ itemIndex: previous.itemIndex, candidate }))
  }
  return Object.freeze({ ok: true, result: response.result, items: freshItems, selected: Object.freeze(selected) })
}

/** Add all confirmed lines to the existing cart as one immutable operation. */
export function addVoiceSelectionsToCart(cart, selected, role) {
  if (!Array.isArray(cart) || !Array.isArray(selected) || selected.length === 0) {
    return failure('VOICE_SELECTION_EMPTY', 'Keep and confirm at least one matched item.')
  }
  const aggregated = new Map()
  for (const row of selected) {
    const candidate = row?.candidate ?? row
    if (!candidateReady(candidate)) return failure('VOICE_ITEM_NOT_ADDABLE', 'A selected item is no longer safe to add.')
    const previous = aggregated.get(candidate.variantId)
    if (previous && variantSnapshot(previous.candidate) !== variantSnapshot(candidate)) {
      return failure('VOICE_SELECTION_CONFLICT', 'The same variant has conflicting voice selections. Review the items again.')
    }
    aggregated.set(candidate.variantId, { candidate, quantity: (previous?.quantity || 0) + candidate.quantity })
  }

  let next = cart.map(line => ({ ...line }))
  for (const { candidate, quantity } of aggregated.values()) {
    const existing = next.find(line => line.variantId === candidate.variantId)
    const total = (existing?.quantity || 0) + quantity
    if (total > candidate.availableStock) {
      return failure('POS_QUANTITY_INVALID', `Only ${candidate.availableStock} of ${candidate.productName} are currently available.`)
    }
    if (existing) {
      next = next.map(line => line.variantId === candidate.variantId ? {
        ...line,
        availableStock: candidate.availableStock,
        ...(role === 'WAREHOUSE' ? { unitSoldPrice: candidate.sellingPrice } : {}),
      } : line)
    } else {
      const product = { id: candidate.productId, name: candidate.productName,
        category: { name: candidate.categoryName }, imageUrl: null, isActive: true }
      const variant = { id: candidate.variantId, sku: candidate.sku, color: candidate.color, size: candidate.size,
        sellingPrice: candidate.sellingPrice, currentStock: candidate.availableStock, isActive: true }
      const added = addVariantToCart(next, product, variant, role)
      if (!added.ok) return added
      next = added.cart
    }
    const updated = setCartQuantity(next, candidate.variantId, total)
    if (!updated.ok) return updated
    next = updated.cart
  }
  return Object.freeze({ ok: true, cart: next })
}
