import { Prisma } from '../generated/prisma/client.js'
import { activeProductTypes, activeColors, decomposeQualifiedProductAlias, dictionaries, lookupVocabulary, matchVocabularyTokens, normalizeText, tokenizeText } from './index.js'
import type { SourceProductTypeId } from './product-type-source-ids.js'
import type { ProductType } from './dictionary.types.js'
import type { AttributeName, VoiceSaleAttributes, VoiceSaleParseResult } from './parser.types.js'
import type { CatalogCategoryResolution, CatalogEvidenceField, CatalogSnapshot, CatalogVariant, MatchEvidence, MissingMatchField, VoiceCatalogDiscovery, VoiceDiscoveryCandidate, VoiceMatchCandidate, VoiceSaleMatchResult } from './match.types.js'
import { buildTenantCatalogSearchIndex, type TenantCatalogSearchIndex } from './catalog-search-index.js'
import { inferSizeContext } from './size-context.js'
import { compareSourceSize } from './size-matching.js'
import type { SizeContext } from './size-source.types.js'
import { scanSourceMaterials } from './material-parser.js'
import { materialNeedsSpecification } from './material-source.js'
import type { SourceMaterialId, SourceFabricModifierId } from './material-source-ids.js'
import { scanSourceNecklines, necklineCues } from './neckline-parser.js'
import type { SourceNecklineStyleId, SourceNecklineModifierId } from './neckline-source-ids.js'
import { scanFitCuts } from './fit-cut-parser.js'
import { fitCutConcept } from './fit-cut-source.js'
import type { SourceFitCutId } from './fit-cut-ids.js'
import { scanPatterns, patternCues } from './pattern-parser.js'
import type { SourcePatternId } from './pattern-ids.js'

export const MAX_MATCH_CANDIDATES = 20
export const MAX_MATCH_SUGGESTIONS = 5
const domains = {
  productType: 'productTypes', color: 'colors', size: 'sizes', quantity: 'quantities',
  material: 'materials', neckline: 'necklines', fit: 'fits', pattern: 'patterns',
} as const
type Value = VoiceSaleAttributes[AttributeName]
type NameField = Exclude<AttributeName, 'quantity'>
const atom = (field: AttributeName, value: Value) => `${field}:${value}`
const wordAtom = (word: string) => `word:${word}`
const sourceAtom = (id: SourceProductTypeId) => `sourceType:${id}`
interface NameProfile {
  readonly patterns: Map<SourcePatternId, 'product_name'|'category_name'>
  readonly patternModifiers: Map<string, 'product_name'|'category_name'>
  readonly fitCuts: Map<SourceFitCutId, 'product_name' | 'category_name'>
  readonly fitModifiers: Map<string, 'product_name' | 'category_name'>
  readonly necklineStyles: Set<SourceNecklineStyleId>
  readonly necklineModifiers: Set<SourceNecklineModifierId>
  readonly materialCompounds: readonly { parent: SourceProductTypeId; garment: SourceProductTypeId; descriptor: string }[]
  readonly materials: Map<SourceMaterialId, 'product_name' | 'category_name'>
  readonly materialModifiers: Map<SourceFabricModifierId, 'product_name' | 'category_name'>
  readonly sizeContext: SizeContext
  readonly atoms: Set<string>
  readonly tokens: readonly string[]
  readonly values: Map<NameField, Set<Value>>
  readonly categoryType: Value | null
  readonly sourceTypes: Set<SourceProductTypeId>
  readonly sourceAlternatives: Set<SourceProductTypeId>
  readonly sourceProof: Map<SourceProductTypeId, 'product_name' | 'category_name'>
}

function profile(row: CatalogVariant): NameProfile {
  const tokens = tokenizeText(row.productName)
  const atoms = new Set<string>()
  const values = new Map<NameField, Set<Value>>()
  const consumed = new Set<number>()
  const patterns=new Map<SourcePatternId,'product_name'|'category_name'>(),patternModifiers=new Map<string,'product_name'|'category_name'>(),patternOwned=new Set<number>(),patternLiteral=new Set<number>()
  const patternsByLabel=new Map<string,ReturnType<typeof scanPatterns>>()
  for(const [label,origin] of [[row.productName,'product_name'],[row.categoryName,'category_name']] as const){
    const matches=scanPatterns(label);patternsByLabel.set(label,matches)
    if(origin==='product_name')for(const p of matches.filter(p=>p.role==='literal_name'))for(let i=p.startToken;i<p.endToken;i++)patternLiteral.add(i)
    for(const p of matches.filter(p=>p.constrainsCatalog&&p.result.patterns.length===1&&!p.result.modifiers.length)){
      const id=p.result.patterns[0];if(!patterns.has(id))patterns.set(id,origin)
      if(origin==='product_name'){atoms.add(`patternSource:${id}`);for(let i=p.startToken;i<p.endToken;i++){consumed.add(i);patternOwned.add(i)}
        if(patternCues.has(tokens[p.startToken-1])){consumed.add(p.startToken-1);patternOwned.add(p.startToken-1)}}
      for(const m of matches.filter(m=>m.constrainsCatalog&&m.result.modifiers.length===1&&m.modifierTarget?.startToken===p.startToken)){
        const key=`${id}:${m.result.modifiers[0]}`;if(!patternModifiers.has(key))patternModifiers.set(key,origin)
        if(origin==='product_name'){atoms.add(`patternModifier:${key}`);for(let i=m.startToken;i<m.endToken;i++){consumed.add(i);patternOwned.add(i)}}
      }
    }
  }
  const patternOwns=(label:string,s:{startToken:number;endToken:number})=>patternsByLabel.get(label)?.some(p=>p.polarity==='affirmative'
    &&['descriptor','modifier','literal_name'].includes(p.role)&&p.startToken<=s.startToken&&p.endToken>=s.endToken)
  const fitCuts = new Map<SourceFitCutId, 'product_name' | 'category_name'>(), fitModifiers = new Map<string, 'product_name' | 'category_name'>(), fitOwned = new Set<number>()
  const fitLiteral = new Set<number>()
  for (const [label, origin] of [[row.productName,'product_name'],[row.categoryName,'category_name']] as const) {
    const cuts=scanFitCuts(label).filter(p=>!patternOwns(label,p))
    if (origin==='product_name') for (const cut of cuts.filter(c=>c.role==='literal_name')) {
      for (let i=cut.startToken;i<cut.endToken;i++) fitLiteral.add(i)
    }
    for (const cut of cuts.filter(c=>c.constrainsCatalog&&c.result.styles.length===1
      && c.result.modifiers.length===0&&c.result.ambiguities.every(a=>a.candidate_ids.split(';').length===1))) {
      const id=cut.result.styles[0]
      if (!fitCuts.has(id)) fitCuts.set(id,origin)
      if (origin==='product_name') {
        atoms.add(`fitCut:${id}`)
        for (let i=cut.startToken;i<cut.endToken;i++) {consumed.add(i);fitOwned.add(i)}
      }
      for (const modifier of cuts.filter(m=>m.constrainsCatalog&&m.result.modifiers.length===1
        &&m.modifierTarget?.startToken===cut.startToken&&m.modifierTarget.endToken===cut.endToken)) {
        const key=`${id}:${modifier.result.modifiers[0]}`
        if (!fitModifiers.has(key)) fitModifiers.set(key,origin)
        if (origin==='product_name') {
          atoms.add(`fitModifier:${key}`)
          for (let i=modifier.startToken;i<modifier.endToken;i++) {consumed.add(i);fitOwned.add(i)}
        }
      }
    }
  }
  const necklineStyles = new Set<SourceNecklineStyleId>(), necklineModifiers = new Set<SourceNecklineModifierId>()
  const productCompounds = activeProductTypes.matchTokens(row.productName)
  const lexical = matchVocabularyTokens(row.productName)
  const neckMatches = scanSourceNecklines(row.productName, true, { products: productCompounds, legacy: lexical }).filter(p=>!patternOwns(row.productName,p))
  const neckOwned = new Set<number>()
  for (const match of neckMatches.filter(m => m.constrainsCatalog)) {
    // An ambiguous catalog label is never independent proof of one interpretation.
    const ids = [...match.result.shapes, ...match.result.collars, ...match.result.modifiers]
    if (ids.length !== 1) continue
    match.result.shapes.forEach(id => necklineStyles.add(id)); match.result.collars.forEach(id => necklineStyles.add(id))
    match.result.modifiers.forEach(id => necklineModifiers.add(id))
    const compound = productCompounds.some(p => p.startToken <= match.startToken && p.endToken >= match.endToken
      && p.endToken - p.startToken >= match.endToken - match.startToken)
    if (!compound) {
      atoms.add(`necklineSource:${ids[0]}`)
      for (let i = match.startToken; i < match.endToken; i++) { consumed.add(i); neckOwned.add(i) }
      if (match.startToken && necklineCues.has(tokens[match.startToken - 1])) {
        consumed.add(match.startToken - 1); neckOwned.add(match.startToken - 1)
      }
    }
  }
  const materials = new Map<SourceMaterialId, 'product_name' | 'category_name'>()
  const materialModifiers = new Map<SourceFabricModifierId, 'product_name' | 'category_name'>()
  for (const [label, origin] of [[row.productName, 'product_name'], [row.categoryName, 'category_name']] as const) {
    const sourceCompounds = activeProductTypes.matchTokens(label)
    for (const match of scanSourceMaterials(label, true)) {
      if(patternOwns(label,match))continue
      const definite = match.constrainsCatalog && match.result.fabrics.length + match.result.modifiers.length === 1
        && !match.result.records.some(record => record.reasons.includes('Source entry needs review/context.'))
      if (!definite) continue
      for (const id of match.result.fabrics) materials.set(id, origin)
      for (const id of match.result.modifiers) materialModifiers.set(id, origin)
      const ownedByCompound = sourceCompounds.some(p => p.startToken <= match.startToken && p.endToken >= match.endToken
        && p.endToken - p.startToken > match.endToken - match.startToken)
      if (origin === 'product_name' && !ownedByCompound) {
        for (const id of match.result.fabrics) atoms.add(`fabric:${id}`)
        for (const id of match.result.modifiers) atoms.add(`fabricModifier:${id}`)
        for (let index = match.startToken; index < match.endToken; index++) consumed.add(index)
      }
    }
  }
  const categorySource = activeProductTypes.lookup(row.categoryName)
  const categoryIds = new Set(categorySource.candidates.map(candidate => candidate.sourceTypeId))
  const categoryDefinite = categorySource.candidates.length === 1
    && categorySource.status !== 'blocked' && categorySource.status !== 'unknown'
  const materialCompounds: { parent: SourceProductTypeId; garment: SourceProductTypeId; descriptor: string }[] = []
  if (categoryDefinite) for (const compound of activeProductTypes.matchTokens(row.productName)) {
    if (compound.result.status !== 'candidate' || compound.result.candidates.length !== 1) continue
    for (const part of scanSourceMaterials(compound.phrase, true)) {
      if (!part.constrainsCatalog || part.result.fabrics.length + part.result.modifiers.length !== 1) continue
      const remaining = tokenizeText(compound.phrase).filter((_, index) => index < part.startToken || index >= part.endToken).join(' ')
      const garment = activeProductTypes.lookup(remaining)
      if (garment.status === 'candidate' && garment.candidates.length === 1 && categoryIds.has(garment.candidates[0].sourceTypeId)) {
        materialCompounds.push({ parent: compound.result.candidates[0].sourceTypeId,
          garment: garment.candidates[0].sourceTypeId, descriptor: part.result.fabrics[0] ?? part.result.modifiers[0] })
      }
    }
  }
  const sourceTypes = new Set<SourceProductTypeId>()
  const sourceAlternatives = new Set<SourceProductTypeId>()
  const sourceProof = new Map<SourceProductTypeId, 'product_name' | 'category_name'>()
  const sourceOwned = new Set<number>()
  for (const match of activeProductTypes.matchTokens(row.productName)) {
    if([...patternLiteral,...patternOwned].some(i=>i>=match.startToken&&i<match.endToken))continue
    if ([...fitLiteral].some(index=>index>=match.startToken&&index<match.endToken)) continue
    if ([...fitOwned].some(index=>index>=match.startToken&&index<match.endToken)) continue
    if ([...neckOwned].some(index => index >= match.startToken && index < match.endToken)) continue
    // A complete descriptor phrase owns its span: Polo Collar is not a polo shirt.
    if (lexical.some(part => part.startToken <= match.startToken && part.endToken >= match.endToken
      && part.result.hits.length === 1 && part.result.hits[0].domain !== 'productTypes'
      && part.result.hits[0].status === 'matched')) continue
    for (let i = match.startToken; i < match.endToken; i++) sourceOwned.add(i)
    const ids = match.result.candidates.map(candidate => candidate.sourceTypeId)
    const narrowed = ids.filter(id => categoryDefinite && categoryIds.has(id))
    const entireName = match.startToken === 0 && match.endToken === tokens.length
    const definite = match.result.status === 'candidate' ? ids
      : narrowed.length === 1 ? narrowed
      : ids.length === 1 && entireName && !match.result.context.length
        && match.result.crossDomainOverlaps.length > 0 ? ids : []
    if (definite.length === 1) {
      sourceTypes.add(definite[0]); atoms.add(sourceAtom(definite[0]))
      sourceProof.set(definite[0], match.result.status === 'candidate' || !narrowed.length ? 'product_name' : 'category_name')
      const canonical = match.result.candidates.find(candidate => candidate.sourceTypeId === definite[0])!.canonicalType
      if (canonical) {
        const known = values.get('productType') ?? new Set<Value>()
        known.add(canonical); values.set('productType', known)
      }
      const qualified = decomposeQualifiedProductAlias(match.phrase)
      if (qualified) {
        const known = values.get('material') ?? new Set<Value>()
        known.add(qualified.material); values.set('material', known)
      }
      for (let i = match.startToken; i < match.endToken; i++) consumed.add(i)
    } else ids.forEach(id => sourceAlternatives.add(id))
  }
  for (const match of lexical) {
    if([...patternLiteral,...patternOwned].some(i=>i>=match.startToken&&i<match.endToken))continue
    if ([...fitLiteral].some(index=>index>=match.startToken&&index<match.endToken)) continue
    if ([...fitOwned].some(index=>index>=match.startToken&&index<match.endToken)) continue
    if ([...neckOwned].some(index => index >= match.startToken && index < match.endToken)) {
      const old = match.result.hits.find(h => h.domain === 'necklines' && h.status === 'matched')
      if (old?.status === 'matched') { const set = values.get('neckline') ?? new Set<Value>(); set.add(old.value); values.set('neckline', set) }
      continue
    }
    if ([...sourceOwned].some(index => index >= match.startToken && index < match.endToken)) continue
    const hit = match.result.hits[0]
    const field = (Object.keys(domains) as AttributeName[]).find(field => domains[field] === hit.domain)
    if (hit.domain === 'materials' && [...consumed].some(index => index >= match.startToken && index < match.endToken)) continue
    if (match.result.hits.length !== 1 || hit.status !== 'matched' || hit.domain === 'expressions'
      || !field || field === 'quantity') continue
    const sourceId = field === 'productType' ? activeProductTypes.sourceIdForCanonical(hit.value as ProductType) : null
    atoms.add(sourceId ? sourceAtom(sourceId) : atom(field, hit.value))
    if (sourceId) { sourceTypes.add(sourceId); sourceProof.set(sourceId, 'product_name') }
    const known = values.get(field) ?? new Set<Value>()
    known.add(hit.value)
    values.set(field, known)
    for (let i = match.startToken; i < match.endToken; i++) consumed.add(i)
  }
  tokens.forEach((token, index) => { if (!consumed.has(index)) atoms.add(wordAtom(token)) })
  const category = dictionaries.productTypes.lookup(row.categoryName)
  if (categoryDefinite) categoryIds.forEach(id => {
    sourceTypes.add(id)
    if (!sourceProof.has(id)) sourceProof.set(id, 'category_name')
  })
  return { patterns, patternModifiers, fitCuts, fitModifiers, atoms, tokens, values, sourceTypes, sourceAlternatives, sourceProof, materials, materialModifiers, materialCompounds, necklineStyles, necklineModifiers, sizeContext: inferSizeContext(`${row.productName} ${row.categoryName}`),
    categoryType: category.status === 'matched' ? category.value : null }
}

function containsPhrase(tokens: readonly string[], phrase: string): boolean {
  const requested = tokenizeText(phrase)
  return requested.length > 0 && tokens.some((_, start) => requested.every((word, offset) => tokens[start + offset] === word))
}

function containsOrderedWords(tokens: readonly string[], words: readonly string[]): boolean {
  let next = 0
  for (const token of tokens) if (token === words[next]) next++
  return next === words.length
}

function variantValue(field: 'color' | 'size', actual: string | null): Value | null {
  if (actual === null) return null
  if (field === 'color') {
    const source = activeColors.lookup(actual)
    return source.status !== 'deferred' && source.candidates.length === 1 ? source.legacyColor : null
  }
  const hit = dictionaries[domains[field]].lookup(actual)
  if (hit.status === 'matched') return hit.value
  // The real Variant.size column supplies the context that bare numeric text lacks.
  if (field === 'size' && hit.status === 'ambiguous' && hit.candidates.length === 1) return hit.candidates[0]
  return null
}

function resolveCatalogCategories(parser: VoiceSaleParseResult, index: TenantCatalogSearchIndex): CatalogCategoryResolution {
  const requestedType = parser.attributes.productType.status === 'resolved' ? parser.attributes.productType.value : null
  const requestedSourceType = parser.sourceProductType?.status === 'resolved' ? parser.sourceProductType.value : null
  const residual = normalizeText(parser.productNameResidualTokens.map(row => row.token).join(' '))
  const candidates = index.categories.flatMap(category => {
    const evidence = new Set<'EXACT_NAME' | 'PRODUCT_TYPE_BRIDGE'>()
    if (residual && category.normalizedName === residual) evidence.add('EXACT_NAME')
    const legacy = dictionaries.productTypes.lookup(category.categoryName)
    const source = activeProductTypes.lookup(category.categoryName)
    if (requestedType !== null && (legacy.status === 'matched' && legacy.value === requestedType
      || source.candidates.some(candidate => candidate.canonicalType === requestedType))) evidence.add('PRODUCT_TYPE_BRIDGE')
    if (requestedSourceType !== null && source.candidates.some(candidate => candidate.sourceTypeId === requestedSourceType)) {
      evidence.add('PRODUCT_TYPE_BRIDGE')
    }
    return evidence.size ? [Object.freeze({ categoryId: category.categoryId, categoryName: category.categoryName,
      evidence: Object.freeze([...evidence]), productCount: category.productIds.length })] : []
  })
  const status = !index.coverageComplete ? 'PARTIAL' as const : candidates.length === 1 ? 'RESOLVED' as const
    : candidates.length > 1 ? 'AMBIGUOUS' as const : 'UNRESOLVED' as const
  return Object.freeze({ status, candidates: Object.freeze(candidates), coverageComplete: index.coverageComplete })
}

/** Pure comparison over a current, tenant-authorized catalog snapshot. */
export function matchParsedCatalog(parser: VoiceSaleParseResult, catalog: CatalogSnapshot): VoiceSaleMatchResult {
  if(parser.patternCandidates?.some(p=>p.polarity==='negated')||parser.ambiguities.some(i=>i.kind==='conflicting_attribute'&&i.fields.includes('pattern')))return Object.freeze({
    status:'INCOMPLETE',reason:'PATTERN_REQUIRES_CLARIFICATION',parser,match:null,candidates:[],suggestions:[],requiresConfirmation:true,
    missingFields:['pattern'] as const,catalog:{scannedVariants:0,truncated:false,candidateCount:0,candidatesTruncated:false},
  })
  if (Object.values(parser.sourceFitCuts??{}).some(row=>row.status==='conflict')
    || parser.ambiguities.some(issue=>issue.kind==='conflicting_attribute'&&issue.fields.includes('fit'))
    || parser.fitCutCandidates?.some(row=>row.polarity==='negated'&&row.result.styles.length)) return Object.freeze({
    status:'INCOMPLETE',reason:'FIT_CUT_REQUIRES_CLARIFICATION',parser,match:null,candidates:[],suggestions:[],requiresConfirmation:true,
    missingFields:['fit'] as const,catalog:{scannedVariants:0,truncated:false,candidateCount:0,candidatesTruncated:false},
  })
  if (parser.commonExpressionSafety?.salePreviewAllowed === false) return Object.freeze({
    status: 'INCOMPLETE', reason: 'COMMON_EXPRESSION_REQUIRES_CLARIFICATION', parser,
    match: null, candidates: [], suggestions: [], requiresConfirmation: true,
    missingFields: [...parser.unresolvedInformation],
    catalog: { scannedVariants: 0, truncated: false, candidateCount: 0, candidatesTruncated: false },
  })
  const quantity = (!parser.quantityIntent || parser.quantityIntent.status === 'resolved')
    && parser.attributes.quantity.status === 'resolved' && parser.attributes.quantity.source === 'explicit'
    ? parser.attributes.quantity.value : null
  const guaranteed: { field: NameField; value: Value }[] = []
  const colorConstraints = (parser.colorCandidates ?? []).filter(match =>
    !match.result.crossDomainOverlaps.length || match.colorDomainExplicit)
  const sizeConstraints = parser.sourceSizeCandidates ?? []
  const materialConstraints = (parser.materialCandidates ?? []).filter(row => row.constrainsCatalog)
  const neckConstraints = (parser.necklineCandidates ?? []).filter(row => row.constrainsCatalog)
  const fitConstraints=(parser.fitCutCandidates??[]).filter(row=>row.polarity==='affirmative'
    && (row.role==='descriptor'||row.role==='requires_context'||row.role==='modifier'&&row.constrainsCatalog))
  const patternConstraints=(parser.patternCandidates??[]).filter(p=>p.polarity==='affirmative'&&!['literal_name','owned_by_other'].includes(p.role))
  const spokenAtoms = new Set<string>()
  const unknownWords = parser.productNameResidualTokens.map(row => row.token)
  const residualProductEvidence = unknownWords.length ? activeProductTypes.lookup(unknownWords.join(' ')) : null
  const residualSourceIds = residualProductEvidence?.candidates.map(candidate => candidate.sourceTypeId) ?? []
  unknownWords.forEach(word => spokenAtoms.add(wordAtom(word)))
  for (const field of Object.keys(domains) as AttributeName[]) {
    if (field === 'quantity') continue
    if (field === 'color' && colorConstraints.length) continue
    if (field === 'size' && sizeConstraints.length) continue
    if (field === 'material' && materialConstraints.some(row => row.result.fabrics.length)) continue
    if (field === 'neckline' && neckConstraints.length) continue
    if (field === 'fit' && fitConstraints.some(row=>row.result.styles.length)) continue
    if(field==='pattern'&&patternConstraints.length)continue
    const attribute = parser.attributes[field]
    if (attribute.status === 'resolved') guaranteed.push({ field, value: attribute.value! })
    else if (attribute.status === 'ambiguous') {
      // Retain definite evidence even when another cross-domain alias made the aggregate ambiguous.
      for (const evidence of attribute.evidence) {
        const lookup = lookupVocabulary(evidence.span.text)
        const hit = lookup.hits[0]
        if (evidence.rule === 'dictionary_alias' && lookup.hits.length === 1
          && hit.domain === domains[field] && hit.status === 'matched') guaranteed.push({ field, value: hit.value })
      }
    }
  }
  guaranteed.forEach(({ field, value }) => {
    spokenAtoms.add(atom(field, value))
    const id = field === 'productType' ? activeProductTypes.sourceIdForCanonical(value as ProductType) : null
    if (id) spokenAtoms.add(sourceAtom(id))
  })
  const sourceConstraints = (parser.productTypeCandidates ?? []).filter(match =>
    !parser.attributes.productType.evidence.some(evidence => evidence.rule === 'pants_jeans_compound'
      && evidence.span.startToken <= match.startToken && evidence.span.endToken >= match.endToken)
    && (match.result.candidates.length > 1 || !match.result.crossDomainOverlaps.length
    || parser.attributes.productType.evidence.some(evidence => evidence.rule === 'productTypes_marker'
      && evidence.span.startToken <= match.startToken && evidence.span.endToken >= match.endToken)))
  for (const match of sourceConstraints) {
    match.result.candidates.forEach(candidate => spokenAtoms.add(sourceAtom(candidate.sourceTypeId)))
  }
  const lexicalIssues = parser.ambiguities.filter(issue => issue.kind === 'lexical_ambiguity')
  for (const issue of lexicalIssues) {
    issue.alternatives.forEach(alternative => {
      spokenAtoms.add(atom(alternative.field, alternative.value))
      const id = alternative.field === 'productType' ? activeProductTypes.sourceIdForCanonical(alternative.value as ProductType) : null
      if (id) spokenAtoms.add(sourceAtom(id))
    })
    tokenizeText(issue.span.text).forEach(word => spokenAtoms.add(wordAtom(word)))
  }

  const exact: VoiceMatchCandidate[] = []
  const broad: VoiceMatchCandidate[] = []
  const partial: VoiceMatchCandidate[] = []
  // Name normalization is reused only within this request, never stock/price cached across requests.
  const profiles = new Map<string, NameProfile>()
  for (const row of catalog.variants) {
    const profileKey = JSON.stringify([row.productName, row.categoryName])
    let name = profiles.get(profileKey)
    if (!name) { name = profile(row); profiles.set(profileKey, name) }
    const rowSpokenAtoms = new Set(spokenAtoms)
    const evidence: MatchEvidence[] = []
    const unresolved = new Set<AttributeName>()
    const verify = (field: AttributeName, value: Value): 'yes' | 'no' | 'unknown' => {
      if (field === 'quantity') return 'unknown'
      if (field === 'color' || field === 'size') {
        const actual = row[field]
        if (variantValue(field, actual) !== value) return 'no'
        evidence.push({ field, source: 'variant_column', requested: String(value), actual })
        return 'yes'
      }
      if (field === 'pattern' && row.color !== null && activeColors.lookup(row.color).embeddedPattern === value) {
        evidence.push({ field, source: 'variant_column', requested: String(value), actual: row.color })
        return 'yes'
      }
      const known = name!.values.get(field)
      const explicitTshirtPolo = field === 'productType' && value === 'T_SHIRT'
        && parser.attributes.productType.evidence.some(item => item.rule === 'explicit_garment_with_catalog_evidence')
        && (known?.has('POLO_SHIRT') || name!.sourceTypes.has('POLO') || name!.sourceAlternatives.has('POLO'))
      if (explicitTshirtPolo) {
        evidence.push({ field, source: 'product_name', requested: String(value), actual: row.productName })
        return 'yes'
      }
      if (known?.has(value)) {
        evidence.push({ field, source: 'product_name', requested: String(value), actual: row.productName })
        return 'yes'
      }
      if (known?.size) return 'no'
      if (field === 'productType' && name!.categoryType !== null) {
        if (name!.categoryType !== value) return 'no'
        evidence.push({ field, source: 'category_name', requested: String(value), actual: row.categoryName })
        return 'yes'
      }
      return 'unknown'
    }
    let rejected = false
    for(const p of patternConstraints.filter(p=>p.result.patterns.length)){
      const supported=p.result.patterns.filter(id=>name!.patterns.has(id))
      if(p.role==='descriptor'&&supported.length===1){
        const id=supported[0],origin=name.patterns.get(id)!;rowSpokenAtoms.add(`patternSource:${id}`)
        tokenizeText(p.text).forEach(w=>rowSpokenAtoms.add(wordAtom(w)))
        evidence.push({field:'pattern',source:origin,requested:id,actual:origin==='product_name'?row.productName:row.categoryName})
      }else unresolved.add('pattern')
    }
    for(const p of patternConstraints.filter(p=>p.result.modifiers.length)){
      const target=patternConstraints.find(t=>t.startToken===p.modifierTarget?.startToken&&t.endToken===p.modifierTarget.endToken)
      const supported=target?.result.patterns.filter(id=>name!.patterns.has(id))??[],key=supported.length===1&&p.result.modifiers.length===1?`${supported[0]}:${p.result.modifiers[0]}`:null
      if(key&&name.patternModifiers.has(key)){const origin=name.patternModifiers.get(key)!;rowSpokenAtoms.add(`patternModifier:${key}`);tokenizeText(p.text).forEach(w=>rowSpokenAtoms.add(wordAtom(w)));evidence.push({field:'pattern',source:origin,requested:key,actual:origin==='product_name'?row.productName:row.categoryName})}
      else unresolved.add('pattern')
    }
    for (const constraint of fitConstraints.filter(c=>c.result.styles.length)) {
      const supported=constraint.result.styles.filter(id=>name!.fitCuts.has(id))
      // A foreign-domain ambiguous role needs an explicit cut cue, not stock/price to disambiguate it.
      if (constraint.constrainsCatalog && supported.length===1) {
        const id=supported[0],origin=name.fitCuts.get(id)!
        rowSpokenAtoms.add(`fitCut:${id}`)
        tokenizeText(constraint.text).forEach(word=>rowSpokenAtoms.add(wordAtom(word)))
        evidence.push({field:'fit',source:origin,requested:`${fitCutConcept(id).group}:${id}`,
          actual:origin==='product_name'?row.productName:row.categoryName})
      } else if (!supported.length && constraint.result.styles.length===1 && constraint.constrainsCatalog
        && [...name.fitCuts.keys()].some(id=>fitCutConcept(id).group===fitCutConcept(constraint.result.styles[0]).group)) {
        rejected=true;break
      } else unresolved.add('fit')
    }
    if (rejected) continue
    for (const constraint of fitConstraints.filter(c=>c.result.modifiers.length)) {
      const target=fitConstraints.find(c=>c.startToken===constraint.modifierTarget?.startToken&&c.endToken===constraint.modifierTarget.endToken)
      const supported=target?.result.styles.filter(id=>name!.fitCuts.has(id))??[]
      const key=supported.length===1&&constraint.result.modifiers.length===1?`${supported[0]}:${constraint.result.modifiers[0]}`:null
      if (key&&name.fitModifiers.has(key)) {
        const origin=name.fitModifiers.get(key)!
        rowSpokenAtoms.add(`fitModifier:${key}`)
        tokenizeText(constraint.text).forEach(word=>rowSpokenAtoms.add(wordAtom(word)))
        evidence.push({field:'fit',source:origin,requested:key,actual:origin==='product_name'?row.productName:row.categoryName})
      } else unresolved.add('fit')
    }
    for (const constraint of neckConstraints) {
      const styles = [...constraint.result.shapes, ...constraint.result.collars]
      const supported = styles.filter(id => name!.necklineStyles.has(id))
      const modifiers = constraint.result.modifiers.filter(id => name!.necklineModifiers.has(id))
      if (supported.length + modifiers.length === 1) {
        const id = supported[0] ?? modifiers[0]
        rowSpokenAtoms.add(`necklineSource:${id}`)
        tokenizeText(constraint.text).forEach(word => rowSpokenAtoms.add(wordAtom(word)))
        evidence.push({ field: 'neckline', source: 'product_name', requested: id, actual: row.productName })
      } else if (styles.length && name.necklineStyles.size && !supported.length && !constraint.result.modifiers.length) {
        const groupKnown = styles.some(id => [...name!.necklineStyles].some(actual => actual.startsWith('NECK_') === id.startsWith('NECK_')))
        if (groupKnown) { rejected = true; break }
        unresolved.add('neckline')
      } else unresolved.add('neckline')
    }
    if (rejected) continue
    for (const constraint of materialConstraints) {
      const supported = constraint.result.fabrics.filter(id => name!.materials.has(id))
      const modifiers = constraint.result.modifiers.filter(id => name!.materialModifiers.has(id))
      const proofCount = supported.length + modifiers.length
      const specificationRequired = supported.some(materialNeedsSpecification)
        || modifiers.some(id => ['ORGANIC', 'RECYCLED', 'NATURAL', 'PURE', 'MOISTURE_WICKING', 'WATERPROOF', 'WATER_REPELLENT', 'WINDPROOF', 'BREATHABLE'].includes(id))
      // A printed descriptor is lexical evidence, never a certificate or composition record.
      if (proofCount === 1 && !specificationRequired && !parser.materialComposition?.length) {
        const id = supported[0] ?? modifiers[0]
        const origin = supported.length ? name.materials.get(supported[0])! : name.materialModifiers.get(modifiers[0])!
        rowSpokenAtoms.add(supported.length ? `fabric:${id}` : `fabricModifier:${id}`)
        tokenizeText(constraint.text).forEach(word => rowSpokenAtoms.add(wordAtom(word)))
        evidence.push({ field: 'material', source: origin, requested: id,
          actual: origin === 'product_name' ? row.productName : row.categoryName })
        // A source subtype such as Satin Dress can be described by the independently
        // stored Dress category plus an exact Satin descriptor. Cover the compound
        // atom only when removing the verified material span leaves that exact category.
        for (const compound of name.materialCompounds) {
          if (compound.descriptor === id && sourceConstraints.some(c => c.result.candidates.some(p => p.sourceTypeId === compound.garment))) {
            rowSpokenAtoms.add(sourceAtom(compound.parent))
          }
        }
      } else if (constraint.result.fabrics.length && !proofCount && name.materials.size
        && !constraint.result.modifiers.length) { rejected = true; break }
      else unresolved.add('material')
    }
    if (rejected) continue
    for (const constraint of sizeConstraints) {
      const state = compareSourceSize(constraint, row.size, name.sizeContext)
      if (state === 'no') { rejected = true; break }
      if (state === 'unknown') unresolved.add('size')
      else {
        evidence.push({ field: 'size', source: 'variant_column', requested: constraint.resolvedId ?? constraint.phrase, actual: row.size })
        const legacy = variantValue('size', row.size)
        if (legacy) rowSpokenAtoms.add(atom('size', legacy))
      }
    }
    if (rejected) continue
    for (const constraint of colorConstraints) {
      const actual = row.color === null ? null : activeColors.lookup(row.color)
      const supported = actual?.candidates.filter(id => constraint.result.candidates.includes(id)) ?? []
      if (actual && actual.status !== 'deferred' && actual.status !== 'unknown' && actual.candidates.length === 1 && supported.length === 1) {
        evidence.push({ field: 'color', source: 'variant_column', requested: supported[0], actual: row.color })
        // Preserve legacy color atoms in real names (Tshirt Black). Only the
        // independently verified exact stored shade supplies this identity proof.
        if (actual.legacyColor) rowSpokenAtoms.add(atom('color', actual.legacyColor))
      } else if (actual && actual.candidates.length && !supported.length) { rejected = true; break }
      else unresolved.add('color')
    }
    if (rejected) continue
    for (const constraint of sourceConstraints) {
      const ids = constraint.result.candidates.map(candidate => candidate.sourceTypeId)
      const supported = ids.filter(id => name!.sourceTypes.has(id))
      const contextualPolo = parser.attributes.productType.evidence.some(item => item.rule === 'explicit_garment_with_catalog_evidence')
        && ids.includes('POLO') && name.sourceAlternatives.has('POLO') ? ['POLO' as const] : []
      const verified = supported.length === 1 ? supported : contextualPolo
      if (verified.length === 1) {
        const source = name.sourceProof.get(verified[0]) ?? 'product_name'
        evidence.push({ field: 'productType', source, requested: verified[0],
          actual: source === 'category_name' ? row.categoryName : row.productName })
        // Resolve only this alias span from independent, definite catalog evidence.
        // Ambiguous words in the name remain literal requirements for identity.
        tokenizeText(constraint.phrase).forEach(word => rowSpokenAtoms.add(wordAtom(word)))
        for (const id of verified) rowSpokenAtoms.add(sourceAtom(id))
      } else if (name.sourceTypes.size && !supported.length) { rejected = true; break }
      else if (name.sourceAlternatives.size && !ids.some(id => name!.sourceAlternatives.has(id))) { rejected = true; break }
      else unresolved.add('productType')
    }
    if (rejected) continue
    for (const constraint of guaranteed) {
      const state = verify(constraint.field, constraint.value)
      if (state === 'no') { rejected = true; break }
      if (state === 'unknown') unresolved.add(constraint.field)
    }
    if (rejected) continue
    for (const issue of lexicalIssues) {
      if(patternConstraints.some(p=>p.startToken<=issue.span.startToken&&p.endToken>=issue.span.endToken))continue
      if (fitConstraints.some(match=>match.startToken<=issue.span.startToken&&match.endToken>=issue.span.endToken)) continue
      if (neckConstraints.some(match => match.startToken <= issue.span.startToken && match.endToken >= issue.span.endToken)) continue
      if (materialConstraints.some(match => match.startToken <= issue.span.startToken && match.endToken >= issue.span.endToken)) continue
      if (sizeConstraints.some(match => match.startToken === issue.span.startToken && match.endToken === issue.span.endToken)) continue
      if (colorConstraints.some(match => match.startToken === issue.span.startToken && match.endToken === issue.span.endToken)) continue
      if (sourceConstraints.some(match => match.startToken === issue.span.startToken
        && match.endToken === issue.span.endToken)) continue
      const explicitTshirtPoloIdentity = parser.attributes.productType.evidence
        .some(item => item.rule === 'explicit_garment_with_catalog_evidence')
        && issue.alternatives.some(alternative => alternative.field === 'productType' && alternative.value === 'POLO_SHIRT')
        && name.sourceAlternatives.has('POLO')
      if (explicitTshirtPoloIdentity) {
        evidence.push({ field: 'product_name', source: 'literal_product_name', requested: issue.span.text,
          actual: row.productName })
        continue
      }
      // Exact literal catalog-name evidence can identify the real product without
      // inventing which grammatical interpretation of Body/Polo/etc was intended.
      if (containsPhrase(name.tokens, issue.span.text)) {
        evidence.push({ field: 'product_name', source: 'literal_product_name', requested: issue.span.text, actual: row.productName })
        continue
      }
      const states = issue.alternatives.map(alternative => verify(alternative.field, alternative.value))
      if (states.includes('yes')) continue
      if (states.length && states.every(state => state === 'no')) { rejected = true; break }
      issue.fields.forEach(field => unresolved.add(field))
    }
    if (rejected) continue
    // Attribute order may vary, but unknown brand/model words retain their order
    // and multiplicity. A bag of words is not sufficient proof of a real name.
    const semanticNameIds = residualSourceIds.filter(id => name.sourceTypes.has(id) || name.sourceAlternatives.has(id))
    for (const id of semanticNameIds) {
      rowSpokenAtoms.add(sourceAtom(id))
      for (const match of activeProductTypes.matchTokens(row.productName)) {
        if (match.result.candidates.some(candidate => candidate.sourceTypeId === id)) {
          tokenizeText(match.phrase).forEach(word => rowSpokenAtoms.add(wordAtom(word)))
        }
      }
    }
    const requestedIdentities = new Set([normalizeText(unknownWords.join(' ')), parser.normalizedText].filter(Boolean))
    const skuExact = requestedIdentities.has(normalizeText(row.sku))
    const barcodeExact = row.barcode !== null && row.barcode !== undefined
      && requestedIdentities.has(normalizeText(row.barcode))
    const requestedIdentity = skuExact ? normalizeText(row.sku) : barcodeExact ? normalizeText(row.barcode!)
      : normalizeText(unknownWords.join(' '))
    const identifierSource = skuExact ? 'sku' as const : barcodeExact ? 'barcode' as const : null
    const wordsExact = identifierSource !== null || containsOrderedWords(name.tokens, unknownWords) || semanticNameIds.length === 1
    const wordsPartial = unknownWords.length > 0 && unknownWords.every(word =>
      name!.tokens.includes(word) || word.length >= 3 && name!.tokens.some(actual => actual.startsWith(word)))
    if (!wordsExact && !wordsPartial) continue
    const identityComplete = identifierSource !== null || wordsExact && [...name.atoms].every(key => rowSpokenAtoms.has(key))
    const missing: MissingMatchField[] = []
    if (!identityComplete) missing.push('product_name')
    if (quantity === null) missing.push('quantity')
    if (row.color !== null && parser.attributes.color.status === 'missing'
      && !colorConstraints.length) missing.push('color')
    if (row.size !== null && parser.attributes.size.status === 'missing' && !sizeConstraints.length) missing.push('size')
    if (row.sellingPrice === null || new Prisma.Decimal(row.sellingPrice).lte(0)) missing.push('selling_price')
    missing.push(...unresolved)
    evidence.push({ field: 'product_name', source: identifierSource ?? (wordsExact ? 'product_name' : 'partial_name_suggestion'),
      requested: identifierSource ? requestedIdentity : parser.normalizedText,
      actual: identifierSource === 'sku' ? row.sku : identifierSource === 'barcode' ? row.barcode! : row.productName })
    const candidate: VoiceMatchCandidate = Object.freeze({
      // Explicit allowlist: no sensitive/internal catalog fields can leak through a mock/repository.
      productId: row.productId, variantId: row.variantId, categoryId: row.categoryId,
      sku: row.sku, barcode: row.barcode, productName: row.productName,
      categoryName: row.categoryName, color: row.color, size: row.size, sellingPrice: row.sellingPrice,
      availableStock: row.availableStock, currency: row.currency, quantity,
      missingFields: Object.freeze([...new Set(missing)]), unresolvedConstraints: Object.freeze([...unresolved]),
      evidence: Object.freeze(evidence.map(item => Object.freeze(item))), requiresConfirmation: true,
    })
    if (!wordsExact) partial.push(candidate)
    else if (identityComplete) exact.push(candidate)
    else broad.push(candidate)
  }
  const candidates = exact.length ? exact : broad
  const missing = new Set<MissingMatchField>(candidates.flatMap(candidate => candidate.missingFields))
  if (catalog.truncated) missing.add('catalog_coverage')
  const suggestions = [...(exact.length ? broad : []), ...partial].slice(0, MAX_MATCH_SUGGESTIONS)
  let status: VoiceSaleMatchResult['status']
  let reason: string
  let match: VoiceMatchCandidate | null = null
  if (catalog.truncated) { status = 'INCOMPLETE'; reason = 'CATALOG_COVERAGE_LIMIT' }
  else if (!candidates.length) { status = 'NOT_FOUND'; reason = 'NO_ELIGIBLE_EXACT_MATCH' }
  else if (candidates.length > 1) {
    status = 'AMBIGUOUS'; reason = 'MULTIPLE_PLAUSIBLE_VARIANTS'; missing.add('variant')
  }
  else if (missing.size) { status = 'INCOMPLETE'; reason = 'MISSING_OR_UNVERIFIED_CONSTRAINTS' }
  else {
    match = candidates[0]
    status = quantity! > match.availableStock ? 'INSUFFICIENT_STOCK' : 'MATCHED'
    reason = status === 'MATCHED' ? 'UNIQUE_SUPPORTED_CATALOG_MATCH' : 'REQUESTED_QUANTITY_EXCEEDS_STOCK'
  }
  return Object.freeze({ status, reason, parser, match,
    candidates: Object.freeze(candidates.slice(0, MAX_MATCH_CANDIDATES)), suggestions: Object.freeze(suggestions),
    missingFields: Object.freeze([...missing]), requiresConfirmation: true,
    catalog: Object.freeze({ scannedVariants: catalog.scannedVariants, truncated: catalog.truncated,
      candidateCount: candidates.length, candidatesTruncated: candidates.length > MAX_MATCH_CANDIDATES }),
  })
}

const MAX_DISCOVERY_RESULTS_PER_TIER = 20

/**
 * Bounded, read-only product discovery. This deliberately does not influence
 * strict match status: explicit differences remain visible alternatives and
 * missing attributes continue to block cart confirmation.
 */
export function discoverParsedCatalog(
  parser: VoiceSaleParseResult,
  catalog: CatalogSnapshot,
  strict: VoiceSaleMatchResult,
): VoiceCatalogDiscovery {
  const searchIndex = buildTenantCatalogSearchIndex(catalog)
  const categoryResolution = resolveCatalogCategories(parser, searchIndex)
  const categoryKeys = new Set(categoryResolution.candidates.map(candidate => candidate.categoryId
    ? `id:${candidate.categoryId}` : `name:${normalizeText(candidate.categoryName)}`))
  const strictCandidates = new Map<string, VoiceMatchCandidate>()
  for (const candidate of [strict.match, ...strict.candidates, ...strict.suggestions]) {
    if (candidate) strictCandidates.set(candidate.variantId, candidate)
  }
  const words = parser.productNameResidualTokens.map(row => row.token)
  const requestedNameConcepts = words.length ? activeProductTypes.lookup(words.join(' ')).candidates
    .map(candidate => candidate.sourceTypeId) : []
  const requestedType = parser.attributes.productType.status === 'resolved' ? parser.attributes.productType.value : null
  const requestedSourceType = parser.sourceProductType?.status === 'resolved' ? parser.sourceProductType.value : null
  const requestedColor = parser.attributes.color.status === 'resolved' ? parser.attributes.color.value : null
  const requestedSize = parser.attributes.size.status === 'resolved' ? parser.attributes.size.value : null
  const quantity = parser.attributes.quantity.status === 'resolved' && parser.attributes.quantity.source === 'explicit'
    ? parser.attributes.quantity.value : null
  const descriptorFields = (['material', 'neckline', 'fit', 'pattern'] as const)
    .filter(field => parser.attributes[field].status !== 'missing')
  const ranked: { candidate: VoiceDiscoveryCandidate; score: readonly number[] }[] = []

  for (const row of catalog.variants) {
    const name = profile(row)
    const matched = new Set<CatalogEvidenceField>()
    const unverified = new Set<CatalogEvidenceField>()
    const differences: { field: CatalogEvidenceField; requested: string; actual: string | null }[] = []
    let productIdentityEvidence = 0
    let categoryEvidence = 0
    const rowCategoryKey = row.categoryId ? `id:${row.categoryId}` : `name:${normalizeText(row.categoryName)}`
    const categoryMatched = categoryKeys.has(rowCategoryKey)
    if (categoryMatched) { matched.add('category'); categoryEvidence = 4 }

    if (requestedType !== null) {
      const known = name.values.get('productType')
      const explicitTshirtPolo = requestedType === 'T_SHIRT'
        && parser.attributes.productType.evidence.some(item => item.rule === 'explicit_garment_with_catalog_evidence')
        && (known?.has('POLO_SHIRT') || name.sourceTypes.has('POLO') || name.sourceAlternatives.has('POLO'))
      if (known?.has(requestedType) || name.categoryType === requestedType || explicitTshirtPolo || categoryMatched) {
        matched.add('productType')
        if (known?.has(requestedType) || explicitTshirtPolo) productIdentityEvidence += 4
        else categoryEvidence = Math.max(categoryEvidence, 4)
      } else if (known?.size || name.categoryType !== null) {
        differences.push({ field: 'productType', requested: String(requestedType), actual: row.productName })
      } else unverified.add('productType')
    }
    if (requestedSourceType !== null) {
      if (name.sourceTypes.has(requestedSourceType) || name.sourceAlternatives.has(requestedSourceType)) {
        matched.add('productType')
        if (name.sourceProof.get(requestedSourceType) === 'category_name') categoryEvidence = Math.max(categoryEvidence, 4)
        else productIdentityEvidence += 4
      } else if (name.sourceTypes.size) {
        differences.push({ field: 'productType', requested: requestedSourceType, actual: row.productName })
      } else unverified.add('productType')
    }

    const requestedIdentities = new Set([normalizeText(words.join(' ')), parser.normalizedText].filter(Boolean))
    const skuExact = requestedIdentities.has(normalizeText(row.sku))
    const barcodeExact = row.barcode !== null && row.barcode !== undefined
      && requestedIdentities.has(normalizeText(row.barcode))
    const exactName = words.length > 0 && (skuExact || barcodeExact || containsOrderedWords(name.tokens, words)
      || requestedNameConcepts.filter(id => name.sourceTypes.has(id) || name.sourceAlternatives.has(id)).length === 1)
    const partialName = words.length > 0 && words.every(word => name.tokens.some(token => token.startsWith(word)))
    if (exactName) { matched.add('product_name'); productIdentityEvidence += skuExact || barcodeExact ? 10 : 6 }
    else if (partialName) { unverified.add('product_name'); productIdentityEvidence += 2 }
    else if (words.length) differences.push({ field: 'product_name', requested: words.join(' '), actual: row.productName })

    // Strict matching may resolve a legacy/source ambiguity from independent
    // catalog evidence even when the aggregate parser slot stays ambiguous.
    // Preserve that verified candidate in discovery rather than dropping it.
    if (productIdentityEvidence + categoryEvidence === 0 && strictCandidates.has(row.variantId)) {
      matched.add('product_name')
      productIdentityEvidence = 8
    }

    // Do not turn an unrestricted catalog scan into discovery. A row must have
    // product/type evidence from the parsed request before it can be ranked.
    if (productIdentityEvidence + categoryEvidence === 0) continue

    if (requestedColor !== null) {
      const actual = variantValue('color', row.color)
      if (actual === requestedColor) matched.add('color')
      else if (actual === null) unverified.add('color')
      else differences.push({ field: 'color', requested: String(requestedColor), actual: row.color })
    } else if (row.color !== null) unverified.add('color')

    if (requestedSize !== null) {
      const actual = variantValue('size', row.size)
      if (actual === requestedSize) matched.add('size')
      else if (actual === null) unverified.add('size')
      else differences.push({ field: 'size', requested: String(requestedSize), actual: row.size })
    } else if (row.size !== null) unverified.add('size')

    if (quantity === null) unverified.add('quantity')
    const existing = strictCandidates.get(row.variantId)
    if (existing) {
      existing.evidence.forEach(item => matched.add(item.field))
      existing.unresolvedConstraints.forEach(field => unverified.add(field))
    }
    descriptorFields.forEach(field => { if (!matched.has(field)) unverified.add(field) })
    const missing: MissingMatchField[] = existing ? [...existing.missingFields] : [
      ...(words.length && !exactName ? ['product_name' as const] : []),
      ...(quantity === null ? ['quantity' as const] : []),
      ...(requestedColor === null && row.color !== null ? ['color' as const] : []),
      ...(requestedSize === null && row.size !== null ? ['size' as const] : []),
      ...(row.sellingPrice === null ? ['selling_price' as const] : []),
    ]
    const completeStrict = Boolean(existing && existing.missingFields.length === 0
      && existing.unresolvedConstraints.length === 0 && quantity !== null)
    const tier = differences.length ? 'ALTERNATIVE' as const
      : completeStrict ? 'EXACT_VERIFIED' as const : 'STRONG_CANDIDATE' as const
    const candidate: VoiceDiscoveryCandidate = Object.freeze({
      productId: row.productId, variantId: row.variantId, categoryId: row.categoryId,
      sku: row.sku, barcode: row.barcode, productName: row.productName,
      categoryName: row.categoryName, color: row.color, size: row.size, sellingPrice: row.sellingPrice,
      availableStock: row.availableStock, currency: row.currency, quantity,
      imageUrl: existing?.imageUrl ?? null,
      evidence: existing?.evidence ?? Object.freeze([]),
      missingFields: Object.freeze([...new Set(missing)]),
      unresolvedConstraints: existing?.unresolvedConstraints ?? Object.freeze([]),
      requiresConfirmation: true, tier,
      matchedAttributes: Object.freeze([...matched]),
      unverifiedAttributes: Object.freeze([...unverified]),
      differences: Object.freeze(differences.map(item => Object.freeze(item))),
    })
    const stockSufficient = quantity !== null && row.availableStock >= quantity ? 1 : 0
    const verifiedVariantAttributes = Number(matched.has('color')) + Number(matched.has('size'))
    const verifiedDescriptors = descriptorFields.filter(field => matched.has(field)).length
    ranked.push({ candidate, score: [tier === 'EXACT_VERIFIED' ? 3 : tier === 'STRONG_CANDIDATE' ? 2 : 1,
      productIdentityEvidence, categoryEvidence, verifiedVariantAttributes, verifiedDescriptors,
      -differences.length, stockSufficient, row.availableStock] })
  }

  ranked.sort((left, right) => {
    for (let index = 0; index < left.score.length; index++) {
      if (left.score[index] !== right.score[index]) return right.score[index] - left.score[index]
    }
    return left.candidate.productName.localeCompare(right.candidate.productName)
      || left.candidate.sku.localeCompare(right.candidate.sku)
      || left.candidate.variantId.localeCompare(right.candidate.variantId)
  })
  const tier = (value: VoiceDiscoveryCandidate['tier']) => Object.freeze(ranked.filter(row => row.candidate.tier === value)
    .slice(0, MAX_DISCOVERY_RESULTS_PER_TIER).map(row => row.candidate))
  const exactVerified = tier('EXACT_VERIFIED')
  const strongCandidates = tier('STRONG_CANDIDATE')
  const alternatives = tier('ALTERNATIVE')
  return Object.freeze({ exactVerified, strongCandidates, alternatives, categoryResolution,
    requiresClarification: strict.status !== 'MATCHED' })
}
