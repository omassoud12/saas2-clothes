import { activeQuantities, activeProductTypes, activeColors, quantities, tokenizeText } from './index.js'
import { isSizeCue } from './size-context.js'
import type { ParsedSourceSizeMatch } from './size-source.types.js'
import type { ParseSpan } from './parser.types.js'
import type { ParsedQuantityIntent, QuantityEvidence, QuantityIntentKind, QuantityModifierId, QuantityUnitId } from './quantity-source.types.js'

const frozen = <T>(values: readonly T[]): readonly T[] => Object.freeze([...values])
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)]
const countLabels = new Set(['quantity', 'عدد', 'كمية', '3adad', 'count'])
const metadata = new Set(['price', 'cost', 'stock', 'sku', 'barcode', 'model', 'reference', 'ref', 'date', 'time', 'age',
  'discount', 'offer', 'promo', 'سعر', 'السعر', 'ب', 'بـ', 'مخزون', 'المخزون', 'باركود', 'كود', 'موديل', 'عمري', 'الساعة', 'خصم', 'عرض'])
const singularPiece = new Set(['piece', 'pc', 'pce', 'قطعة', 'حبة', 'حبه', 'habbe', '7abbe', 'واحدة'])
const legacyImplicitPiece = new Set(['kt3ten', 'قطعتين', 'قطعة'])
const safeModifierIds = new Set<QuantityModifierId>(['EXACT', 'ONLY', 'TOTAL', 'OF', 'COUNT_LABEL'])
// Read-only preview ceiling mirrors the existing POS contract, verified by a regression
// test. Keep this pure language module free of Prisma/application startup imports.
export const maxVoiceSaleQuantity = 1_000_000

/** Independent lexical intent analysis: does not query a catalog or execute instructions. */
export function parseQuantityIntent(text: string, sizes: readonly ParsedSourceSizeMatch[] = [],
  blockedNumbers: ReadonlySet<number> = new Set(), protectedSpans: readonly ParseSpan[] = [],
  contextualOrderCountSpans: readonly ParseSpan[] = []): ParsedQuantityIntent {
  const tokens = tokenizeText(text)
  const words = [...text.matchAll(/[\p{L}\p{M}\p{N}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]+/gu)].flatMap(match => tokenizeText(match[0])
    .map(token => ({ token, start: match.index!, end: match.index! + match[0].length })))
  const productSpans = activeProductTypes.matchTokens(text)
  const colorSpans = activeColors.matchTokens(text)
  const evidence: QuantityEvidence[] = [], bare: QuantityEvidence[] = []
  const claimed = new Set<number>()
  const reasons: string[] = []
  const modifiers: { readonly ids: readonly QuantityModifierId[]; readonly span: ParseSpan }[] = []
  const span = (start: number, end: number): ParseSpan => Object.freeze({ startToken: start, endToken: end,
    text: tokens.slice(start, end).join(' ') })
  const item = (start: number, end: number, value: number | null, units: readonly QuantityUnitId[], rule: string): QuantityEvidence => {
    const from = words[start]?.start ?? text.length, to = words[end - 1]?.end ?? from
    return Object.freeze({ span: span(start, end), originalSpan: Object.freeze({ start: from, end: to, text: text.slice(from, to) }),
      orderUnits: value, unitCandidates: frozen(unique(units)), rule })
  }
  const claim = (row: QuantityEvidence) => { evidence.push(row); for (let i = row.span.startToken; i < row.span.endToken; i++) claimed.add(i) }
  const overlap = (start: number, end: number) => sizes.some(s => s.startToken < end && s.endToken > start)
    || protectedSpans.some(s => s.startToken < end && s.endToken > start)
    || productSpans.some(s => s.startToken < end && s.endToken > start)
    || colorSpans.some(s => s.startToken < end && s.endToken > start)
  const knownUnits = (phrase: string): readonly QuantityUnitId[] => unique(activeQuantities.lookup('unit_aliases', phrase).map(row => row.unit_id))
  const isMetadata = (start: number, end: number): boolean => {
    const before = tokens.slice(Math.max(0, start - 2), start).filter((_, offset) => !sizes.some(size =>
      size.startToken <= Math.max(0, start - 2) + offset && size.endToken > Math.max(0, start - 2) + offset))
    const after = tokens.slice(end, end + 2)
    const from = words[start]?.start ?? 0, to = words[end - 1]?.end ?? from
    const context = text.slice(Math.max(0, from - 1), to + 2)
    return before.some(token => metadata.has(token) && (!['model', 'موديل', 'reference', 'ref'].includes(token)
      || /^\d/u.test(tokens[start]))) || after.some(token => ['stock', 'المخزون', 'متوفر', 'available'].includes(token))
      || /[$€£%٪]/u.test(context)
      || /\p{N}[:/]\p{N}/u.test(context)
      || /(?:\p{N}\s*\+\s*\p{N})/u.test(text.slice(Math.max(0, from - 3), to + 3))
  }
  const numeric = (phrase: string): number[] => {
    const rows = activeQuantities.lookup('number_aliases', phrase)
    if (rows.length) return unique(rows.map(row => row.value))
    const old = quantities.lookup(phrase)
    if (old.status === 'matched' && !/\s/u.test(phrase)) return [old.value]
    // Bounded explicit numeric grammar supplements source records; it is not a fabricated dictionary concept.
    return /^\d+$/u.test(phrase) ? [Number(phrase)] : []
  }
  // Original punctuation must survive guard checks even when the shared normalizer removes it.
  const malformed = new Set<number>(blockedNumbers)
  for (const match of text.matchAll(/(?:[+\p{Pd}−]\s*\p{N}+|\p{N}+(?:[.,٫٬/:]\p{N}+)+|\p{N}+\s*[\p{Pd}−+]\s*\p{N}+)/gu)) {
    const start = tokenizeText(text.slice(0, match.index)).length
    const end = start + tokenizeText(match[0]).length
    if (sizes.some(s => s.startToken <= start && s.endToken >= end)) continue
    for (let i = start; i < end; i++) malformed.add(i)
  }
  for (let start = 0; start < tokens.length;) {
    if (claimed.has(start) || overlap(start, start + 1) || isSizeCue(tokens[start - 1] ?? '')
      && !sizes.some(size => size.startToken <= start - 1 && size.endToken >= start)) { start++; continue }
    let found: QuantityEvidence | undefined
    for (let end = Math.min(tokens.length, start + activeQuantities.maxTokens + 2); end > start; end--) {
      if (overlap(start, end)) continue
      const phrase = tokens.slice(start, end).join(' ')
      const direct = activeQuantities.lookup('direct_phrases', phrase)
      const hasBlocked = tokens.slice(start, end).some((_, offset) => malformed.has(start + offset))
      if (direct.length && !hasBlocked) {
        const units = unique(direct.map(row => row.unit_id)), values = unique(direct.map(row => row.order_units))
        const raw = text.slice(words[start]?.start ?? 0, words[end - 1]?.end ?? 0)
        const descriptor = units.includes('PACK') && (/^\p{N}+\s*[\p{Pd}−]\s*pack$/iu.test(raw)
          || /^(?:pack of|pack de) \d+$/u.test(phrase)
          || /^\d+ pack$/u.test(phrase) && productSpans.some(product => product.startToken === end))
        found = item(start, end, descriptor ? null : values.length === 1 ? values[0] : null, units,
          descriptor ? 'product_pack_descriptor' : isMetadata(start, end) ? 'metadata_not_order' : 'source_direct_phrase')
        break
      }
      // Exact number phrase followed by an exact unit; longest phrase owns its entire span.
      for (let split = start + 1; split < end; split++) {
        const values = numeric(tokens.slice(start, split).join(' ')), units = knownUnits(tokens.slice(split, end).join(' '))
        if (!values.length || !units.length) continue
        const implicit = activeQuantities.lookup('unit_aliases', tokens.slice(split, end).join(' '))
          .some(row => row.match_policy === 'verify_phrase_for_implicit_number')
        found = item(start, end, values.length === 1 ? values[0] : null, units,
          hasBlocked ? 'invalid_numeric_syntax' : implicit ? 'contradictory_implicit_unit_count'
            : isMetadata(start, end) ? 'metadata_not_order' : 'number_unit_phrase')
        break
      }
      if (found) break
    }
    // Compact forms are constrained to digits + a complete known PIECE alias,
    // never a substring or a prefix of a SKU, age label or Arabizi word.
    if (!found && !overlap(start, start + 1)) {
      const compact = /^(\d+)(\p{L}[\p{L}\p{M}\p{N}]*)$/u.exec(tokens[start])
      if (compact && !numeric(tokens[start]).length && !activeQuantities.lookup('direct_phrases', tokens[start]).length
        && knownUnits(compact[2]).length === 1 && knownUnits(compact[2])[0] === 'PIECE') {
        const implicit = activeQuantities.lookup('unit_aliases', compact[2])
          .some(row => row.match_policy === 'verify_phrase_for_implicit_number')
        found = item(start, start + 1, Number(compact[1]), ['PIECE'],
          malformed.has(start) ? 'invalid_numeric_syntax' : implicit ? 'contradictory_implicit_unit_count'
            : isMetadata(start, start + 1) ? 'metadata_not_order' : 'compact_piece_phrase')
      }
    }
    if (!found && !overlap(start, start + 1)) {
      for (let end = Math.min(tokens.length, start + activeQuantities.maxTokens); end > start; end--) {
        if (overlap(start, end)) continue
        const phrase = tokens.slice(start, end).join(' '), values = numeric(phrase)
        if (!values.length) continue
        const label = countLabels.has(tokens[start - 1] ?? '')
        const legacy = legacyImplicitPiece.has(phrase)
        const contextual = contextualOrderCountSpans.some(candidate => candidate.startToken === start
          && candidate.endToken === end && candidate.text === phrase)
        // A bare digit remains unresolved unless an explicit count label/phrase exists,
        // or the conservative multi-item segmenter proved it directly modifies one product.
        const trusted = label || legacy || contextual
        const row = item(start, end, values.length === 1 ? values[0] : null, trusted ? ['PIECE'] : [],
          isMetadata(start, end) ? 'metadata_not_order'
            : tokens.slice(start, end).some((_, offset) => malformed.has(start + offset)) ? 'invalid_numeric_syntax'
              : trusted ? contextual ? 'segmented_product_count' : 'explicit_order_count' : 'bare_number_requires_context')
        if (trusted && row.rule === 'explicit_order_count') found = row
        else bare.push(row)
        break
      }
    }
    // Singular PIECE provides an explicit one-piece cue; containers/lengths do not.
    if (!found && singularPiece.has(tokens[start]) && !overlap(start, start + 1)
      && knownUnits(tokens[start]).includes('PIECE')) found = item(start, start + 1, 1, ['PIECE'],
        isMetadata(start, start + 1) ? 'metadata_not_order' : 'singular_piece_unit')
    if (!found && !overlap(start, start + 1)) {
      for (let end = Math.min(tokens.length, start + activeQuantities.maxTokens); end > start; end--) {
        if (overlap(start, end)) continue
        const units = knownUnits(tokens.slice(start, end).join(' '))
        if (!units.length || units.every(unit => unit === 'PIECE')) continue
        found = item(start, end, null, units, isMetadata(start, end) ? 'metadata_not_order' : 'unit_requires_count_and_catalog')
        break
      }
    }
    if (found) { claim(found); start = found.span.endToken } else start++
  }
  for (let start = 0; start < tokens.length;) {
    if (claimed.has(start) || overlap(start, start + 1)) { start++; continue }
    let found = false
    for (let end = Math.min(tokens.length, start + activeQuantities.maxTokens); end > start; end--) {
      if (overlap(start, end) || tokens.slice(start, end).some((_, offset) => claimed.has(start + offset))) continue
      const phrase = tokens.slice(start, end).join(' ')
      const rows = activeQuantities.lookup('modifier_aliases', phrase)
      if (!rows.length && phrase !== 'approx') continue
      let ids: QuantityModifierId[] = rows.length ? unique(rows.map(row => row.modifier_id)) : ['APPROX']
      // "من" is a connector unless a second number and range terminator establish a range.
      if (ids.includes('OF') && ids.includes('RANGE') && !tokens.slice(end).some(t => ['الى', 'to', 'ل'].includes(t))) ids = ['OF']
      modifiers.push(Object.freeze({ ids: frozen(ids), span: span(start, end) })); start = end; found = true; break
    }
    if (!found) start++
  }
  // An exact unit word may also be a modifier (e.g. تشكيلة). Preserve both
  // interpretations even though the unit scanner already owns that token span.
  for (const row of evidence.filter(row => row.rule === 'unit_requires_count_and_catalog')) {
    const ids = unique(activeQuantities.lookup('modifier_aliases', row.span.text).map(alias => alias.modifier_id))
    if (ids.length) modifiers.push(Object.freeze({ ids: frozen(ids), span: row.span }))
  }
  const nonOrder = new Set(['metadata_not_order', 'product_pack_descriptor'])
  const orderEvidence = evidence.filter(row => !nonOrder.has(row.rule))
  // Adjacent numeric hints immediately before an explicit count are competing
  // amounts ("one two pieces"), while remote brand/model words remain names.
  bare.filter(row => row.rule === 'bare_number_requires_context' && !/^\d+$/u.test(row.span.text) && orderEvidence.some(next =>
    next.span.startToken === row.span.endToken))
    .forEach(row => {
      const next = orderEvidence.find(next => next.span.startToken === row.span.endToken)!
      evidence.push(row.orderUnits === next.orderUnits
        ? item(row.span.startToken, row.span.endToken, row.orderUnits, next.unitCandidates, 'repeated_explicit_count') : row)
    })
  // Recognize but do not consume brand/model numbers or number words when an independently
  // explicit order amount already exists elsewhere in the sentence.
  if (!orderEvidence.length) evidence.push(...bare.filter(row => row.rule !== 'metadata_not_order'))
  const candidates = evidence.filter(row => !nonOrder.has(row.rule))
  const modifiersIds = unique(modifiers.flatMap(row => row.ids))
  let intent: QuantityIntentKind = 'order'
  if (modifiersIds.includes('APPROX')) intent = 'approx'
  if (modifiersIds.some(id => ['AT_LEAST', 'MORE_THAN'].includes(id))) intent = 'min'
  if (modifiersIds.some(id => ['AT_MOST', 'LESS_THAN'].includes(id))) intent = 'max'
  if (modifiersIds.includes('RANGE')) intent = 'range'
  if (modifiersIds.includes('ADD')) intent = 'add'
  if (modifiersIds.includes('REMOVE')) intent = 'remove'
  if (modifiersIds.some(id => ['EACH', 'PER_COLOR', 'PER_SIZE'].includes(id))) intent = 'allocation'
  if (modifiersIds.some(id => ['REMAINING', 'ALL_STOCK'].includes(id))) intent = 'inventory'
  const units = unique(candidates.flatMap(row => row.unitCandidates))
  const values = unique(candidates.map(row => row.orderUnits))
  const orderUnits = values.length === 1 ? values[0] : null
  const unitId = units.length === 1 ? units[0] : null
  const needsCatalogMetadata = units.some(unit => unit !== 'PIECE')
  const invalid = candidates.some(row => ['invalid_numeric_syntax', 'contradictory_implicit_unit_count'].includes(row.rule)
    || row.orderUnits !== null && (!Number.isSafeInteger(row.orderUnits) || row.orderUnits <= 0 || row.orderUnits > maxVoiceSaleQuantity)
      && row.unitCandidates.includes('PIECE'))
  const conflict = values.length > 1 || units.length > 1 && candidates.length > 1
    || modifiersIds.includes('EXACT') && modifiersIds.includes('APPROX')
    || modifiersIds.includes('ADD') && modifiersIds.includes('REMOVE')
    || modifiersIds.includes('AT_LEAST') && modifiersIds.includes('AT_MOST')
    || modifiersIds.some(id => ['AT_LEAST', 'MORE_THAN'].includes(id)) && modifiersIds.some(id => ['AT_MOST', 'LESS_THAN'].includes(id))
    || modifiersIds.includes('EXACT') && modifiersIds.some(id => ['AT_LEAST', 'AT_MOST', 'MORE_THAN', 'LESS_THAN', 'RANGE'].includes(id))
  const advisory = modifiersIds.some(id => !safeModifierIds.has(id)) || modifiers.some(row => row.ids.length > 1)
  const uncertain = candidates.some(row => row.rule === 'bare_number_requires_context') || !unitId || !orderUnits
  const status: ParsedQuantityIntent['status'] = invalid ? 'invalid' : conflict ? 'conflict' : advisory ? 'advisory'
    : !candidates.length ? 'missing' : needsCatalogMetadata || uncertain ? 'context_required' : 'resolved'
  if (invalid) reasons.push('Invalid or unsupported count/syntax; no standard POS quantity.')
  if (conflict) reasons.push('Contradictory counts, units or modifiers; no meaning selected.')
  if (advisory) reasons.push('Modifiers describe advisory intent; they are not an exact new sales line.')
  if (needsCatalogMetadata) reasons.push('Catalog has no verified packaging/measurement-to-sellable-SKU mapping.')
  if (uncertain && candidates.length) reasons.push('Explicit order unit/context required.')
  if (!candidates.length && !advisory) intent = 'not_quantity'
  else if (status === 'context_required' || status === 'invalid' || status === 'conflict') intent = 'needs_review'
  return Object.freeze({ status, intent, orderUnits: status === 'conflict' || intent === 'range' ? null : orderUnits,
    unitId, unitCandidates: frozen(units), resolvedPieces: status === 'resolved' && unitId === 'PIECE' ? orderUnits : null,
    needsCatalogMetadata, exactness: status === 'resolved' ? 'exact' : intent === 'approx' ? 'approximate'
      : ['min', 'max'].includes(intent) ? 'bounded' : intent === 'range' ? 'range' : 'unresolved',
    evidence: frozen([...evidence].sort((a, b) => a.span.startToken - b.span.startToken)), modifiers: frozen(modifiers), reasons: frozen(reasons) })
}
