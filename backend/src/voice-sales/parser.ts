import {
  dictionaries, decomposeQualifiedProductAlias, expressions, lookupVocabulary, matchVocabularyTokens, normalizeText,
  productTypes, activeProductTypes, activeColors, activeSizes, sizes, quantities, tokenizeText,
} from './index.js'
import type { AnyKnownResult, DictionaryDomain, DomainValues, KnownResult } from './dictionary.types.js'
import type { ParsedSourceProductMatch } from './product-type-source.types.js'
import type { SourceProductTypeId } from './product-type-source-ids.js'
import type { SourceColorId } from './color-source-ids.js'
import type { ParsedSourceColorMatch } from './color-source.types.js'
import type { SourceSizeId } from './size-source-ids.js'
import type { ParsedSourceSizeMatch } from './size-source.types.js'
import { scanSourceSizes } from './size-parser.js'
import { isSizeCue, inferSizeContext } from './size-context.js'
import { parseQuantityIntent } from './quantity-parser.js'
import type { ParsedQuantityIntent } from './quantity-source.types.js'
import { scanSourceMaterials, scanMaterialComposition, materialCues } from './material-parser.js'
import type { ParsedMaterialMatch, MaterialCompositionRequest } from './material-source.types.js'
import type { SourceMaterialId } from './material-source-ids.js'
import { scanSourceNecklines, necklineCues } from './neckline-parser.js'
import { necklineSourceResource } from './neckline-source.js'
import type { ParsedNecklineMatch } from './neckline-source.types.js'
import type { SourceNecklineShapeId, SourceCollarTypeId } from './neckline-source-ids.js'
import { scanCommonExpressions, expressionSafety, requestConversationTokens } from './common-expression-parser.js'
import type { CommonExpressionCue } from './common-expression.types.js'
import { scanRequestIntents } from './request-intent.js'
import type { RequestIntentMatch } from './request-intent.js'
import { scanFitCuts, fitCutAttributes, fitCutCues } from './fit-cut-parser.js'
import { fitCutConcept, fitCutSource } from './fit-cut-source.js'
import type { ParsedFitCutMatch } from './fit-cut.types.js'
import { scanPatterns, patternAttribute, patternCues, isPlainPhrase } from './pattern-parser.js'
import { patternSource } from './pattern-source.js'
import type { ParsedPatternMatch } from './pattern.types.js'
import type {
  AttributeName, ParseAlternative, ParseEvidence, ParseIssue, ParseSpan, ParsedAttribute,
  ParsedAttributes, ResidualToken, VoiceSaleAttributes, VoiceSaleParseResult, VoiceSaleParserOptions,
} from './parser.types.js'

export const MAX_VOICE_SALE_TEXT_LENGTH = 4096
const fieldForDomain = {
  productTypes: 'productType', colors: 'color', sizes: 'size', quantities: 'quantity',
  materials: 'material', necklines: 'neckline', fits: 'fit', patterns: 'pattern',
} as const
type AttributeDomain = keyof typeof fieldForDomain
const fields = Object.values(fieldForDomain)
const coreFields: readonly AttributeName[] = ['productType', 'color', 'size', 'quantity']
const unitWords = new Set(['piece', 'pieces', 'قطعة', 'قطع'])
const coordinators = new Set(['and', 'و', 'w'])
// These are grammar markers, not a second clothing vocabulary.
const grammarMarkers: Readonly<Record<string, AttributeDomain>> = {
  material: 'materials', fabric: 'materials', قماش: 'materials', خامة: 'materials',
  collar: 'necklines', neckline: 'necklines', قبة: 'necklines', '2abbe': 'necklines',
  pattern: 'patterns', نقشة: 'patterns', fit: 'fits', قصة: 'fits',
  product: 'productTypes', منتج: 'productTypes',
}
const expressionMarkers = {
  SIZE_MARKER: 'sizes', COLOR_MARKER: 'colors', QUANTITY_MARKER: 'quantities',
} as const
const unsupportedOperators = new Set(['not', 'no', 'مش', 'ما', 'بلا', 'بدون', 'دون', 'or', 'او'])

interface Observation {
  readonly candidates: readonly VoiceSaleAttributes[AttributeName][]
  readonly unresolved: boolean
  readonly evidence: ParseEvidence
}
type Observations = Record<AttributeName, Observation[]>

function valuesOf<D extends DictionaryDomain>(hit: KnownResult<D>): readonly DomainValues[D][] {
  return hit.status === 'matched' ? [hit.value] : hit.candidates
}

/** Pure lexical parser. This result is never a checkout payload or a catalog identity. */
export function parseVoiceSaleText(text: string, options: VoiceSaleParserOptions = {}): VoiceSaleParseResult {
  const originalText = typeof text === 'string' ? text : null
  const invalid = originalText === null || originalText.length > MAX_VOICE_SALE_TEXT_LENGTH
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(originalText)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(originalText)
  const normalizedText = invalid ? '' : normalizeText(originalText)
  const tokens = tokenizeText(normalizedText)
  const literalProductNameSpans = (options.literalProductNameSpans ?? []).filter(candidate =>
    Number.isSafeInteger(candidate.startToken) && Number.isSafeInteger(candidate.endToken)
      && candidate.startToken >= 0 && candidate.endToken > candidate.startToken && candidate.endToken <= tokens.length)
  const literalProductNameAt = new Map(literalProductNameSpans.map(candidate => [candidate.startToken, candidate]))
  const isLiteralProductName = (startToken: number, endToken: number) => literalProductNameSpans.some(candidate =>
    candidate.startToken <= startToken && candidate.endToken >= endToken)
  const observations: Observations = {
    productType: [], color: [], size: [], quantity: [], material: [], neckline: [], fit: [], pattern: [],
  }
  const consumed = new Set<number>()
  const notNames = new Set<number>()
  const conversational = new Set<number>()
  const blockedNumbers = new Set<number>()
  const issues: ParseIssue[] = []
  let quantityIntent: ParsedQuantityIntent | undefined
  let disableQuantity = false
  let productTypeCandidates: readonly ParsedSourceProductMatch[] = []
  const sourceUsed = new Set<number>()
  const colorCandidates: ParsedSourceColorMatch[] = []
  const colorExplicitPositions = new Set<number>()
  const scannedSizes = invalid ? [] : scanSourceSizes(originalText!)
  const sourceSizeCandidates: ParsedSourceSizeMatch[] = []
  let materialCandidates: readonly ParsedMaterialMatch[] = []
  let materialComposition: readonly MaterialCompositionRequest[] = []
  let necklineCandidates: readonly ParsedNecklineMatch[] = []
  let commonExpressionMatches: readonly CommonExpressionCue[] = []
  let requestIntents: readonly RequestIntentMatch[] = []
  let fitCutCandidates: readonly ParsedFitCutMatch[] = []
  let patternCandidates: readonly ParsedPatternMatch[] = []
  const span = (startToken: number, endToken: number): ParseSpan => Object.freeze({
    startToken, endToken, text: tokens.slice(startToken, endToken).join(' '),
  })
  const consume = (s: ParseSpan) => {
    for (let i = s.startToken; i < s.endToken; i++) consumed.add(i)
  }
  const issue = (kind: ParseIssue['kind'], s: ParseSpan, message: string,
    affected: readonly AttributeName[] = [], alternatives: readonly ParseAlternative[] = []) => {
    issues.push(Object.freeze({ kind, span: s, message,
      fields: Object.freeze([...affected]),
      alternatives: Object.freeze(alternatives.map(alternative => Object.freeze({ ...alternative }))),
    }))
  }
  const add = (field: AttributeName, candidates: readonly VoiceSaleAttributes[AttributeName][],
    s: ParseSpan, unresolved: boolean, source: ParseEvidence['source'], rule: string) => {
    observations[field].push({ candidates: [...candidates], unresolved,
      evidence: Object.freeze({ span: s, source, rule }) })
  }
  const addHit = (hit: AnyKnownResult, s: ParseSpan, source: ParseEvidence['source'], rule: string,
    resolveContext = false) => {
    if (hit.domain === 'expressions') return
    const candidates = valuesOf(hit)
    add(fieldForDomain[hit.domain], candidates, s,
      hit.status !== 'matched' && !(resolveContext && hit.status === 'ambiguous' && candidates.length === 1),
      source, rule)
  }
  const finalize = (forcedStatus?: VoiceSaleParseResult['status']): VoiceSaleParseResult => {
    const sourcePatternId=patternAttribute(patternCandidates)
    const patternModifierSlots=new Map<string,Set<string>>()
    for(const row of patternCandidates.filter(r=>r.constrainsCatalog&&r.result.modifiers.length===1)){
      const id=row.result.modifiers[0],slot=`${patternSource.modifiers.find(m=>m.modifier_id===id)!.slot}@${row.modifierTarget?.startToken}`
      const values=patternModifierSlots.get(slot)??new Set<string>();values.add(id);patternModifierSlots.set(slot,values)
    }
    for(const [slot,values] of patternModifierSlots)if(!slot.startsWith('placement@')&&values.size>1)issue('conflicting_attribute',span(0,tokens.length),`Conflicting pattern modifiers in ${slot} require clarification.`,['pattern'])
    const commonExpressionSafety = expressionSafety(commonExpressionMatches, requestIntents)
    const sourceFitCuts = fitCutAttributes(fitCutCandidates)
    for (const [axis, attribute] of Object.entries(sourceFitCuts)) if (attribute.status === 'conflict') {
      issue('conflicting_attribute', span(0,tokens.length), `Different explicit cuts in axis ${axis} require clarification.`, ['fit'])
    }
    const fitModifierSlots = new Map<string,Set<string>>()
    for (const row of fitCutCandidates.filter(r=>r.constrainsCatalog&&r.result.modifiers.length===1)) {
      const id=row.result.modifiers[0],slot=`${fitCutSource.modifiers.find(m=>m.modifier_id===id)!.slot}@${row.modifierTarget?.startToken}`
      const values=fitModifierSlots.get(slot)??new Set<string>();values.add(id);fitModifierSlots.set(slot,values)
    }
    for (const [slot, values] of fitModifierSlots) if (!slot.startsWith('target_area@') && values.size>1) issue('conflicting_attribute',span(0,tokens.length),
      `Conflicting fit/cut modifiers in ${slot} require clarification.`,['fit'])
    const neckAttribute = <T extends SourceNecklineShapeId | SourceCollarTypeId>(key: 'shapes' | 'collars'): ParsedAttribute<T> => {
      const rows = necklineCandidates.filter(row => row.result[key].length)
      const ids = [...new Set(rows.flatMap(row => row.result[key]))] as T[]
      const definite = rows.filter(row => row.constrainsCatalog && row.result[key].length === 1
        && row.result.shapes.length + row.result.collars.length + row.result.modifiers.length === 1)
      const conflict = definite.length > 1 && new Set(definite.flatMap(row => row.result[key])).size > 1
      const ambiguous = rows.some(row => !row.constrainsCatalog
        || row.result.shapes.length + row.result.collars.length + row.result.modifiers.length > 1)
      const status = !rows.length ? 'missing' : conflict ? 'conflict' : ambiguous ? 'ambiguous' : 'resolved'
      if (conflict) issue('conflicting_attribute', span(0, tokens.length), `Different ${key === 'shapes' ? 'neckline shapes' : 'collar types'} were supplied.`, ['neckline'])
      return Object.freeze({ status, value: status === 'resolved' ? ids[0] : null, candidates: Object.freeze(ids),
        source: status === 'resolved' ? 'explicit' : null,
        evidence: Object.freeze(rows.map(row => Object.freeze({ span: span(row.startToken, row.endToken), source: 'explicit' as const, rule: 'source_neckline_alias' }))) })
    }
    const sourceNecklineShape = neckAttribute<SourceNecklineShapeId>('shapes')
    const sourceCollarType = neckAttribute<SourceCollarTypeId>('collars')
    const modifierSlots = new Map<string, Set<string>>()
    for (const row of necklineCandidates.filter(r => r.constrainsCatalog && r.result.modifiers.length === 1
      && !r.result.shapes.length && !r.result.collars.length)) {
      const id = row.result.modifiers[0], slot = necklineSourceResource.modifiers.find(m => m.modifier_id === id)!.slot
      const values = modifierSlots.get(slot) ?? new Set<string>(); values.add(id); modifierSlots.set(slot, values)
    }
    for (const [slot, values] of modifierSlots) if (values.size > 1) issue('conflicting_attribute', span(0, tokens.length),
      `Different explicit neckline modifiers in slot ${slot} require clarification.`, ['neckline'])
    if (quantityIntent && !disableQuantity) {
      // Reconcile through one intent layer rather than trusting an old bare-word
      // mapping or a container's physical piece count as a stock quantity.
      observations.quantity = []
      if (quantityIntent.status === 'resolved') {
        const s = quantityIntent.evidence.find(row => row.rule !== 'metadata_not_order')!.span
        add('quantity', [quantityIntent.resolvedPieces!], s, false, 'explicit', 'verified_quantity_intent')
      }
      if (quantityIntent.status === 'conflict') for (const row of quantityIntent.evidence) {
        if (row.orderUnits !== null && row.unitCandidates.every(id => id === 'PIECE')) {
          add('quantity', [row.orderUnits], row.span, false, 'explicit', 'conflicting_quantity_intent')
        }
      }
      if (!['missing', 'resolved'].includes(quantityIntent.status)) {
        const s = quantityIntent.evidence.find(row => row.rule !== 'metadata_not_order')?.span
          ?? quantityIntent.modifiers[0]?.span ?? span(0, tokens.length)
        issue(quantityIntent.status === 'conflict' ? 'conflicting_attribute' : 'unsupported_value', s,
          quantityIntent.reasons.join(' '), ['quantity'])
      }
      if (quantityIntent.evidence.some(row => row.rule === 'metadata_not_order')) {
        issue('unsupported_value', quantityIntent.evidence.find(row => row.rule === 'metadata_not_order')!.span,
          'Stock, price or identifier amounts are metadata; an order amount must be explicit.', ['quantity'])
      }
    }
    const attribute = <F extends AttributeName>(field: F): ParsedAttribute<VoiceSaleAttributes[F]> => {
      const all = observations[field]
      // Only this fixed domain-to-field mapping populates observations.
      const candidates = [...new Set(all.flatMap(row => row.candidates))] as VoiceSaleAttributes[F][]
      const explicitValues = new Set(all.filter(row => !row.unresolved).flatMap(row => row.candidates))
      const status = field === 'quantity' && !disableQuantity && quantityIntent?.status === 'conflict' ? 'conflict'
        : !all.length ? 'missing' : explicitValues.size > 1 ? 'conflict'
        : all.some(row => row.unresolved) ? 'ambiguous' : 'resolved'
      if (status === 'conflict') {
        const first = all[0]?.evidence.span ?? span(0, tokens.length)
        const last = all[all.length - 1]?.evidence.span ?? first
        issue('conflicting_attribute', span(first.startToken, last.endToken),
          `Different ${field} values were supplied.`, [field], candidates.map(value => ({ field, value })))
      }
      const sources = new Set(all.map(row => row.evidence.source))
      return Object.freeze({ status, value: status === 'resolved' ? candidates[0] : null,
        candidates: Object.freeze(candidates),
        source: !all.length || status !== 'resolved' ? null : sources.size > 1 ? 'mixed' : all[0].evidence.source,
        evidence: Object.freeze(all.map(row => row.evidence)),
      })
    }
    const attributes: ParsedAttributes = Object.freeze({
      productType: attribute('productType'), color: attribute('color'), size: attribute('size'),
      quantity: attribute('quantity'), material: attribute('material'), neckline: attribute('neckline'),
      fit: attribute('fit'), pattern: attribute('pattern'),
    })
    const materialIds = [...new Set(materialCandidates.flatMap(row => row.result.fabrics))]
    const materialStatus = !materialIds.length ? 'missing' : materialCandidates.some(row => row.result.fabrics.length
      && (!row.constrainsCatalog || row.result.fabrics.length > 1 || row.result.modifiers.length > 0
        || row.result.records.some(r => r.reasons.includes('Source entry needs review/context.')))) ? 'ambiguous'
      : materialIds.length > 1 ? 'ambiguous' : 'resolved'
    const sourceMaterial: ParsedAttribute<SourceMaterialId> = Object.freeze({ status: materialStatus,
      value: materialStatus === 'resolved' ? materialIds[0] : null, candidates: Object.freeze(materialIds),
      source: materialStatus === 'resolved' ? 'explicit' : null,
      evidence: Object.freeze(materialCandidates.filter(row => row.result.fabrics.length).map(row => Object.freeze({
        span: span(row.startToken, row.endToken), source: 'explicit' as const, rule: 'source_material_alias',
      }))),
    })
    const used = productTypeCandidates.filter(match => sourceUsed.has(match.startToken)
      || observations.productType.some(row => row.evidence.span.startToken <= match.startToken
        && row.evidence.span.endToken >= match.endToken))
    const sourceIds = [...new Set(used.flatMap(match => match.result.candidates.map(row => row.sourceTypeId)))]
    const sourceAmbiguous = used.some(match => match.result.status !== 'candidate'
      && !(match.result.candidates.length === 1 && observations.productType.some(row => !row.unresolved
        && row.evidence.span.startToken <= match.startToken && row.evidence.span.endToken >= match.endToken)))
      || attributes.productType.status === 'ambiguous'
    const sourceProductType: ParsedAttribute<SourceProductTypeId> = Object.freeze({
      status: !used.length ? 'missing' : sourceAmbiguous ? 'ambiguous' : sourceIds.length > 1 ? 'conflict' : 'resolved',
      value: used.length && !sourceAmbiguous && sourceIds.length === 1 ? sourceIds[0] : null,
      candidates: Object.freeze(sourceIds), source: used.length && !sourceAmbiguous && sourceIds.length === 1 ? 'explicit' : null,
      evidence: Object.freeze(used.map(match => Object.freeze({ span: span(match.startToken, match.endToken),
        source: 'explicit' as const, rule: 'active_source_alias' }))),
    })
    const colorIds = [...new Set(colorCandidates.flatMap(match => match.result.candidates))]
    const definiteColors = [...new Set(colorCandidates.filter(match => match.result.status === 'matched'
      || match.colorDomainExplicit && match.result.status === 'ambiguous' && match.result.candidates.length === 1)
      .flatMap(match => match.result.candidates))]
    const colorStatus = !colorCandidates.length ? 'missing' : definiteColors.length > 1 ? 'conflict'
      : colorCandidates.some(match => match.result.status !== 'matched'
        && !(match.colorDomainExplicit && match.result.status === 'ambiguous' && match.result.candidates.length === 1)) ? 'ambiguous' : 'resolved'
    const sourceColorId: ParsedAttribute<SourceColorId> = Object.freeze({ status: colorStatus,
      value: colorStatus === 'resolved' ? colorIds[0] : null, candidates: Object.freeze(colorIds),
      source: colorStatus === 'resolved' ? 'explicit' : null,
      evidence: Object.freeze(colorCandidates.map(match => Object.freeze({ span: span(match.startToken, match.endToken),
        source: 'explicit' as const, rule: match.colorDomainExplicit ? 'colors_marker' : 'active_color_alias' }))),
    })
    if (colorStatus === 'conflict' && attributes.color.status !== 'conflict') issue('conflicting_attribute', span(0, tokens.length),
      `Different source color shades were supplied: ${definiteColors.join(', ')}.`, ['color'])
    const sizeIds = [...new Set(sourceSizeCandidates.flatMap(match => match.candidates))]
    const disjointSizes = sourceSizeCandidates.length > 1 && !sourceSizeCandidates[0].candidates.some(id =>
      sourceSizeCandidates.every(match => match.candidates.includes(id)))
    const sizeStatus = !sourceSizeCandidates.length ? 'missing' : disjointSizes ? 'conflict'
      : sourceSizeCandidates.some(match => match.resolvedId === null) ? 'ambiguous' : 'resolved'
    const sourceSizeId: ParsedAttribute<SourceSizeId> = Object.freeze({ status: sizeStatus,
      value: sizeStatus === 'resolved' ? sizeIds[0] : null, candidates: Object.freeze(sizeIds),
      source: sizeStatus === 'resolved' ? 'explicit' : null,
      evidence: Object.freeze(sourceSizeCandidates.map(match => Object.freeze({ span: span(match.startToken, match.endToken),
        source: 'explicit' as const, rule: 'source_size_expression' }))),
    })
    if (sizeStatus === 'conflict' && attributes.size.status !== 'conflict') issue('conflicting_attribute', span(0, tokens.length),
      'Different explicit size labels were supplied.', ['size'])
    const residual: ResidualToken[] = tokens.flatMap((token, index) =>
      consumed.has(index) ? [] : [Object.freeze({ token, index })])
    const missingInformation = fields.filter(field => attributes[field].status === 'missing'
      && !(field === 'productType' && sourceProductType.status !== 'missing')
      && !(field === 'color' && sourceColorId.status !== 'missing')
      && !(field === 'size' && sourceSizeId.status !== 'missing'))
    const unresolvedInformation = fields.filter(field => ['ambiguous', 'conflict'].includes(attributes[field].status)
      || field === 'color' && ['ambiguous', 'conflict'].includes(sourceColorId.status)
      || field === 'size' && ['ambiguous', 'conflict'].includes(sourceSizeId.status)
      || issues.some(row => row.fields.includes(field)))
    if (materialStatus === 'ambiguous' && !unresolvedInformation.includes('material')) unresolvedInformation.push('material')
    if(patternCandidates.some(p=>p.role==='descriptor'||p.role==='modifier')&&missingInformation.includes('pattern'))missingInformation.splice(missingInformation.indexOf('pattern'),1)
    if((sourcePatternId.status==='ambiguous'||patternCandidates.some(p=>p.role==='modifier'&&!p.constrainsCatalog))&&!unresolvedInformation.includes('pattern'))unresolvedInformation.push('pattern')
    if (necklineCandidates.length && missingInformation.includes('neckline')) missingInformation.splice(missingInformation.indexOf('neckline'), 1)
    if (necklineCandidates.some(r => !r.constrainsCatalog || r.result.shapes.length + r.result.collars.length + r.result.modifiers.length > 1)
      && !unresolvedInformation.includes('neckline')) unresolvedInformation.push('neckline')
    if ((materialIds.length || materialCandidates.some(row => row.result.modifiers.length)) && missingInformation.includes('material')) {
      missingInformation.splice(missingInformation.indexOf('material'), 1)
    }
    const status = forcedStatus ?? (issues.some(row => row.kind === 'multiple_items') ? 'unsupported_multiple_items'
      : !commonExpressionSafety.salePreviewAllowed ? 'needs_clarification'
      : issues.length ? 'needs_clarification'
      : coreFields.some(field => missingInformation.includes(field)) ? 'incomplete' : 'parsed')
    return Object.freeze({ status, originalText, normalizedText, attributes, sourceProductType, sourceColorId, sourceSizeId,
      commonExpressionMatches, commonExpressionSafety, requestIntents, sourceFitCuts, fitCutCandidates, sourcePatternId, patternCandidates,
      ...(!disableQuantity && quantityIntent ? { quantityIntent } : {}),
      sourceMaterial, materialCandidates, materialComposition,
      sourceNecklineShape, sourceCollarType, necklineCandidates,
      sourceSizeCandidates: Object.freeze(sourceSizeCandidates),
      colorCandidates: Object.freeze(colorCandidates),
      productTypeCandidates: Object.freeze(used),
      productNameResidualTokens: Object.freeze(residual.filter(row => !notNames.has(row.index))),
      unrecognizedTokens: Object.freeze(residual),
      conversationalTokens: Object.freeze([...conversational].sort((a, b) => a - b)
        .map(index => Object.freeze({ token: tokens[index], index }))),
      ambiguities: Object.freeze([...issues]), missingInformation: Object.freeze(missingInformation),
      unresolvedInformation: Object.freeze(unresolvedInformation),
    })
  }

  if (invalid || !tokens.length) {
    issue('invalid_input', span(0, tokens.length), 'Expected nonempty text within the input limit, without malformed Unicode or control characters.')
    return finalize('invalid_input')
  }

  // Normalization discards punctuation. Block signed/decimal/range expressions BEFORE
  // lexical extraction so "1.5 pieces" can never accidentally become quantity 5.
  const numericSource = originalText!.normalize('NFKC')
  const numericSyntax = /\p{N}+\s*[\p{Pd}−]\s*\p{N}+|[+\p{Pd}−]?\p{N}+(?:[.,٫٬]\p{N}+)+|[+\p{Pd}−]\s*\p{N}+/gu
  for (const match of numericSource.matchAll(numericSyntax)) {
    const start = tokenizeText(numericSource.slice(0, match.index)).length
    const end = start + tokenizeText(match[0]).length
    if (scannedSizes.some(size => size.startToken <= start && size.endToken >= end
      && size.resolvedId !== null
      && originalText!.slice(0, size.originalSpan.start).normalize('NFKC').length <= match.index!
      && originalText!.slice(0, size.originalSpan.end).normalize('NFKC').length >= match.index! + match[0].length)) continue
    for (let i = start; i < end; i++) { blockedNumbers.add(i); notNames.add(i) }
    issue('unresolved_number', span(start, end), 'Signed, decimal, grouped or ranged numbers need clarification.', ['size', 'quantity'])
  }
  const lexemes = matchVocabularyTokens(normalizedText)
  const at = new Map(lexemes.map(lexeme => [lexeme.startToken, lexeme]))
  const overlapsBlocked = (s: ParseSpan) => {
    for (let i = s.startToken; i < s.endToken; i++) if (blockedNumbers.has(i)) return true
    return false
  }
  patternCandidates=scanPatterns(originalText!)
  const patternOwns=(s:{startToken:number;endToken:number})=>patternCandidates.some(p=>p.polarity==='affirmative'
    && (p.role==='descriptor'||p.role==='literal_name'||p.role==='modifier')&&p.startToken<=s.startToken&&p.endToken>=s.endToken)
  const patternAt=new Map(patternCandidates.filter(p=>p.polarity==='affirmative'&&!['literal_name','owned_by_other'].includes(p.role)).map(p=>[p.startToken,p]))
  const scannedMaterials = scanSourceMaterials(originalText!).filter(row=>!patternOwns(row))
  const scannedNecklines = scanSourceNecklines(originalText!).filter(row=>!patternOwns(row))
  fitCutCandidates = scanFitCuts(originalText!).filter(row=>!patternOwns(row))
  const fitAt = new Map(fitCutCandidates.filter(r=>r.polarity==='affirmative'
    && !['literal_name','owned_by_other'].includes(r.role)).map(r=>[r.startToken,r]))
  const neckAt = new Map(scannedNecklines.filter(row => row.constrainsCatalog).map(row => [row.startToken, row]))
  const materialAt = new Map(scannedMaterials.filter(row => row.constrainsCatalog).map(row => [row.startToken, row]))
  // Numeric construction descriptors (e.g. 4-way stretch) are not requested stock counts.
  const quantityBlocked = new Set(blockedNumbers)
  for(const row of patternCandidates.filter(p=>p.role==='descriptor'||p.role==='modifier'))for(let i=row.startToken;i<row.endToken;i++)quantityBlocked.add(i)
  for (const row of fitCutCandidates.filter(r=>r.result.styles.length)) {
    for (let index=row.startToken;index<row.endToken;index++) quantityBlocked.add(index)
  }
  for (const row of scannedMaterials.filter(row => row.constrainsCatalog)) {
    for (let index = row.startToken; index < row.endToken; index++) quantityBlocked.add(index)
  }
  const rawProductLexemes = activeProductTypes.matchTokens(normalizedText)
  const preliminaryRequestIntents = scanRequestIntents(normalizedText, { itemIndex: options.itemIndex })
  const requestSpanOverlap = (startToken: number, endToken: number) => preliminaryRequestIntents.some(request =>
    request.sourceSpan.startToken < endToken && request.sourceSpan.endToken > startToken)
  const hasRequestProductContext = rawProductLexemes.some(match =>
    match.result.candidates.length > 0 && !requestSpanOverlap(match.startToken, match.endToken))
  requestIntents = scanRequestIntents(normalizedText, { hasProductContext: hasRequestProductContext,
    itemIndex: options.itemIndex })
  // A clause-initial request verb is language metadata. It must not turn an
  // otherwise explicit piece count into a quantity-change command.
  for (const request of requestIntents) if (request.certainty === 'exact') {
    for (let index = request.sourceSpan.startToken; index < request.sourceSpan.endToken; index++) quantityBlocked.add(index)
  }
  quantityIntent = parseQuantityIntent(originalText!, scannedSizes, quantityBlocked,
    [...scannedMaterials, ...scannedNecklines, ...fitCutCandidates, ...patternCandidates].filter(row => row.constrainsCatalog),
    options.contextualOrderCountSpans)
  const quantityAt = new Map(quantityIntent.evidence.filter(row => !['bare_number_requires_context', 'metadata_not_order'].includes(row.rule))
    .map(row => [row.span.startToken, row]))

  const activeLexemes = rawProductLexemes.filter(match => {
    const grammar = expressions.lookup(match.phrase)
    return !isLiteralProductName(match.startToken, match.endToken)
      && !(grammar.status === 'matched' && grammar.value === 'WANT')
  })
  const colorLexemes = activeColors.matchTokens(normalizedText)
  const exactQuantitySpans = quantityIntent.modifiers.filter(row => quantityIntent!.status === 'resolved' && row.ids.every(id => id === 'EXACT')
    && quantityIntent!.evidence.some(e => e.span.startToken === row.span.endToken || e.span.endToken === row.span.startToken))
    .map(row => row.span)
  const protectedExpressionSpans = [...activeLexemes, ...colorLexemes, ...scannedSizes,
    ...scannedMaterials.filter(row => row.constrainsCatalog), ...scannedNecklines.filter(row => row.constrainsCatalog),
    ...fitCutCandidates.filter(row=>row.constrainsCatalog),
    ...patternCandidates.filter(row=>row.constrainsCatalog||row.role==='modifier'),
    ...lexemes.filter(row => row.result.hits.some(hit => hit.domain !== 'expressions')),
    // "Exactly two pieces" is an explicit count qualifier; "exactly" alone is
    // an advisory confirmation. Preserve both lexical identities without checkout authority.
    ...exactQuantitySpans]
  commonExpressionMatches = scanCommonExpressions(normalizedText, protectedExpressionSpans)
  const conversationIndexes = requestConversationTokens(commonExpressionMatches, [...protectedExpressionSpans,
    ...quantityIntent.evidence.map(row => row.span), ...quantityIntent.modifiers.map(row => row.span)], requestIntents)
  for (const index of conversationIndexes) { consumed.add(index); conversational.add(index) }
  for (const s of exactQuantitySpans) consume(s)
  const literalExpressionIndexes = new Set(commonExpressionMatches.filter(cue => cue.role === 'literal_name')
    .flatMap(cue => Array.from({ length: cue.span.endToken - cue.span.startToken }, (_, i) => cue.span.startToken + i)))
  const colorAt = new Map(colorLexemes.map(match => [match.startToken, match]))
  const operator = tokens.findIndex((token, index) => {
    if(patternCandidates.some(p=>isPlainPhrase(p)&&p.startToken<=index&&p.endToken>index))return false
    // Only a recognized whole qualified phrase can own lexical negation (collarless,
    // unfolded, sleeveless). An independent 'not V-neck' still blocks all affirmation.
    if (scannedNecklines.some(match => match.constrainsCatalog && match.startToken <= index && match.endToken > index
      && match.endToken - match.startToken > 1)) return false
    if (fitCutCandidates.some(match=>match.polarity==='affirmative'&&match.constrainsCatalog
      &&match.startToken<=index&&match.endToken>index&&match.endToken-match.startToken>1)) return false
    if (quantityIntent?.modifiers.some(row => row.span.startToken <= index && row.span.endToken > index
      && row.ids.every(id => ['AT_LEAST', 'AT_MOST'].includes(id)))) return false
    // Negation inside an exact garment name (No Show Socks / strapless phrases)
    // is lexical vocabulary; negation outside that phrase still blocks affirmation.
    if (activeLexemes.some(match => match.startToken <= index && match.endToken > index
      && match.endToken - match.startToken > 1)) return false
    if (colorLexemes.some(match => match.startToken <= index && match.endToken > index
      && match.endToken - match.startToken > 1)) return false
    if (scannedMaterials.some(match => match.constrainsCatalog && match.startToken <= index && match.endToken > index
      && match.endToken - match.startToken > 1 && match.result.modifiers.length > 0 && !match.result.fabrics.length)) return false
    if (commonExpressionMatches.some(cue => cue.role === 'intent' && cue.span.startToken <= index && cue.span.endToken > index
      && cue.candidates.every(id => ['CHANGE_KEEP_ORDER', 'REJ_NOT_SIZE', 'REJ_NOT_COLOR'].includes(id)))) return false
    if (token === 'or' && colorAt.has(index)) {
      const marker = lexemes.find(match => match.endToken === index && match.result.hits.some(hit =>
        hit.domain === 'expressions' && hit.status === 'matched' && hit.value === 'COLOR_MARKER'))
      if (marker) return false
    }
    if (unsupportedOperators.has(token)) return true
    const hit = expressions.lookup(token)
    return hit.status === 'matched' && hit.value === 'CANCEL'
  })
  if (operator !== -1) {
    disableQuantity = true
    issue('unsupported_structure', span(operator, operator + 1),
      'Negation, alternatives and cancellation are not affirmative single-item requests in this MVP.')
    // Do not affirm attributes, but still report obvious multi-product input.
    const mentions = lexemes.flatMap(lexeme => {
      const hit = lexeme.result.hits[0]
      return lexeme.result.hits.length === 1 && hit.domain === 'productTypes' && hit.status === 'matched'
        ? [{ value: hit.value, start: lexeme.startToken, end: lexeme.endToken }] : []
    })
    const multiple = mentions.some((current, index) => {
      if (!index) return false
      const previous = mentions[index - 1]
      const adjacentPantsJeans = previous.end === current.start
        && [previous.value, current.value].every(value => value === 'PANTS' || value === 'JEANS')
      return previous.value !== current.value && !adjacentPantsJeans
        || tokens.slice(previous.end, current.start).some(token => coordinators.has(token) || unsupportedOperators.has(token))
    })
    if (multiple) {
      issue('multiple_items', span(0, tokens.length), 'Multiple product descriptions are unsupported.', ['productType'])
      return finalize('unsupported_multiple_items')
    }
    return finalize('needs_clarification')
  }

  materialCandidates = Object.freeze(scannedMaterials.filter(row => row.result.status !== 'blocked'))
  necklineCandidates = scannedNecklines
  materialComposition = scanMaterialComposition(originalText!, materialCandidates)
  for (const row of materialComposition) issue('unsupported_value', row.span,
    row.status === 'requested' ? 'Composition requested; the current catalog has no independently verifiable composition fields.'
      : row.status === 'invalid' ? 'Composition percentage must be an integer from 0 to 100.' : 'Percentage has no uniquely attached named material.', ['material'])

  productTypeCandidates = activeLexemes.filter(match => !scannedSizes.some(size => size.startToken <= match.startToken
    && size.endToken >= match.endToken) && !scannedMaterials.some(material => material.domainExplicit && material.constrainsCatalog
      && material.startToken <= match.startToken && material.endToken >= match.endToken)
    && !scannedNecklines.some(neck => neck.constrainsCatalog && neck.startToken <= match.startToken && neck.endToken >= match.endToken)
    && !fitCutCandidates.some(fit=>(fit.constrainsCatalog||fit.role==='literal_name')&&fit.startToken<=match.startToken&&fit.endToken>=match.endToken)
    && !patternOwns(match)).map(match =>
    Object.freeze({ ...match, requiresCatalogEvidence: false }))
  const sourceAt = new Map(productTypeCandidates.filter(match => ['unknown', 'suggestion'].includes(productTypes.lookup(match.phrase).status)
    || match.result.candidates.length > 1 || match.result.context.length > 0)
    .map(match => [match.startToken, match]))
  const sizeAt = new Map(scannedSizes.map(match => [match.startToken, match]))
  const preservePoloEvidence = (polo: ParseSpan, garment: VoiceSaleAttributes['productType']) => {
    if (garment !== 'T_SHIRT') {
      // A bare Polo next to a non-shirt garment is catalog-name/model evidence,
      // not an unsupported collar request for that garment.
      necklineCandidates = necklineCandidates.filter(match =>
        match.endToken <= polo.startToken || match.startToken >= polo.endToken)
      return
    }
    issue('lexical_ambiguity', polo, 'Polo may be catalog identity, a shirt subtype, or a collar description.',
      ['productType', 'neckline'], [{ field: 'productType', value: 'POLO_SHIRT' }, { field: 'neckline', value: 'POLO_COLLAR' }])
  }
  const acceptSourceProduct = (seed: ParsedSourceProductMatch): number => {
    const s = span(seed.startToken, seed.endToken)
    const legacy = productTypes.lookup(seed.phrase)
    const previous = legacy.status === 'unknown' ? [] : valuesOf(legacy)
    const mapped = seed.result.candidates.flatMap(candidate => candidate.canonicalType === null ? [] : [candidate.canonicalType])
    const candidates = [...new Set([...previous, ...mapped])]
    // A compound source alias such as "t shirt polo" describes an explicit
    // T-shirt followed by catalog identity evidence. Keep the explicit garment
    // type and leave the final Polo token unconsumed for deterministic catalog
    // discovery instead of replacing T_SHIRT with POLO_SHIRT.
    if (mapped.includes('POLO_SHIRT') && seed.endToken - seed.startToken > 1) {
      const prefix = span(seed.startToken, seed.endToken - 1)
      const prefixType = productTypes.lookup(prefix.text)
      const prefixValues = prefixType.status === 'unknown' ? [] : valuesOf(prefixType)
      if (prefixValues.length === 1 && prefixValues[0] === 'T_SHIRT') {
        add('productType', ['T_SHIRT'], prefix, false, 'explicit', 'explicit_garment_with_catalog_evidence')
        sourceUsed.add(seed.startToken)
        const polo = span(seed.endToken - 1, seed.endToken)
        preservePoloEvidence(polo, 'T_SHIRT')
        consume(prefix)
        return seed.endToken
      }
    }
    const nextSource = productTypeCandidates.find(match => match.startToken === seed.endToken)
    const nextCanonical = nextSource?.result.candidates[0]?.canonicalType
    if (candidates.length === 1 && candidates[0] === 'T_SHIRT' && nextSource
      && nextSource.result.candidates.length === 1 && nextCanonical === 'POLO_SHIRT') {
      add('productType', ['T_SHIRT'], s, false, 'explicit', 'explicit_garment_with_catalog_evidence')
      sourceUsed.add(seed.startToken)
      const polo = span(nextSource.startToken, nextSource.endToken)
      preservePoloEvidence(polo, 'T_SHIRT')
      consume(s)
      return nextSource.endToken
    }
    // Word order does not change ownership: in "Polo T-shirt" the explicit
    // garment remains the type and Polo stays unconsumed catalog-name evidence.
    if (candidates.length === 1 && candidates[0] === 'POLO_SHIRT' && nextSource
      && nextSource.result.candidates.length === 1
      && ['T_SHIRT', 'PANTS'].includes(nextCanonical ?? '')) {
      const garment = nextCanonical as 'T_SHIRT' | 'PANTS'
      const garmentSpan = span(nextSource.startToken, nextSource.endToken)
      add('productType', [garment], garmentSpan, false, 'explicit', 'explicit_garment_with_catalog_evidence')
      sourceUsed.add(nextSource.startToken)
      preservePoloEvidence(s, garment)
      consume(garmentSpan)
      return garmentSpan.endToken
    }
    if (candidates.length === 1 && nextSource && nextSource.result.status === 'candidate'
      && nextCanonical && candidates[0] !== nextCanonical
      && [candidates[0], nextCanonical].every(value => value === 'PANTS' || value === 'JEANS')) {
      const compound = span(seed.startToken, nextSource.endToken)
      add('productType', [candidates[0], nextCanonical], compound, true, 'explicit', 'pants_jeans_compound')
      issue('lexical_ambiguity', compound, 'Adjacent Pants/Jeans descriptions may describe one garment.',
        ['productType'], [candidates[0], nextCanonical].map(value => ({ field: 'productType', value })))
      sourceUsed.add(seed.startToken); sourceUsed.add(nextSource.startToken)
      consume(compound)
      return compound.endToken
    }
    const ambiguous = seed.result.status !== 'candidate'
    sourceUsed.add(seed.startToken)
    if (candidates.length) add('productType', candidates, s, ambiguous, 'explicit', 'active_source_alias')
    if (ambiguous) issue('lexical_ambiguity', s,
      `Context required for active product concepts: ${seed.result.candidates.map(candidate => candidate.sourceTypeId).join(', ')}.`,
      ['productType'], candidates.map(value => ({ field: 'productType', value })))
    consume(s)
    return s.endToken
  }

  for (let i = 0; i < tokens.length;) {
    const literalName = literalProductNameAt.get(i)
    if (literalName) { i = literalName.endToken; continue }
    if(patternCandidates.some(p=>p.role==='literal_name'&&p.startToken<=i&&p.endToken>i)){i++;continue}
    if(patternCues.has(tokens[i])&&patternAt.has(i+1)){consume(span(i,i+1));i++;continue}
    const pattern=patternAt.get(i)
    if(pattern){
      const s=span(i,pattern.endToken),previous=dictionaries.patterns.lookup(s.text)
      if(previous.status==='matched')add('pattern',[previous.value],s,!pattern.constrainsCatalog,'explicit','dictionary_alias')
      else {const legacy={PLAIN_SOLID:'PLAIN',STRIPE_GENERIC:'STRIPED',CHECK_GENERIC:'CHECKERED',GEO_WAVES:'WAVY'} as const
        const id=pattern.result.patterns.length===1?pattern.result.patterns[0]:null
        if(id&&id in legacy)add('pattern',[legacy[id as keyof typeof legacy]],s,!pattern.constrainsCatalog,'explicit','source_pattern_alias')}
      if(!pattern.constrainsCatalog||pattern.result.patterns.length>1)issue('lexical_ambiguity',s,'Pattern identity or attached modifier requires independent catalog evidence.',['pattern'])
      consume(s);i=s.endToken;continue
    }
    if (fitCutCandidates.some(row=>row.role==='literal_name'&&row.startToken<=i&&row.endToken>i)) {i++;continue}
    if (fitCutCues.has(tokens[i]) && fitAt.has(i+1)) {consume(span(i,i+1));i++;continue}
    const fitCut=fitAt.get(i)
    if (fitCut && fitCut.role!=='modifier') {
      const s=span(i,fitCut.endToken), id=fitCut.result.styles.length===1?fitCut.result.styles[0]:null
      const legacy={FIT_SLIM:'SLIM_FIT',FIT_REGULAR:'REGULAR_FIT',FIT_OVERSIZED:'OVERSIZED',FIT_LOOSE:'LOOSE_FIT'} as const
      const previous=dictionaries.fits.lookup(s.text)
      if (previous.status==='matched') add('fit',[previous.value],s,fitCut.result.styles.length!==1||!fitCut.constrainsCatalog,'explicit','dictionary_alias')
      else if (id && fitCutConcept(id).group==='fit' && id in legacy && fitCut.constrainsCatalog) {
        add('fit',[legacy[id as keyof typeof legacy]],s,false,'explicit','source_fit_cut_alias')
      }
      if (!fitCut.constrainsCatalog || fitCut.result.styles.length!==1) issue('lexical_ambiguity',s,
        'Fit/cut role or identity requires independent catalog evidence.',['fit'])
      consume(s);i=s.endToken;continue
    }
    if (fitCut?.role==='modifier' && fitCut.constrainsCatalog) {consume(span(i,fitCut.endToken));i=fitCut.endToken;continue}
    if (literalExpressionIndexes.has(i)) { i++; continue }
    const requestPrefixedProduct = sourceAt.get(i)
    const exactRequestPrefix = requestIntents.find(request => request.certainty === 'exact'
      && request.sourceSpan.startToken === i && request.sourceSpan.endToken < (requestPrefixedProduct?.endToken ?? i))
    // Some audited source aliases include a natural request prefix (for example
    // "بدي بيبي"). Keep the prefix as request metadata while retaining the
    // exact, longer product alias instead of dropping its remaining noun.
    if (requestPrefixedProduct && exactRequestPrefix) {
      i = acceptSourceProduct(requestPrefixedProduct)
      continue
    }
    if (conversationIndexes.includes(i)) { i++; continue }
    if (necklineCues.has(tokens[i]) && neckAt.has(i + 1)) { consume(span(i, i + 1)); i++; continue }
    const neck = neckAt.get(i)
    if (neck) {
      const s = span(i, neck.endToken), previous = dictionaries.necklines.lookup(s.text)
      // Preserve legacy slot values while typed alternatives govern catalog verification.
      if (previous.status === 'matched') add('neckline', [previous.value], s, false, 'explicit', 'dictionary_alias')
      else {
        const id = neck.result.shapes.length + neck.result.collars.length + neck.result.modifiers.length === 1
          ? [...neck.result.shapes, ...neck.result.collars][0] : null
        const legacy = id === 'NECK_V' ? 'V_NECK' : id === 'NECK_CREW' ? 'CREW_NECK' : id === 'COLLAR_POLO' ? 'POLO_COLLAR' : null
        if (legacy) {
          const marked = necklineCues.has(tokens[i - 1])
          add('neckline', [legacy], s, false, marked ? 'inferred' : 'explicit', marked ? 'necklines_marker' : 'source_neckline_alias')
        }
      }
      if (neck.result.shapes.length + neck.result.collars.length + neck.result.modifiers.length > 1) issue('lexical_ambiguity', s,
        'Neckline/collar interpretations require independent product-name evidence.', ['neckline'])
      consume(s); i = s.endToken; continue
    }
    if (materialCues.has(tokens[i]) && materialAt.has(i + 1)) { consume(span(i, i + 1)); i++; continue }
    const material = materialAt.get(i)
    if (material && !scannedSizes.some(size => size.startToken <= i && size.endToken >= material.endToken)
      && !productTypeCandidates.some(product => product.startToken <= i && product.endToken > material.endToken)) {
      const s = span(i, material.endToken)
      const previous = dictionaries.materials.lookup(s.text)
      if (previous.status === 'matched') add('material', [previous.value], s, false, 'explicit', 'dictionary_alias')
      else if (material.result.legacyMaterial) add('material', [material.result.legacyMaterial], s, false, 'explicit', 'source_material_alias')
      if (material.result.fabrics.length > 1 || material.result.fabrics.length && material.result.modifiers.length
        || material.result.records.some(row => row.reasons.includes('Source entry needs review/context.'))) {
        issue('lexical_ambiguity', s, `Material context required: ${[...material.result.fabrics, ...material.result.modifiers].join(', ')}.`, ['material'])
      }
      consume(s); i = s.endToken; continue
    }
    const quantity = quantityAt.get(i)
    if (quantity) {
      if (quantity.rule !== 'product_pack_descriptor') consume(quantity.span)
      i = quantity.span.endToken; continue
    }
    const oldQuantity = at.get(i)
    if (!sizeAt.has(i) && !productTypeCandidates.some(match => match.startToken <= i && match.endToken > i)
      && oldQuantity?.result.hits.length === 1 && oldQuantity.result.hits[0].domain === 'quantities'
      && !/^\d+$/u.test(oldQuantity.phrase)) {
      // A number word that the intent layer did not claim may be a real brand or
      // product name. Keep it as a literal residual constraint.
      i = oldQuantity.endToken; continue
    }
    if (blockedNumbers.has(i) && !sizeAt.has(i)) { i++; continue }
    if (isSizeCue(tokens[i]) && scannedSizes.some(match => match.startToken > i
      && tokens.slice(i, match.startToken).every(isSizeCue))) { consume(span(i, i + 1)); i++; continue }
    const sourceSize = sizeAt.get(i)
    if (sourceSize) {
      const s = span(sourceSize.startToken, sourceSize.endToken)
      if (overlapsBlocked(s)) {
        // Keep a typed contextual alternative, but never affirm a malformed
        // numeric label or let it become a quantity after punctuation loss.
        sourceSizeCandidates.push(Object.freeze({ ...sourceSize, resolvedId: null, contextRequired: true }))
        i = s.endToken; continue
      }
      sourceSizeCandidates.push(sourceSize)
      const old = sizes.lookup(s.text)
      const qualified = sourceSize.sizeDomainExplicit ? sizes.lookup(`size ${s.text}`) : undefined
      const legacy = sourceSize.resolvedId ? activeSizes.legacySize(sourceSize.resolvedId) : null
      if (old.status === 'matched') add('size', [old.value], s, false, 'explicit', 'dictionary_alias')
      else if (qualified?.status === 'matched') add('size', [qualified.value], s, false, 'explicit', 'sizes_marker')
      else if (legacy) add('size', [legacy], s, false, 'explicit', 'source_size_expression')
      if (sourceSize.contextRequired) issue(sourceSize.incompatibleStandard ? 'unsupported_value'
        : sourceSize.result.status === 'suggestion' ? 'uncertain_transcription' : 'lexical_ambiguity', s,
        sourceSize.result.reason ?? 'Size family or standard requires explicit language/catalog evidence.', ['size'])
      if (sourceSize.result.status !== 'suggestion' && !(sourceSize.contextRequired && old.status === 'unknown'
        && !sourceSize.sizeDomainExplicit && !inferSizeContext(originalText!).garment)) consume(s)
      i = s.endToken; continue
    }
    const seed = sourceAt.get(i)
    const color = colorAt.get(i)
    const productSpan = productTypeCandidates.find(match => match.startToken === i)
    const oldSpan = at.get(i)
    const explicitColor = colorExplicitPositions.has(i)
    const colorOwns = color && (explicitColor || (!color.result.crossDomainOverlaps.length
      && (!productSpan || color.endToken > productSpan.endToken)
      && (!oldSpan || color.endToken >= oldSpan.endToken)))
    if (color && (colorOwns || color.result.crossDomainOverlaps.length > 0 && !productSpan?.result.candidates.length)
      && !overlapsBlocked(span(color.startToken, color.endToken))) {
      const accepted = Object.freeze({ ...color, colorDomainExplicit: explicitColor })
      colorCandidates.push(accepted)
      if (colorOwns) {
        const s = span(color.startToken, color.endToken)
        const resolved = color.result.status === 'matched' || explicitColor && color.result.status === 'ambiguous' && color.result.candidates.length === 1
        if (color.result.legacyColor) add('color', [color.result.legacyColor], s, !resolved, 'explicit', 'active_color_alias')
        if (color.result.embeddedPattern) add('pattern', [color.result.embeddedPattern], s, false, 'explicit', 'dictionary_alias')
        if (!resolved) issue(color.result.status === 'deferred' ? 'uncertain_transcription' : 'lexical_ambiguity', s,
          color.result.reason ?? `Color context required: ${color.result.candidates.join(', ')}.`, ['color'])
        if (color.result.status !== 'deferred') consume(s)
        else if (explicitColor) for (let token = s.startToken; token < s.endToken; token++) notNames.add(token)
        i = s.endToken; continue
      }
    }
    // Retain cross-domain color alternatives without taking a known Product/Material span.
    if (color && color.result.crossDomainOverlaps.length && !colorCandidates.some(match => match.startToken === i)
      && productSpan && productSpan.endToken === color.endToken) {
      colorCandidates.push(Object.freeze({ ...color, colorDomainExplicit: false }))
    }
    if (seed && !overlapsBlocked(span(seed.startToken, seed.endToken))) {
      i = acceptSourceProduct(seed)
      continue
    }
    const lexeme = at.get(i)
    const expressionHit = lexeme?.result.hits.find(hit => hit.domain === 'expressions')
    const grammarMarker = Object.hasOwn(grammarMarkers, tokens[i]) ? grammarMarkers[tokens[i]] : undefined
    const completeAlias = lexeme && lexeme.endToken > i + 1
      && lexeme.result.hits.some(hit => hit.domain === grammarMarker && hit.status === 'matched')
    const markerDomain = (completeAlias ? undefined : grammarMarker) ?? (expressionHit?.status === 'matched'
      && expressionHit.value in expressionMarkers
      ? expressionMarkers[expressionHit.value as keyof typeof expressionMarkers] : undefined)
    if (markerDomain) {
      const markerEnd = expressionHit ? lexeme!.endToken : i + 1
      if (markerDomain === 'sizes' && sizeAt.has(markerEnd)) {
        consume(span(i, markerEnd)); i = markerEnd; continue
      }
      if (markerDomain === 'colors' && colorAt.has(markerEnd)) {
        colorExplicitPositions.add(markerEnd)
        consume(span(i, markerEnd)); i = markerEnd; continue
      }
      if (markerDomain === 'productTypes' && sourceAt.has(markerEnd)) {
        consume(span(i, markerEnd))
        i = markerEnd
        continue
      }
      const next = at.get(markerEnd)
      let hit = next?.result.hits.find(hit => hit.domain === markerDomain)
      let end = next?.endToken ?? markerEnd + 1
      if (markerDomain === 'quantities' && !hit && /^\d+$/u.test(tokens[markerEnd] ?? '')) {
        const qualified = quantities.lookup(`${tokens[markerEnd]} pieces`)
        hit = qualified.status === 'matched' ? qualified : undefined
        end = markerEnd + 1
      }
      if (markerDomain === 'quantities' && hit?.status === 'matched' && unitWords.has(tokens[end] ?? '')) end++
      const s = span(i, Math.min(end, tokens.length))
      if (hit && hit.domain !== 'expressions' && !overlapsBlocked(s)) {
        const isContextual = hit.status === 'ambiguous'
        addHit(hit, s, isContextual ? 'inferred' : 'explicit', `${markerDomain}_marker`, true)
        if (hit.status === 'suggestion') {
          consume(span(i, markerEnd))
          for (let j = markerEnd; j < s.endToken; j++) notNames.add(j)
        } else consume(s)
        if (hit.status === 'suggestion' || hit.status === 'ambiguous' && valuesOf(hit).length > 1) {
          issue(hit.status === 'suggestion' ? 'uncertain_transcription' : 'lexical_ambiguity', s,
            hit.reason, [fieldForDomain[markerDomain]],
            valuesOf(hit).map(value => ({ field: fieldForDomain[markerDomain], value })))
        }
        i = s.endToken
        continue
      }
      consume(span(i, markerEnd))
      const unsupportedEnd = Math.min(Math.max(markerEnd + 1, next?.endToken ?? markerEnd), tokens.length)
      for (let j = markerEnd; j < unsupportedEnd; j++) notNames.add(j)
      issue('unsupported_value', span(i, Math.min(markerEnd + 1, tokens.length)),
        `Missing or unsupported value after ${markerDomain} marker.`, [fieldForDomain[markerDomain]])
      i = unsupportedEnd
      continue
    }
    if (!lexeme) {
      if (/^\d+$/u.test(tokens[i])) {
        notNames.add(i)
        issue('unresolved_number', span(i, i + 1), 'Bare number has no explicit size or quantity context.', ['size', 'quantity'])
      }
      i++
      continue
    }
    let s = span(i, lexeme.endToken)
    if (overlapsBlocked(s)) { i++; continue }
    const hits = lexeme.result.hits
    if (hits.length === 1 && hits[0].domain === 'expressions') {
      consume(s)
      for (let j = s.startToken; j < s.endToken; j++) conversational.add(j)
      i = s.endToken
      continue
    }
    // Mixed-language adjacent Pants/Jeans is one unresolved compound, not two items.
    const product = hits.length === 1 && hits[0].domain === 'productTypes' && hits[0].status === 'matched' ? hits[0] : undefined
    const next = at.get(s.endToken)
    const nextProduct = next?.result.hits.find(hit => hit.domain === 'productTypes' && hit.status === 'matched')
    const currentSourceProduct = productTypeCandidates.find(match => match.startToken === i
      && match.endToken === s.endToken && match.result.candidates.length === 1)
    const followingSourceProduct = productTypeCandidates.find(match => match.startToken === s.endToken
      && match.result.candidates.length === 1)
    const followingCanonical = followingSourceProduct?.result.candidates[0]?.canonicalType
    if (currentSourceProduct?.result.candidates[0]?.canonicalType === 'POLO_SHIRT'
      && followingSourceProduct && ['T_SHIRT', 'PANTS'].includes(followingCanonical ?? '')) {
      const garment = followingCanonical as 'T_SHIRT' | 'PANTS'
      const garmentSpan = span(followingSourceProduct.startToken, followingSourceProduct.endToken)
      add('productType', [garment], garmentSpan, false, 'explicit', 'explicit_garment_with_catalog_evidence')
      sourceUsed.add(followingSourceProduct.startToken)
      preservePoloEvidence(s, garment)
      consume(garmentSpan)
      i = garmentSpan.endToken
      continue
    }
    const adjacentSourceProduct = productTypeCandidates.find(match => match.startToken === s.endToken)
    if (product && ['T_SHIRT', 'PANTS'].includes(product.value)
      && adjacentSourceProduct?.result.candidates.length === 1
      && adjacentSourceProduct.result.candidates[0].canonicalType === 'POLO_SHIRT') {
      const garment = product.value as 'T_SHIRT' | 'PANTS'
      add('productType', [garment], s, false, 'explicit', 'explicit_garment_with_catalog_evidence')
      const source = productTypeCandidates.find(match => match.startToken === i && match.endToken === s.endToken)
      if (source) sourceUsed.add(source.startToken)
      const polo = span(adjacentSourceProduct.startToken, adjacentSourceProduct.endToken)
      preservePoloEvidence(polo, garment)
      consume(s)
      i = adjacentSourceProduct.endToken
      continue
    }
    if (product && ['T_SHIRT', 'PANTS'].includes(product.value) && nextProduct?.value === 'POLO_SHIRT') {
      const garment = product.value as 'T_SHIRT' | 'PANTS'
      add('productType', [garment], s, false, 'explicit', 'explicit_garment_with_catalog_evidence')
      const source = productTypeCandidates.find(match => match.startToken === i && match.endToken === s.endToken)
      if (source) sourceUsed.add(source.startToken)
      preservePoloEvidence(span(next!.startToken, next!.endToken), garment)
      consume(s)
      i = next!.endToken
      continue
    }
    if (product && nextProduct?.status === 'matched'
      && new Set([product.value, nextProduct.value]).size === 2
      && [product.value, nextProduct.value].every(value => value === 'PANTS' || value === 'JEANS')) {
      s = span(i, next!.endToken)
      const candidates = [product.value, nextProduct.value]
      add('productType', candidates, s, true, 'explicit', 'pants_jeans_compound')
      issue('lexical_ambiguity', s, 'Adjacent Pants/Jeans descriptions may describe one garment.', ['productType'],
        candidates.map(value => ({ field: 'productType', value })))
      consume(s)
      i = s.endToken
      continue
    }
    // Reuse a qualified dictionary product alias to resolve an ambiguous prefix
    // while preserving a separate material suffix (e.g. Kenza + Wool).
    const qualified = product ? decomposeQualifiedProductAlias(s.text) : undefined
    if (qualified) {
      const split = i + qualified.splitToken
      add('productType', [qualified.productType], span(i, split), false, 'inferred', 'qualified_product_alias')
      add('material', [qualified.material], span(split, s.endToken), false, 'explicit', 'dictionary_alias')
      const source = productTypeCandidates.find(match => match.startToken === i && match.endToken === s.endToken)
      if (source) sourceUsed.add(source.startToken)
      consume(s); i = s.endToken; continue
    }

    if (hits.length === 1 && hits[0].domain === 'quantities' && hits[0].status === 'matched'
      && unitWords.has(tokens[s.endToken] ?? '') && !blockedNumbers.has(s.endToken)) {
      s = span(i, s.endToken + 1)
    }
    const nextExpression = at.get(s.endToken)?.result.hits.find(hit => hit.domain === 'expressions')
    if (hits.length === 1 && hits[0].domain === 'quantities' && hits[0].status === 'matched'
      && hits[0].value === 1 && !tokens.slice(i, s.endToken).some(token => unitWords.has(token))
      && nextExpression?.status === 'matched' && nextExpression.value === 'SIZE_MARKER') {
      s = span(i, at.get(s.endToken)!.endToken)
      for (let j = s.startToken; j < s.endToken; j++) notNames.add(j)
      issue('unsupported_value', s, 'One-size clothing is not a supported canonical size; one is not a requested quantity here.', ['size', 'quantity'])
      i = s.endToken
      continue
    }
    const bareNumber = /^\d+$/u.test(s.text)
    if (bareNumber) {
      for (let j = s.startToken; j < s.endToken; j++) notNames.add(j)
      issue('unresolved_number', s, 'Bare number has no explicit size or quantity context.', ['size', 'quantity'])
      i = s.endToken
      continue
    }
    const ambiguous = hits.length > 1 || hits.some(hit => hit.status !== 'matched')
    for (const hit of hits) {
      if (hit.domain === 'expressions') continue
      if (ambiguous && hit.status === 'matched') {
        add(fieldForDomain[hit.domain], [hit.value], s, true, 'explicit', 'cross_domain_ambiguity')
      } else addHit(hit, s, 'explicit', 'dictionary_alias')
    }
    if (ambiguous) {
      const affected = hits.flatMap(hit => hit.domain === 'expressions' ? [] : [fieldForDomain[hit.domain]])
      const alternatives = hits.flatMap(hit => hit.domain === 'expressions' ? []
        : valuesOf(hit).map(value => ({ field: fieldForDomain[hit.domain], value })))
      const uncertain = hits.some(hit => hit.status === 'suggestion')
      issue(uncertain ? 'uncertain_transcription' : 'lexical_ambiguity', s,
        hits.flatMap(hit => hit.status === 'matched' ? [] : [hit.reason]).join(' ') || 'Alias has more than one domain interpretation.',
        affected, alternatives)
    }
    if (!hits.some(hit => hit.status === 'suggestion')) consume(s)
    i = s.endToken
  }

  const products = observations.productType
  let multiple = false
  for (let i = 1; i < products.length; i++) {
    const previous = products[i - 1]
    const current = products[i]
    const between = tokens.slice(previous.evidence.span.endToken, current.evidence.span.startToken)
    const isProductMention = (row: Observation) => !row.unresolved || row.evidence.rule === 'pants_jeans_compound'
    const distinct = isProductMention(previous) && isProductMention(current)
      && !previous.candidates.some(value => current.candidates.includes(value))
    const attributesBetween = fields.some(field => field !== 'productType'
      && observations[field].some(row => row.evidence.span.startToken >= previous.evidence.span.endToken
        && row.evidence.span.endToken <= current.evidence.span.startToken))
    if (distinct || between.some(token => coordinators.has(token)) || attributesBetween) multiple = true
  }
  // Unmapped source IDs must not bypass the existing single-item limit merely
  // because they cannot populate the legacy canonical observations.
  for (let i = 1; i < productTypeCandidates.length; i++) {
    const previous = productTypeCandidates[i - 1]
    const current = productTypeCandidates[i]
    if (!sourceUsed.has(previous.startToken) && !sourceUsed.has(current.startToken)) continue
    const between = tokens.slice(previous.endToken, current.startToken)
    const distinct = previous.result.status === 'candidate' && current.result.status === 'candidate'
      && previous.result.candidates[0].sourceTypeId !== current.result.candidates[0].sourceTypeId
    const pantsJeansCompound = previous.endToken === current.startToken
      && [previous.result.candidates[0].canonicalType, current.result.candidates[0].canonicalType]
        .every(value => value === 'PANTS' || value === 'JEANS')
    if (distinct && !pantsJeansCompound || between.some(token => coordinators.has(token))) multiple = true
  }
  for (let i = 0; i < tokens.length; i++) {
    if (coordinators.has(tokens[i])) {
      const before = fields.filter(field => observations[field].some(row => row.evidence.span.endToken <= i))
      const after = fields.filter(field => observations[field].some(row => row.evidence.span.startToken > i))
      if (before.length && after.length) { consumed.add(i); conversational.add(i) }
      if (before.filter(field => coreFields.includes(field) && field !== 'productType' && after.includes(field)).length >= 2) multiple = true
    }
    // Recognize only a conjunction attached to an exact known product word;
    // unknown brand words stay intact. No substring clothing search is used.
    if (!consumed.has(i) && tokens[i].startsWith('و') && products.length) {
      const attached = lookupVocabulary(tokens[i].slice(1))
      if (attached.hits.some(hit => hit.domain === 'productTypes')) multiple = true
    }
  }
  if (multiple) issue('multiple_items', span(0, tokens.length),
    'Multiple product/item descriptions are unsupported; parse each item separately.', ['productType'])
  return finalize()
}
