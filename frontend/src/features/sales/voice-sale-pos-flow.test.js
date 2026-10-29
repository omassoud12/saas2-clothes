import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  addVoiceSelectionsToCart, createVoiceCartAddGuard, createVoiceReviewItems, revalidateVoiceReview,
  selectFreshVoiceTranscript, validateVoiceReview,
} from './voice-sale-pos-flow.js'

const variantA = '11111111-1111-4111-8111-111111111111'
const variantB = '22222222-2222-4222-8222-222222222222'
const candidate = (changes = {}) => ({
  productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', categoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  variantId: variantA, sku: 'TS-BLK-L', barcode: '5285000000001',
  productName: 'Cedar T-Shirt', categoryName: 'T-Shirts', color: 'Black', size: 'L', quantity: 2,
  sellingPrice: '12.50', availableStock: 8, currency: 'USD', missingFields: [], unresolvedConstraints: [],
  requiresConfirmation: true, evidence: [], ...changes,
})
const parsed = { originalText: 'bdi tshirt black L two pieces', normalizedText: 'bdi tshirt black l two pieces' }
const matchResult = (changes = {}) => ({ status: 'MATCHED', reason: 'UNIQUE_SUPPORTED_CATALOG_MATCH', parser: parsed,
  match: candidate(), candidates: [candidate()], suggestions: [], missingFields: [], requiresConfirmation: true,
  catalog: { scannedVariants: 4, truncated: false, candidateCount: 1, candidatesTruncated: false }, ...changes })

describe('voice transcript draft synchronization', () => {
  test('selects each successful nonempty transcript exactly once', () => {
    const voice = { phase: 'review', originalTranscriptText: 'bdi tshirt black L', transcriptText: 'bdi tshirt black L', transcriptRevision: 3 }
    assert.deepEqual(selectFreshVoiceTranscript(voice, 2), {
      text: 'bdi tshirt black L', originalText: 'bdi tshirt black L', revision: 3,
    })
    assert.equal(selectFreshVoiceTranscript(voice, 3), null)
  })

  test('keeps the provider transcript as reference while accepting an edited draft', () => {
    const voice = { phase: 'review', originalTranscriptText: 'bdi tshirt blak',
      transcriptText: 'bdi tshirt black', transcriptRevision: 7 }
    assert.deepEqual(selectFreshVoiceTranscript(voice, 6), {
      text: 'bdi tshirt black', originalText: 'bdi tshirt blak', revision: 7,
    })
  })

  test('older, pending, failed and empty results cannot overwrite user edits', () => {
    for (const voice of [
      { phase: 'review', transcriptText: 'stale', transcriptRevision: 4 },
      { phase: 'transcribing', transcriptText: 'late', transcriptRevision: 6 },
      { phase: 'error', transcriptText: 'failed', transcriptRevision: 6 },
      { phase: 'review', transcriptText: '   ', transcriptRevision: 6 },
    ]) assert.equal(selectFreshVoiceTranscript(voice, 5), null)
  })
})

describe('voice POS review', () => {
  test('exposes ranked discovery for review without making incomplete candidates addable', () => {
    const discovered = { ...candidate({ quantity: null, missingFields: ['quantity'] }), tier: 'STRONG_CANDIDATE',
      matchedAttributes: ['productType', 'product_name'], unverifiedAttributes: ['quantity'], differences: [] }
    const result = matchResult({ status: 'INCOMPLETE', match: null, candidates: [],
      discovery: { exactVerified: [], strongCandidates: [discovered], alternatives: [], requiresClarification: true } })
    const items = createVoiceReviewItems(result)
    assert.equal(items[0].discovery.strongCandidates[0].variantId, variantA)
    assert.equal(items[0].canSelect, false)
    assert.equal(validateVoiceReview(items, { 0: { confirmed: true, variantId: variantA } }).code, 'VOICE_ITEM_NOT_ADDABLE')
  })
  test('projects a single match with an explicit employee confirmation requirement', () => {
    const items = createVoiceReviewItems(matchResult())
    assert.equal(items.length, 1)
    assert.equal(items[0].defaultVariantId, variantA)
    assert.equal(validateVoiceReview(items, {}).code, 'VOICE_ITEM_REVIEW_REQUIRED')
    assert.equal(validateVoiceReview(items, { 0: { confirmed: true, variantId: variantA } }).selected[0].candidate.sku, 'TS-BLK-L')
  })

  test('keeps multi-item statuses independent and requires ambiguous variant selection', () => {
    const ambiguous = matchResult({ status: 'AMBIGUOUS', reason: 'MULTIPLE_PLAUSIBLE_VARIANTS', match: null,
      candidates: [candidate(), candidate({ variantId: variantB, sku: 'TS-BLK-XL', size: 'XL' })] })
    const result = matchResult({ status: 'INCOMPLETE', match: null, candidates: [], items: [
      { index: 0, segment: { text: 'tshirt black', removedConversationalExpressions: [] }, result: matchResult() },
      { index: 1, segment: { text: 'tshirt large', removedConversationalExpressions: [] }, result: ambiguous },
      { index: 2, segment: { text: 'pants', removedConversationalExpressions: [] }, result: matchResult({ status: 'INCOMPLETE', match: null, candidates: [] }) },
    ] })
    const items = createVoiceReviewItems(result)
    assert.deepEqual(items.map(item => item.status), ['MATCHED', 'AMBIGUOUS', 'INCOMPLETE'])
    assert.equal(items[1].defaultVariantId, null)
    assert.equal(items[1].candidates.length, 2)
    assert.equal(validateVoiceReview(items, {
      0: { confirmed: true, variantId: variantA }, 1: { confirmed: true, variantId: variantB }, 2: { excluded: true },
    }).ok, true)
  })

  test('missing quantity and insufficient stock are never addable', () => {
    for (const unsafe of [candidate({ quantity: null, missingFields: ['quantity'] }), candidate({ quantity: 9, availableStock: 8 })]) {
      const status = unsafe.quantity === null ? 'INCOMPLETE' : 'INSUFFICIENT_STOCK'
      const items = createVoiceReviewItems(matchResult({ status, match: status === 'INCOMPLETE' ? null : unsafe, candidates: [unsafe] }))
      assert.equal(items[0].canSelect, false)
    }
  })

  test('revalidates against a fresh authenticated match before returning cart lines', async () => {
    const result = matchResult()
    const items = createVoiceReviewItems(result)
    let calls = 0
    const checked = await revalidateVoiceReview({ text: parsed.originalText, items,
      decisions: { 0: { confirmed: true, variantId: variantA } },
      request: async ({ text }) => { calls++; assert.equal(text, parsed.originalText); return { ok: true, result } },
    })
    assert.equal(calls, 1)
    assert.equal(checked.ok, true)
    assert.equal(checked.selected[0].candidate.variantId, variantA)
  })

  test('price, stock, quantity, identity, attributes, or disappearance makes the review stale', async () => {
    const original = matchResult()
    const items = createVoiceReviewItems(original)
    for (const fresh of [
      matchResult({ match: candidate({ sellingPrice: '13.00' }), candidates: [candidate({ sellingPrice: '13.00' })] }),
      matchResult({ match: candidate({ availableStock: 7 }), candidates: [candidate({ availableStock: 7 })] }),
      matchResult({ match: candidate({ quantity: 3 }), candidates: [candidate({ quantity: 3 })] }),
      matchResult({ match: candidate({ sku: 'NEW-SKU' }), candidates: [candidate({ sku: 'NEW-SKU' })] }),
      matchResult({ match: candidate({ categoryId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
        candidates: [candidate({ categoryId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })] }),
      matchResult({ match: candidate({ productName: 'Renamed T-Shirt' }), candidates: [candidate({ productName: 'Renamed T-Shirt' })] }),
      matchResult({ match: candidate({ color: 'White' }), candidates: [candidate({ color: 'White' })] }),
      matchResult({ status: 'NOT_FOUND', match: null, candidates: [] }),
    ]) {
      const checked = await revalidateVoiceReview({ text: parsed.originalText, items,
        decisions: { 0: { confirmed: true, variantId: variantA } }, request: async () => ({ ok: true, result: fresh }) })
      assert.equal(checked.code, 'VOICE_REVIEW_STALE')
      assert.equal(checked.stale, true)
    }
  })
})

describe('voice selections use the existing POS cart', () => {
  test('adds fresh safe candidates without creating checkout or inventory operations', () => {
    const result = addVoiceSelectionsToCart([], [{ itemIndex: 0, candidate: candidate() }], 'WAREHOUSE')
    assert.equal(result.ok, true)
    assert.deepEqual(result.cart[0], { variantId: variantA, productName: 'Cedar T-Shirt', categoryName: 'T-Shirts',
      sku: 'TS-BLK-L', color: 'Black', size: 'L', imageUrl: null, availableStock: 8, quantity: 2, unitSoldPrice: '12.50' })
    assert.equal(Object.hasOwn(result, 'sale'), false)
  })

  test('includes existing cart quantity in the fresh stock check and leaves input immutable on failure', () => {
    const cart = [{ variantId: variantA, productName: 'Cedar T-Shirt', categoryName: 'T-Shirts', sku: 'TS-BLK-L',
      color: 'Black', size: 'L', imageUrl: null, availableStock: 20, quantity: 7, unitSoldPrice: '12.50' }]
    const result = addVoiceSelectionsToCart(cart, [{ candidate: candidate() }], 'WAREHOUSE')
    assert.equal(result.code, 'POS_QUANTITY_INVALID')
    assert.equal(cart[0].quantity, 7)
    assert.equal(cart[0].availableStock, 20)
  })

  test('refreshes WAREHOUSE price but preserves an OWNER manual price override', () => {
    const cart = [{ variantId: variantA, productName: 'Cedar T-Shirt', categoryName: 'T-Shirts', sku: 'TS-BLK-L',
      color: 'Black', size: 'L', imageUrl: null, availableStock: 8, quantity: 1, unitSoldPrice: '10.00' }]
    assert.equal(addVoiceSelectionsToCart(cart, [{ candidate: candidate() }], 'WAREHOUSE').cart[0].unitSoldPrice, '12.50')
    assert.equal(addVoiceSelectionsToCart(cart, [{ candidate: candidate() }], 'OWNER').cart[0].unitSoldPrice, '10.00')
  })

  test('blocks a repeated add action while catalog revalidation is pending', async () => {
    const guard = createVoiceCartAddGuard()
    let release
    const pending = new Promise(resolve => { release = resolve })
    const first = guard.run(() => pending)
    assert.deepEqual(await guard.run(() => 'duplicate'), { skipped: true })
    release('added once')
    assert.deepEqual(await first, { skipped: false, value: 'added once' })
  })
})
