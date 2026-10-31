import { activeProductTypes, normalizeText, tokenizeText } from './index.js'
import { parseVoiceSaleText } from './parser.js'
import type { ParseSpan, VoiceSaleParserOptions } from './parser.types.js'
import { requestIntentAliasAt } from './request-intent.js'

export type MultiItemSegmentationStatus = 'single' | 'segmented' | 'ambiguous'

export interface VoiceSaleSegment {
  readonly index: number
  /** Normalized, display-safe segment with request markers and trailing vocatives removed. */
  readonly text: string
  /** Parser input with non-semantic attribute linkers removed as well. */
  readonly parseText: string
  readonly parserOptions: VoiceSaleParserOptions
  readonly removedConversationalExpressions: readonly string[]
}

export interface VoiceSaleSegmentationResult {
  readonly status: MultiItemSegmentationStatus
  readonly normalizedText: string
  readonly segments: readonly VoiceSaleSegment[]
  readonly reasons: readonly string[]
  readonly removedConversationalExpressions: readonly string[]
}

const MAX_ITEMS = 8
const MAX_CONJUNCTION_BOUNDARIES = 16
const trailingVocatives = [
  ['يا', 'كبير'], ['يا', 'معلم'], ['يا', 'خيي'], ['ya', 'kbir'], ['ya', 'm3allem'], ['ya', 'khayye'],
] as const
const attributeLinkers = new Set(['لونه', 'لونها', 'lawno', 'lawna'])
const unsafeScopeTokens = new Set(['ما', 'مش', 'not', 'no', 'قصدي', 'actually', 'instead'])
const conjunctions = new Set(['و', 'w', 'and'])

interface ConjunctionBoundary {
  readonly index: number
  readonly rightPrefix?: string
}

function markerLengthAt(tokens: readonly string[], index: number): number {
  return requestIntentAliasAt(tokens, index)?.tokens.length ?? 0
}

function hasProductEvidence(text: string): boolean {
  return activeProductTypes.matchTokens(text).some(match => match.result.candidates.length > 0)
}

function stripTrailingVocative(tokens: string[], removed: string[]): void {
  let changed = true
  while (changed) {
    changed = false
    for (const phrase of trailingVocatives) {
      if (tokens.length >= phrase.length && phrase.every((token, offset) => tokens[tokens.length - phrase.length + offset] === token)) {
        removed.unshift(tokens.splice(tokens.length - phrase.length, phrase.length).join(' '))
        changed = true
        break
      }
    }
  }
}

function segmentFromTokens(index: number, rawTokens: readonly string[]): VoiceSaleSegment {
  const semanticTokens = [...rawTokens]
  const removed: string[] = []
  stripTrailingVocative(semanticTokens, removed)
  const markerLength = markerLengthAt(semanticTokens, 0)
  const displayTokens = semanticTokens.slice(markerLength)
  const parseTokens = semanticTokens.filter(token => {
    if (!attributeLinkers.has(token)) return true
    removed.push(token)
    return false
  })
  const parseText = parseTokens.join(' ')
  const productMatches = activeProductTypes.matchTokens(parseText)
  const hasDefiniteNonPoloProduct = productMatches.some(match => match.phrase !== 'polo'
    && match.result.candidates.some(candidate => candidate.canonicalType !== null && candidate.canonicalType !== 'POLO_SHIRT'))
  const literalProductNameSpans: ParseSpan[] = hasDefiniteNonPoloProduct
    ? productMatches.filter(match => match.phrase === 'polo').map(match => Object.freeze({
      startToken: match.startToken, endToken: match.endToken, text: match.phrase,
    })) : []
  // A small integer immediately before the segment's product is a quantity only
  // after a safe item boundary was established. Larger bare numbers remain
  // ambiguous because they commonly represent clothing sizes.
  const contextualOrderCountSpans: ParseSpan[] = productMatches.flatMap(match => {
    const position = match.startToken - 1
    const token = parseTokens[position]
    if (position < 0 || !/^\d+$/u.test(token ?? '')) return []
    const value = Number(token)
    return Number.isSafeInteger(value) && value >= 1 && value <= 20
      ? [Object.freeze({ startToken: position, endToken: position + 1, text: token })] : []
  })
  return Object.freeze({ index, text: displayTokens.join(' '), parseText,
    parserOptions: Object.freeze({ itemIndex: index, literalProductNameSpans: Object.freeze(literalProductNameSpans),
      contextualOrderCountSpans: Object.freeze(contextualOrderCountSpans) }),
    removedConversationalExpressions: Object.freeze(removed),
  })
}

function conjunctionBoundaries(tokens: readonly string[]): ConjunctionBoundary[] {
  return tokens.flatMap((token, index): ConjunctionBoundary[] => {
    if (conjunctions.has(token)) return hasProductEvidence(tokens.slice(index + 1).join(' ')) ? [{ index }] : []
    // Arabic waw may be attached to the next word or count: وبنطلون / و3.
    // It becomes a candidate boundary only; the evidence checks below decide it.
    if (token.startsWith('و') && token.length > 1) {
      const rightPrefix = token.slice(1)
      return hasProductEvidence([rightPrefix, ...tokens.slice(index + 1)].join(' ')) ? [{ index, rightPrefix }] : []
    }
    return []
  })
}

function clauseTokens(tokens: readonly string[], previous: ConjunctionBoundary | undefined,
  next: ConjunctionBoundary | undefined): string[] {
  const from = previous ? previous.index + 1 : 0
  const to = next?.index ?? tokens.length
  const clause = [...(previous?.rightPrefix ? [previous.rightPrefix] : []), ...tokens.slice(from, to)]
  return clause
}

function hasIndependentItemEvidence(tokens: readonly string[]): boolean {
  if (!tokens.length || tokens.some(token => unsafeScopeTokens.has(token))) return false
  const segment = segmentFromTokens(0, tokens)
  if (!segment.parseText || !hasProductEvidence(segment.parseText)) return false
  const parsed = parseVoiceSaleText(segment.parseText, segment.parserOptions)
  const productEvidence = parsed.attributes.productType.status !== 'missing'
    || parsed.sourceProductType?.status !== 'missing' || Boolean(parsed.productTypeCandidates?.length)
  const localAttribute = (['color', 'size', 'quantity', 'material', 'neckline', 'fit', 'pattern'] as const)
    .some(field => parsed.attributes[field].status !== 'missing')
    || Boolean(parsed.sourceColorId?.status && parsed.sourceColorId.status !== 'missing')
    || Boolean(parsed.sourceSizeId?.status && parsed.sourceSizeId.status !== 'missing')
  return productEvidence && localAttribute
}

function conjunctionSegments(tokens: readonly string[]): readonly VoiceSaleSegment[] | null {
  const boundaries = conjunctionBoundaries(tokens)
  if (!boundaries.length || boundaries.length > MAX_CONJUNCTION_BOUNDARIES
    || tokens.some(token => unsafeScopeTokens.has(token))) return null
  const memo = new Map<string, readonly ConjunctionBoundary[] | null>()
  const evidenceCache = new Map<string, boolean>()
  const evidence = (clause: readonly string[]) => {
    const key = clause.join(' ')
    if (!evidenceCache.has(key)) evidenceCache.set(key, hasIndependentItemEvidence(clause))
    return evidenceCache.get(key)!
  }
  const solve = (previous: ConjunctionBoundary | undefined, candidateIndex: number): readonly ConjunctionBoundary[] | null => {
    const key = `${previous?.index ?? -1}:${candidateIndex}`
    if (memo.has(key)) return memo.get(key)!
    let best: readonly ConjunctionBoundary[] | null = evidence(clauseTokens(tokens, previous, undefined)) ? [] : null
    for (let i = candidateIndex; i < boundaries.length; i++) {
      const boundary = boundaries[i]
      if (previous && boundary.index <= previous.index) continue
      const left = clauseTokens(tokens, previous, boundary)
      if (!evidence(left)) continue
      const tail = solve(boundary, i + 1)
      if (tail && (!best || tail.length + 1 > best.length)) best = [boundary, ...tail]
    }
    memo.set(key, best)
    return best
  }
  const selected = solve(undefined, 0)
  if (!selected?.length || selected.length + 1 > MAX_ITEMS) return null
  const clauses = selected.map((boundary, index) => clauseTokens(tokens, selected[index - 1], boundary))
  clauses.push(clauseTokens(tokens, selected.at(-1), undefined))
  if (clauses.some(clause => !evidence(clause))) return null
  return Object.freeze(clauses.map((clause, index) => segmentFromTokens(index, clause)))
}

/**
 * Split on repeated explicit request markers, or on conjunctions only when every
 * resulting clause independently identifies a product and owns a local attribute.
 */
export function segmentVoiceSaleText(text: string): VoiceSaleSegmentationResult {
  const normalizedText = typeof text === 'string' ? normalizeText(text) : ''
  const tokens = tokenizeText(normalizedText)
  if (!tokens.length) return Object.freeze({ status: 'single', normalizedText, segments: Object.freeze([]),
    reasons: Object.freeze([]), removedConversationalExpressions: Object.freeze([]) })
  const markers: { start: number; end: number }[] = []
  for (let index = 0; index < tokens.length;) {
    const length = markerLengthAt(tokens, index)
    if (length) { markers.push({ start: index, end: index + length }); index += length }
    else index++
  }
  if (markers.length < 2) {
    const segments = conjunctionSegments(tokens)
    if (!segments) return Object.freeze({ status: 'single', normalizedText,
      segments: Object.freeze([segmentFromTokens(0, tokens)]), reasons: Object.freeze([]),
      removedConversationalExpressions: Object.freeze([]) })
    const removed = segments.flatMap(segment => segment.removedConversationalExpressions)
    return Object.freeze({ status: 'segmented', normalizedText, segments,
      reasons: Object.freeze(['CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE']),
      removedConversationalExpressions: Object.freeze(removed) })
  }
  const clauses = markers.map((marker, index) => tokens.slice(index === 0 ? 0 : marker.start,
    markers[index + 1]?.start ?? tokens.length))
  if (clauses.length > MAX_ITEMS || clauses.some(clause => !clause.length)
    || clauses.some(clause => clause.some(token => unsafeScopeTokens.has(token)))) {
    return Object.freeze({ status: 'ambiguous', normalizedText, segments: Object.freeze([]),
      reasons: Object.freeze(['NEGATION_CORRECTION_OR_EMPTY_ITEM_SCOPE']), removedConversationalExpressions: Object.freeze([]) })
  }
  const segments = clauses.map((clause, index) => segmentFromTokens(index, clause))
  if (segments.some(segment => !segment.parseText || !hasProductEvidence(segment.parseText))) {
    return Object.freeze({ status: 'ambiguous', normalizedText, segments: Object.freeze([]),
      reasons: Object.freeze(['EXPLICIT_REQUEST_BOUNDARY_WITHOUT_PRODUCT_EVIDENCE']), removedConversationalExpressions: Object.freeze([]) })
  }
  const removed = segments.flatMap(segment => segment.removedConversationalExpressions)
  return Object.freeze({ status: 'segmented', normalizedText, segments: Object.freeze(segments),
    reasons: Object.freeze(['REPEATED_EXPLICIT_REQUEST_MARKERS']), removedConversationalExpressions: Object.freeze(removed) })
}
