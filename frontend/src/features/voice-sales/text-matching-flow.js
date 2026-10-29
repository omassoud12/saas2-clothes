import { authenticatedApiRequest } from '../../auth/owner-flow.js'
import { fitCutIdsByAxis, fitCutModifierIds } from './fit-cut-concepts.js'
import { patternIds, patternModifierIds } from './pattern-concepts.js'

export const MATCH_TEXT_MAX_LENGTH = 4096
export const MATCH_EXAMPLE = 'بدي T-shirt سودا قياس XL قطعتين'
export const MATCH_STATUS_LABELS = Object.freeze({
  MATCHED: 'Supported match', AMBIGUOUS: 'Several possibilities', INCOMPLETE: 'Needs more information',
  NOT_FOUND: 'No eligible match', INSUFFICIENT_STOCK: 'Not enough stock', INVALID_INPUT: 'Invalid input',
})
export const MATCH_FIELD_LABELS = Object.freeze({
  productType: 'Product type', product_name: 'Product name', category: 'Category', color: 'Color', size: 'Size', quantity: 'Quantity',
  material: 'Material', neckline: 'Neckline', fit: 'Fit', pattern: 'Pattern', variant: 'Variant',
  selling_price: 'Selling price', catalog_coverage: 'Catalog coverage',
})
const attributeFields = ['productType', 'color', 'size', 'quantity', 'material', 'neckline', 'fit', 'pattern']
const attributeStatuses = new Set(['missing', 'resolved', 'ambiguous', 'conflict'])
const parserStatuses = new Set(['parsed', 'incomplete', 'needs_clarification', 'unsupported_multiple_items', 'invalid_input'])
const evidenceSources = new Set(['variant_column', 'product_name', 'category_name', 'literal_product_name', 'partial_name_suggestion', 'sku', 'barcode'])
const issueKinds = new Set(['lexical_ambiguity', 'conflicting_attribute', 'unresolved_number', 'unsupported_value',
  'uncertain_transcription', 'unsupported_structure', 'multiple_items', 'invalid_input'])
const fail = (code, message, extra = {}) => Object.freeze({ ok: false, code, message, ...extra })
const text = value => typeof value === 'string' && value.length <= 8192
const scalar = value => text(value) || Number.isSafeInteger(value)
const whole = value => Number.isSafeInteger(value) && value >= 0
const nullableText = value => value === null || text(value)
const list = (value, check, max = 4096) => Array.isArray(value) && value.length <= max && value.every(check)
const fields = value => list(value, field => Object.hasOwn(MATCH_FIELD_LABELS, field), 16)
const span = value => value && text(value.text) && whole(value.startToken) && whole(value.endToken) && value.endToken >= value.startToken
const quantityUnits = new Set(['PIECE', 'PAIR', 'DOZEN', 'HALF_DOZEN', 'QUARTER_DOZEN', 'SET', 'PACK',
  'BUNDLE', 'BOX', 'CARTON', 'BAG', 'ROLL', 'HANGER', 'BALE', 'SACK', 'LOT', 'MULTIPACK', 'STRIP',
  'METER', 'CENTIMETER', 'YARD', 'KILOGRAM', 'GRAM'])
const expressionCategories = new Set(['REQUEST', 'AVAILABILITY', 'PRICE', 'PREFERENCE', 'REJECTION',
  'CONFIRMATION', 'ORDER_CHANGE', 'CANCEL', 'ORDER_STATUS', 'DELIVERY', 'PAYMENT', 'RETURN',
  'SIZING_HELP', 'MATERIAL_HELP', 'PHOTO', 'NEGOTIATION', 'CONTEXT', 'AMBIGUOUS'])
const requestIntentIds = new Set(['REQ_WANT', 'REQ_GIVE', 'REQ_GET', 'REQ_ADD_INTENT'])
function requestIntentPreview(value) {
  if (value === undefined) return undefined
  if (!list(value, row => row && requestIntentIds.has(row.canonicalIntent) && text(row.matchedExpression)
    && span(row.sourceSpan) && row.sourceSpan.endToken > row.sourceSpan.startToken
    && ['arabic_lebanese', 'arabic_msa', 'english', 'french', 'arabizi'].includes(row.languageEvidence)
    && ['affirmative', 'negated'].includes(row.polarity) && ['exact', 'context_required'].includes(row.certainty)
    && [null, 'REQUIRES_PRODUCT_CONTEXT'].includes(row.contextualUncertainty)
    && (row.itemIndex === undefined || whole(row.itemIndex))
    && row.recognitionOnly === true && row.authorizesAction === false, 16)) return null
  return value.map(row => ({ canonicalIntent: row.canonicalIntent, matchedExpression: row.matchedExpression,
    sourceSpan: { text: row.sourceSpan.text, startToken: row.sourceSpan.startToken, endToken: row.sourceSpan.endToken },
    languageEvidence: row.languageEvidence, polarity: row.polarity, certainty: row.certainty,
    contextualUncertainty: row.contextualUncertainty, recognitionOnly: true, authorizesAction: false,
    ...(row.itemIndex === undefined ? {} : { itemIndex: row.itemIndex }) }))
}
function commonExpressionPreview(value) {
  const cues = value.commonExpressionMatches
  const safety = value.commonExpressionSafety
  if (cues === undefined && safety === undefined) return {}
  if (!list(cues, row => row && span(row.span) && row.span.endToken > row.span.startToken
    && list(row.candidates, id => typeof id === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(id), 141)
    && row.candidates.length > 0 && list(row.categories, category => expressionCategories.has(category), 18)
    && row.categories.length > 0 && ['recognized', 'context_required', 'suggestion'].includes(row.status)
    && ['intent', 'attribute_overlap', 'grammar', 'literal_name'].includes(row.role)
    && ['affirmative', 'negated', 'uncertain'].includes(row.polarity)
    && row.recognitionOnly === true && row.authorizesAction === false && row.provenance === 'seed_unvalidated')
    || !safety || typeof safety.salePreviewAllowed !== 'boolean' || safety.recognitionOnly !== true
    || safety.authorizesAction !== false || !['AFFIRMATIVE_OR_ATTRIBUTE_TEXT', 'NON_SALE_INTENT',
      'INTENT_REQUIRES_CONTEXT', 'NEGATED_INTENT'].includes(safety.reason)
    || safety.salePreviewAllowed !== (safety.reason === 'AFFIRMATIVE_OR_ATTRIBUTE_TEXT')
    || safety.salePreviewAllowed && cues.some(row => row.role === 'intent' && (row.status !== 'recognized'
      || row.polarity !== 'affirmative' || row.categories.some(category => category !== 'REQUEST')
      || row.candidates.some(id => !['REQ_WANT', 'REQ_NEED', 'REQ_SEARCH'].includes(id))))) return null
  return {
    commonExpressionMatches: cues.map(row => ({ span: { text: row.span.text, startToken: row.span.startToken, endToken: row.span.endToken },
      candidates: [...row.candidates], categories: [...row.categories], status: row.status, role: row.role,
      polarity: row.polarity, recognitionOnly: true, authorizesAction: false, provenance: 'seed_unvalidated' })),
    commonExpressionSafety: { salePreviewAllowed: safety.salePreviewAllowed, reason: safety.reason,
      recognitionOnly: true, authorizesAction: false },
  }
}
function quantityPreview(value) {
  if (!value || !['missing', 'resolved', 'context_required', 'advisory', 'conflict', 'invalid'].includes(value.status)
    || !['order', 'approx', 'min', 'max', 'range', 'add', 'remove', 'allocation', 'inventory', 'needs_review', 'not_quantity'].includes(value.intent)
    || !(value.orderUnits === null || typeof value.orderUnits === 'number' && Number.isFinite(value.orderUnits))
    || !(value.unitId === null || quantityUnits.has(value.unitId))
    || !list(value.unitCandidates, id => quantityUnits.has(id), 23)
    || value.unitId !== null && !value.unitCandidates.includes(value.unitId)
    || !(value.resolvedPieces === null || Number.isSafeInteger(value.resolvedPieces) && value.resolvedPieces > 0 && value.resolvedPieces <= 1_000_000)
    || typeof value.needsCatalogMetadata !== 'boolean'
    || !['exact', 'approximate', 'bounded', 'range', 'unresolved'].includes(value.exactness)
    || !list(value.reasons, text, 20)
    || (value.status === 'resolved' ? value.intent !== 'order' || value.unitId !== 'PIECE' || value.resolvedPieces !== value.orderUnits
      || value.resolvedPieces === null || value.needsCatalogMetadata || value.exactness !== 'exact'
      || value.unitCandidates.length !== 1
      : value.resolvedPieces !== null)) return null
  return Object.freeze({ status: value.status, intent: value.intent, orderUnits: value.orderUnits, unitId: value.unitId,
    unitCandidates: [...value.unitCandidates], resolvedPieces: value.resolvedPieces,
    needsCatalogMetadata: value.needsCatalogMetadata, exactness: value.exactness, reasons: [...value.reasons] })
}

export function canUseMatchingLab(profile) {
  return ['OWNER', 'WAREHOUSE'].includes(profile?.user?.role) && profile.user.isActive === true
    && Boolean(profile.user.id) && Boolean(profile.account?.id) && profile.account.status === 'ACTIVE'
}

/** Input validation only: no vocabulary, parsing or catalog interpretation in the browser. */
export function validateMatchText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MATCH_TEXT_MAX_LENGTH) {
    return fail('INVALID_MATCH_TEXT', `Enter a sentence from 1 to ${MATCH_TEXT_MAX_LENGTH.toLocaleString('en-US')} characters.`)
  }
  if ([...value].some(character => {
    const code = character.codePointAt(0)
    return code < 32 && ![9, 10, 13].includes(code) || code === 127
  })
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    return fail('INVALID_MATCH_TEXT', 'Remove invalid characters and try again.')
  }
  return Object.freeze({ ok: true, text: value })
}

function preview(value) {
  if (!value || !text(value.productId) || !text(value.variantId) || !text(value.productName) || !text(value.categoryName)
    || !(value.categoryId === undefined || text(value.categoryId))
    || !(value.sku === undefined || typeof value.sku === 'string' && value.sku.length > 0 && value.sku.length <= 100)
    || !(value.barcode === undefined || value.barcode === null || typeof value.barcode === 'string'
      && value.barcode.length > 0 && value.barcode.length <= 100)
    || !nullableText(value.color) || !nullableText(value.size) || !whole(value.availableStock)
    || !(value.quantity === null || Number.isSafeInteger(value.quantity) && value.quantity > 0)
    || !(value.sellingPrice === null || typeof value.sellingPrice === 'string' && /^(?:0|[1-9]\d{0,15})\.\d{2}$/u.test(value.sellingPrice))
    || typeof value.currency !== 'string' || !/^[A-Z]{3}$/u.test(value.currency) || value.requiresConfirmation !== true
    || !(value.imageUrl === undefined || value.imageUrl === null || typeof value.imageUrl === 'string'
      && value.imageUrl.length <= 4096 && /^https?:\/\//u.test(value.imageUrl))
    || !fields(value.missingFields) || !list(value.unresolvedConstraints, field => attributeFields.includes(field), 8)
    || !list(value.evidence, row => row && (attributeFields.includes(row.field) || row.field === 'product_name')
      && evidenceSources.has(row.source) && text(row.requested) && nullableText(row.actual), 8192)) return null
  return Object.freeze({ productId: value.productId, variantId: value.variantId,
    ...(value.categoryId === undefined ? {} : { categoryId: value.categoryId }),
    ...(value.sku === undefined ? {} : { sku: value.sku }), ...(value.barcode === undefined ? {} : { barcode: value.barcode }), productName: value.productName,
    categoryName: value.categoryName, color: value.color, size: value.size, quantity: value.quantity,
    sellingPrice: value.sellingPrice, availableStock: value.availableStock, currency: value.currency,
    imageUrl: value.imageUrl ?? null,
    requiresConfirmation: true, missingFields: [...value.missingFields], unresolvedConstraints: [...value.unresolvedConstraints],
    evidence: value.evidence.map(row => ({ field: row.field, source: row.source, requested: row.requested, actual: row.actual })) })
}

function discoveryPreview(value) {
  if (!value || !['EXACT_VERIFIED', 'STRONG_CANDIDATE', 'ALTERNATIVE'].includes(value.tier)
    || !list(value.matchedAttributes, field => attributeFields.includes(field) || ['product_name', 'category'].includes(field), 10)
    || !list(value.unverifiedAttributes, field => attributeFields.includes(field) || ['product_name', 'category'].includes(field), 10)
    || !list(value.differences, row => row && (attributeFields.includes(row.field) || ['product_name', 'category'].includes(row.field))
      && text(row.requested) && nullableText(row.actual), 10)) return null
  const base = preview(value)
  if (!base) return null
  return Object.freeze({ ...base, tier: value.tier, matchedAttributes: [...value.matchedAttributes],
    unverifiedAttributes: [...value.unverifiedAttributes],
    differences: value.differences.map(row => ({ field: row.field, requested: row.requested, actual: row.actual })) })
}

function categoryResolutionPreview(value) {
  if (!value || !['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED', 'PARTIAL'].includes(value.status)
    || typeof value.coverageComplete !== 'boolean'
    || !list(value.candidates, row => row && (row.categoryId === null || text(row.categoryId))
      && text(row.categoryName) && whole(row.productCount)
      && list(row.evidence, item => ['EXACT_NAME', 'PRODUCT_TYPE_BRIDGE'].includes(item), 2)
      && row.evidence.length > 0, 20)
    || value.status === 'RESOLVED' && (!value.coverageComplete || value.candidates.length !== 1)
    || value.status === 'AMBIGUOUS' && (!value.coverageComplete || value.candidates.length < 2)
    || value.status === 'UNRESOLVED' && (!value.coverageComplete || value.candidates.length !== 0)
    || value.status === 'PARTIAL' && value.coverageComplete) return null
  return Object.freeze({ status: value.status, coverageComplete: value.coverageComplete,
    candidates: value.candidates.map(row => Object.freeze({ categoryId: row.categoryId, categoryName: row.categoryName,
      evidence: Object.freeze([...row.evidence]), productCount: row.productCount })) })
}

function parserPreview(value) {
  if (!value || !parserStatuses.has(value.status) || !nullableText(value.originalText) || !text(value.normalizedText)
    || !fields(value.missingInformation) || !fields(value.unresolvedInformation)) return null
  const attributes = {}
  const expressions = commonExpressionPreview(value)
  if (expressions === null) return null
  const requestIntents = requestIntentPreview(value.requestIntents)
  if (requestIntents === null) return null
  const sourceAttributes = {}
  const fitAxes = Object.keys(fitCutIdsByAxis)
  const sourceFitCuts = {}
  if (value.sourceFitCuts !== undefined && (!value.sourceFitCuts || typeof value.sourceFitCuts !== 'object'
    || fitAxes.some(axis => !Object.hasOwn(value.sourceFitCuts, axis)))) return null
  const quantityIntent = value.quantityIntent === undefined ? undefined : quantityPreview(value.quantityIntent)
  if (quantityIntent === null) return null
  const sourceFields = ['sourceProductType', 'sourceColorId', 'sourceSizeId', 'sourceMaterial', 'sourceNecklineShape', 'sourceCollarType', 'sourcePatternId']
  for (const field of [...attributeFields, ...sourceFields.filter(field => value[field] !== undefined), ...(value.sourceFitCuts ? fitAxes.map(axis => `fitCut:${axis}`) : [])]) {
    const fitAxis = field.startsWith('fitCut:')
    const axis = field.slice(7)
    const row = fitAxis ? value.sourceFitCuts[axis] : sourceFields.includes(field) ? value[field] : value.attributes?.[field]
    if (!row || !attributeStatuses.has(row.status) || !(row.value === null || scalar(row.value))
      || !list(row.candidates, scalar) || ![null, 'explicit', 'inferred', 'mixed'].includes(row.source)
      || (row.status === 'resolved') !== (row.value !== null)
      || !list(row.evidence, item => item && span(item.span) && ['explicit', 'inferred'].includes(item.source) && text(item.rule))) return null
    if (sourceFields.includes(field) || fitAxis) {
      const identifier = candidate => typeof candidate === 'string' && /^[A-Z][A-Za-z0-9_]{0,79}$/u.test(candidate)
      if (!row.candidates.every(identifier) || row.value !== null && (!identifier(row.value) || !row.candidates.includes(row.value))) return null
      if (fitAxis && (!row.candidates.every(id => fitCutIdsByAxis[axis].includes(id)) || row.candidates.length > fitCutIdsByAxis[axis].length)) return null
      if (fitAxis && (row.status === 'resolved' && row.candidates.length !== 1 || row.status === 'missing' && row.candidates.length !== 0)) return null
    }
    const projected = { status: row.status, value: row.value, candidates: [...row.candidates], source: row.source,
      evidence: row.evidence.map(item => ({ span: { text: item.span.text, startToken: item.span.startToken, endToken: item.span.endToken }, source: item.source, rule: item.rule })) }
    if (fitAxis) sourceFitCuts[axis] = projected
    else if (sourceFields.includes(field)) sourceAttributes[field] = projected
    else attributes[field] = projected
  }
  const tokens = {}
  const identifier = candidate => typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(candidate)
  let materialCandidates, materialComposition
  let necklineCandidates
  let fitCutCandidates, patternCandidates
  if (value.sourcePatternId !== undefined && (!list(value.sourcePatternId.candidates, id => patternIds.includes(id), 169)
    || value.sourcePatternId.value !== null && !patternIds.includes(value.sourcePatternId.value))) return null
  if (value.patternCandidates !== undefined) {
    if (!list(value.patternCandidates, row => span(row) && typeof row.constrainsCatalog === 'boolean'
      && ['descriptor', 'modifier', 'literal_name', 'owned_by_other', 'requires_context'].includes(row.role)
      && ['affirmative', 'negated'].includes(row.polarity) && row.result
      && ['matched', 'context_required', 'unknown'].includes(row.result.status)
      && list(row.result.patterns, id => patternIds.includes(id), 169)
      && list(row.result.modifiers, id => patternModifierIds.includes(id), 25)
      && (row.modifierTarget === null || span(row.modifierTarget))
      && (!row.constrainsCatalog || row.polarity === 'affirmative' && ['descriptor', 'modifier'].includes(row.role)), 4096)) return null
    patternCandidates = value.patternCandidates.map(row => ({text: row.text, startToken: row.startToken, endToken: row.endToken,
      constrainsCatalog: row.constrainsCatalog, role: row.role, polarity: row.polarity, status: row.result.status,
      patterns: [...row.result.patterns], modifiers: [...row.result.modifiers],
      modifierTarget: row.modifierTarget === null ? null : {text: row.modifierTarget.text, startToken: row.modifierTarget.startToken, endToken: row.modifierTarget.endToken}}))
  }
  if (value.fitCutCandidates !== undefined) {
    const fitIds = Object.values(fitCutIdsByAxis).flat()
    if (!list(value.fitCutCandidates, row => span(row) && typeof row.constrainsCatalog === 'boolean'
      && ['descriptor', 'modifier', 'literal_name', 'owned_by_other', 'requires_context'].includes(row.role)
      && ['affirmative', 'negated'].includes(row.polarity) && row.result
      && ['matched', 'context_required', 'unknown'].includes(row.result.status)
      && list(row.result.styles, id => fitIds.includes(id), 144)
      && list(row.result.modifiers, id => fitCutModifierIds.includes(id), 10)
      && (row.modifierTarget === null || span(row.modifierTarget))
      && (!row.constrainsCatalog || row.polarity === 'affirmative' && ['descriptor', 'modifier'].includes(row.role)), 4096)) return null
    fitCutCandidates = value.fitCutCandidates.map(row => ({text: row.text, startToken: row.startToken, endToken: row.endToken,
      constrainsCatalog: row.constrainsCatalog, role: row.role, polarity: row.polarity, status: row.result.status,
      styles: [...row.result.styles], modifiers: [...row.result.modifiers],
      modifierTarget: row.modifierTarget === null ? null : {text: row.modifierTarget.text, startToken: row.modifierTarget.startToken, endToken: row.modifierTarget.endToken}}))
  }
  if (value.necklineCandidates !== undefined) {
    if (!list(value.necklineCandidates, row => span(row) && typeof row.constrainsCatalog === 'boolean'
      && typeof row.domainExplicit === 'boolean' && row.result
      && ['matched', 'context_required', 'unknown'].includes(row.result.status)
      && list(row.result.shapes, identifier, 45) && list(row.result.collars, identifier, 47)
      && list(row.result.modifiers, identifier, 38) && list(row.result.externalRoles, text, 20), 4096)) return null
    necklineCandidates = value.necklineCandidates.map(row => ({ text: row.text, startToken: row.startToken,
      endToken: row.endToken, constrainsCatalog: row.constrainsCatalog, domainExplicit: row.domainExplicit,
      status: row.result.status, shapes: [...row.result.shapes], collars: [...row.result.collars],
      modifiers: [...row.result.modifiers], externalRoles: [...row.result.externalRoles] }))
  }
  if (value.materialCandidates !== undefined) {
    if (!list(value.materialCandidates, row => span(row) && typeof row.constrainsCatalog === 'boolean'
      && typeof row.domainExplicit === 'boolean' && row.result
      && ['matched', 'context_required', 'blocked', 'unknown'].includes(row.result.status)
      && list(row.result.fabrics, identifier, 147) && list(row.result.modifiers, identifier, 35), 4096)) return null
    materialCandidates = value.materialCandidates.map(row => ({ text: row.text, startToken: row.startToken,
      endToken: row.endToken, constrainsCatalog: row.constrainsCatalog, domainExplicit: row.domainExplicit,
      status: row.result.status, fabrics: [...row.result.fabrics], modifiers: [...row.result.modifiers] }))
  }
  if (value.materialComposition !== undefined) {
    if (!list(value.materialComposition, row => row && span(row.span) && ['requested', 'invalid', 'unbound'].includes(row.status)
      && row.catalogVerified === false && list(row.candidates, identifier, 147)
      && (row.percentage === null || whole(row.percentage) && row.percentage <= 100)
      && (row.status !== 'requested' || row.percentage !== null && row.candidates.length > 0), 4096)) return null
    materialComposition = value.materialComposition.map(row => ({ span: { text: row.span.text, startToken: row.span.startToken, endToken: row.span.endToken },
      percentage: row.percentage, candidates: [...row.candidates], status: row.status, catalogVerified: false }))
  }
  if (quantityIntent && (quantityIntent.status === 'resolved'
    ? attributes.quantity.status !== 'resolved' || attributes.quantity.value !== quantityIntent.resolvedPieces
    : attributes.quantity.value !== null)) return null
  for (const field of ['productNameResidualTokens', 'unrecognizedTokens', 'conversationalTokens']) {
    if (!list(value[field], row => row && text(row.token) && whole(row.index))) return null
    tokens[field] = value[field].map(row => ({ token: row.token, index: row.index }))
  }
  if (!list(value.ambiguities, row => row && issueKinds.has(row.kind) && text(row.message) && span(row.span) && fields(row.fields)
    && list(row.alternatives, item => item && attributeFields.includes(item.field) && scalar(item.value)))) return null
  return Object.freeze({ status: value.status, originalText: value.originalText, normalizedText: value.normalizedText,
    attributes, ...sourceAttributes, ...tokens, ...expressions,
    ...(requestIntents === undefined ? {} : { requestIntents }), ...(quantityIntent ? { quantityIntent } : {}),
    ...(value.sourceFitCuts ? { sourceFitCuts } : {}), ...(fitCutCandidates ? { fitCutCandidates } : {}),
    ...(patternCandidates ? { patternCandidates } : {}),
    ...(necklineCandidates ? { necklineCandidates } : {}),
    ...(materialCandidates ? { materialCandidates } : {}), ...(materialComposition ? { materialComposition } : {}),
    missingInformation: [...value.missingInformation], unresolvedInformation: [...value.unresolvedInformation],
    ambiguities: value.ambiguities.map(row => ({ kind: row.kind, message: row.message,
      span: { text: row.span.text, startToken: row.span.startToken, endToken: row.span.endToken }, fields: [...row.fields],
      alternatives: row.alternatives.map(item => ({ field: item.field, value: item.value })) })) })
}

function projectMatchResult(value, allowItems) {
  if (!value || !Object.hasOwn(MATCH_STATUS_LABELS, value.status) || typeof value.reason !== 'string'
    || !/^[A-Z][A-Z0-9_]{0,99}$/u.test(value.reason) || value.requiresConfirmation !== true
    || !fields(value.missingFields) || !list(value.candidates, row => Boolean(preview(row)), 20)
    || !list(value.suggestions, row => Boolean(preview(row)), 5)) return null
  const parser = parserPreview(value.parser)
  const match = value.match === null ? null : preview(value.match)
  const catalog = value.catalog
  if (!parser || (value.match !== null && !match) || !catalog || !whole(catalog.scannedVariants)
    || typeof catalog.truncated !== 'boolean' || !whole(catalog.candidateCount) || typeof catalog.candidatesTruncated !== 'boolean'
    || (['MATCHED', 'INSUFFICIENT_STOCK'].includes(value.status) && !match)
    || (!['MATCHED', 'INSUFFICIENT_STOCK'].includes(value.status) && match !== null)
    || (['MATCHED', 'INSUFFICIENT_STOCK'].includes(value.status) && parser.quantityIntent
      && (parser.quantityIntent.status !== 'resolved' || parser.quantityIntent.resolvedPieces !== match.quantity))
    || (['MATCHED', 'INSUFFICIENT_STOCK'].includes(value.status) && parser.materialComposition?.length)
    || (['MATCHED', 'INSUFFICIENT_STOCK'].includes(value.status) && parser.commonExpressionSafety?.salePreviewAllowed === false)
    || (['MATCHED', 'INSUFFICIENT_STOCK'].includes(value.status) && parser.patternCandidates?.some(row => row.polarity === 'negated'))
    || (['MATCHED', 'INSUFFICIENT_STOCK'].includes(value.status) && (parser.fitCutCandidates?.some(row => row.polarity === 'negated' && row.styles.length)
      || Object.values(parser.sourceFitCuts ?? {}).some(row => row.status === 'conflict')))
    || (value.status === 'MATCHED' && (value.missingFields.length || catalog.truncated || catalog.candidateCount !== 1
      || match.missingFields.length || match.unresolvedConstraints.length || match.quantity === null
      || match.quantity > match.availableStock || match.sellingPrice === null || /^0\.00$/u.test(match.sellingPrice)))) return null
  let discovery
  if (value.discovery !== undefined) {
    const row = value.discovery
    const categoryResolution = row?.categoryResolution === undefined ? undefined
      : categoryResolutionPreview(row.categoryResolution)
    if (!row || typeof row.requiresClarification !== 'boolean'
      || row.categoryResolution !== undefined && !categoryResolution
      || !list(row.exactVerified, candidate => Boolean(discoveryPreview(candidate)), 20)
      || !list(row.strongCandidates, candidate => Boolean(discoveryPreview(candidate)), 20)
      || !list(row.alternatives, candidate => Boolean(discoveryPreview(candidate)), 20)
      || row.exactVerified.some(candidate => candidate.tier !== 'EXACT_VERIFIED')
      || row.strongCandidates.some(candidate => candidate.tier !== 'STRONG_CANDIDATE')
      || row.alternatives.some(candidate => candidate.tier !== 'ALTERNATIVE')) return null
    discovery = Object.freeze({ exactVerified: row.exactVerified.map(discoveryPreview),
      strongCandidates: row.strongCandidates.map(discoveryPreview), alternatives: row.alternatives.map(discoveryPreview),
      requiresClarification: row.requiresClarification,
      ...(categoryResolution ? { categoryResolution } : {}) })
  }
  let items
  let segmentation
  if (value.items !== undefined || value.segmentation !== undefined) {
    if (!allowItems || value.status !== 'INCOMPLETE' || value.match !== null
      || value.reason !== 'MULTIPLE_ITEMS_REQUIRE_INDEPENDENT_CONFIRMATION'
      || !list(value.items, row => row && whole(row.index) && row.segment && text(row.segment.text)
        && list(row.segment.removedConversationalExpressions, text, 20) && row.result, 8)
      || value.items.length < 2 || value.items.some((row, index) => row.index !== index)
      || !value.segmentation || value.segmentation.status !== 'segmented'
      || !text(value.segmentation.normalizedText)
      || !['REPEATED_EXPLICIT_REQUEST_MARKERS', 'CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE'].includes(value.segmentation.reason)
      || !list(value.segmentation.removedConversationalExpressions, text, 40)) return null
    const projected = value.items.map(row => projectMatchResult(row.result, false))
    if (projected.some(row => !row)) return null
    items = value.items.map((row, index) => Object.freeze({ index: row.index,
      segment: Object.freeze({ text: row.segment.text,
        removedConversationalExpressions: [...row.segment.removedConversationalExpressions] }),
      result: projected[index],
    }))
    segmentation = Object.freeze({ status: 'segmented', normalizedText: value.segmentation.normalizedText,
      reason: value.segmentation.reason,
      removedConversationalExpressions: [...value.segmentation.removedConversationalExpressions] })
  }
  return Object.freeze({ status: value.status, reason: value.reason, requiresConfirmation: true,
    parser, match, candidates: value.candidates.map(preview), suggestions: value.suggestions.map(preview),
    missingFields: [...value.missingFields], catalog: { scannedVariants: catalog.scannedVariants, truncated: catalog.truncated,
      candidateCount: catalog.candidateCount, candidatesTruncated: catalog.candidatesTruncated },
    ...(discovery ? { discovery } : {}),
    ...(items ? { items: Object.freeze(items), segmentation } : {}) })
}

/** Validate and project the server contract. No raw JSON dump or extra financial fields. */
export function normalizeMatchResult(value) {
  const result = projectMatchResult(value, true)
  return result ? Object.freeze({ ok: true, result })
    : fail('INVALID_MATCH_RESPONSE', 'The matching service returned an unexpected response. Try again.')
}

function apiFailure(result) {
  const forbiddenMessages = Object.freeze({
    ANONYMOUS_IDENTITY_FORBIDDEN: 'Voice matching rejected an anonymous login.',
    EMAIL_NOT_CONFIRMED: 'Voice matching requires a confirmed email address.',
    APPLICATION_USER_NOT_FOUND: 'Voice matching could not find this login in the application users.',
    USER_INACTIVE: 'Voice matching is blocked because this application user is inactive.',
    ROLE_FORBIDDEN: 'Voice matching received a role other than OWNER or WAREHOUSE.',
    TENANT_ACCESS_REQUIRED: 'Voice matching could not resolve an active store for this user.',
    ACCOUNT_NOT_FOUND: 'Voice matching could not find this user’s store account.',
    ACCOUNT_PENDING: 'Voice matching is blocked while the store account is pending.',
    ACCOUNT_REJECTED: 'Voice matching is blocked because the store account is rejected.',
    ACCOUNT_SUSPENDED: 'Voice matching is blocked because the store account is suspended.',
    ACCOUNT_NOT_ACTIVE: 'Voice matching requires an active store account.',
    CORS_ORIGIN_FORBIDDEN: 'Voice matching rejected the current frontend origin.',
  })
  const safeForbiddenCode = result.status === 403 && Object.hasOwn(forbiddenMessages, result.code) ? result.code : null
  const message = result.code === 'SESSION_REQUIRED' || result.status === 401 ? 'Your session has expired. Sign in again.'
    : safeForbiddenCode ? forbiddenMessages[safeForbiddenCode]
      : result.status === 403 ? 'Matching is unavailable for your current role or store status.'
      : result.status === 422 ? 'The sentence could not be validated. Check the text and try again.'
        : result.status === 429 ? 'Too many attempts. Wait before testing again.'
          : 'The matching service is unavailable. Please try again.'
  // Raw provider messages and unknown response properties never enter presentation state.
  return fail(safeForbiddenCode || 'MATCH_REQUEST_FAILED', message, { status: result.status,
    ...(result.status === 401 || result.code === 'SESSION_REQUIRED' ? { requiresLogin: true } : {}),
    ...(whole(result.retryAfterSeconds) && result.retryAfterSeconds > 0 ? { retryAfterSeconds: result.retryAfterSeconds } : {}) })
}

export async function requestTextMatch({ supabase, text: sentence, fetchImpl }) {
  const validation = validateMatchText(sentence)
  if (!validation.ok) return validation
  const response = await authenticatedApiRequest({ supabase, fetchImpl, path: '/api/voice-sales/match',
    method: 'POST', payload: { text: validation.text }, acceptedStatuses: [422],
    fallbackMessage: 'The matching service is unavailable. Please try again.' })
  if (!response.ok) return apiFailure(response)
  // Phase 1C returns a structured INVALID_INPUT match result with HTTP 422.
  // Preserve that result; ordinary 422 error envelopes remain validation failures.
  if (response.status === 422 && response.data?.status !== 'INVALID_INPUT') return apiFailure(response)
  if (![200, 422].includes(response.status)) return apiFailure(response)
  return normalizeMatchResult(response.data)
}

/** One manual request at a time; edits/reset invalidate older responses without retrying. */
export function createTextMatchingController({ request = requestTextMatch, supabase, now = Date.now } = {}) {
  let state = Object.freeze({ text: '', pending: false, result: null, error: null, retryAt: 0, confirmedItems: [] })
  let revision = 0
  let inFlight = false
  const listeners = new Set()
  const publish = patch => {
    state = Object.freeze({ ...state, ...patch })
    listeners.forEach(listener => listener())
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    invalidate() { revision++; listeners.clear() },
    setText(value) { revision++; publish({ text: value, result: null, error: null, confirmedItems: [] }) },
    reset() { revision++; publish({ text: '', result: null, error: null, confirmedItems: [] }) },
    confirmItem(index) {
      if (!Number.isSafeInteger(index) || !state.result?.items?.some(item => item.index === index)) return false
      if (!state.confirmedItems.includes(index)) publish({ confirmedItems: Object.freeze([...state.confirmedItems, index]) })
      return true
    },
    async submit() {
      if (inFlight || now() < state.retryAt) return { skipped: true }
      const validated = validateMatchText(state.text)
      if (!validated.ok) { publish({ error: validated, result: null }); return validated }
      const current = ++revision
      inFlight = true
      publish({ pending: true, result: null, error: null, confirmedItems: [] })
      try {
        const response = await request({ supabase, text: validated.text })
        if (response.status === 429) publish({ retryAt: now() + (response.retryAfterSeconds || 60) * 1000 })
        if (current !== revision) return { ignored: true }
        publish(response.ok ? { result: response.result, error: null } : { error: response, result: null,
          retryAt: response.status === 429 ? now() + (response.retryAfterSeconds || 60) * 1000 : state.retryAt })
        return response
      } catch {
        const error = fail('MATCH_REQUEST_FAILED', 'The matching service is unavailable. Please try again.')
        if (current === revision) publish({ error, result: null })
        return error
      } finally {
        inFlight = false
        publish({ pending: false })
      }
    },
  })
}
