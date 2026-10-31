import { colors } from './dictionaries/colors.js'
import { expressions } from './dictionaries/expressions.js'
import { fits } from './dictionaries/fits.js'
import { materials } from './dictionaries/materials.js'
import { necklines } from './dictionaries/necklines.js'
import { patterns } from './dictionaries/patterns.js'
import { productTypes } from './dictionaries/product-types.js'
import { quantities } from './dictionaries/quantities.js'
import { sizes } from './dictionaries/sizes.js'
import { matchLongestAliases } from './dictionary.js'
import { normalizeText, tokenizeText } from './normalization.js'
import { createProductTypeSourceIndex } from './product-type-source.js'
import { createActiveProductTypeRegistry } from './product-type-registry.js'
import { createActiveColorRegistry } from './color-source.js'
import { createActiveSizeRegistry } from './size-source.js'
import { createActiveQuantityRegistry } from './quantity-source.js'
import { createActiveMaterialRegistry } from './material-source.js'
import { createActiveNecklineRegistry } from './neckline-source.js'
import { createCommonExpressionRegistry } from './common-expression-source.js'
import { createFitCutRegistry } from './fit-cut-source.js'
import { createPatternRegistry } from './pattern-source.js'
import type { AnyKnownResult, Dictionary, DictionaryDomain, TokenMatch } from './dictionary.types.js'

export { colors, expressions, fits, materials, necklines, patterns, productTypes, quantities, sizes }
export { createDictionary, DictionaryAliasError } from './dictionary.js'
export { normalizeText, tokenizeText } from './normalization.js'
export type * from './dictionary.types.js'
export type * from './product-type-source.types.js'
export type { SourceProductTypeId } from './product-type-source-ids.js'
export type { SourceColorId } from './color-source-ids.js'
export type * from './color-source.types.js'
export { colorSourceResource, colorSourceCollisions } from './color-source.js'
export type { SourceSizeId, SizeFamily } from './size-source-ids.js'
export type * from './size-source.types.js'
export type * from './quantity-source.types.js'
export type * from './material-source.types.js'
export type * from './material-source-ids.js'
export type * from './neckline-source-ids.js'
export type * from './neckline-source.types.js'
export type * from './common-expression.types.js'
export type * from './common-expression-ids.js'
export * from './request-intent.js'
export type * from './fit-cut-ids.js'
export type * from './fit-cut.types.js'
export type * from './pattern-ids.js'
export type * from './pattern.types.js'
export { patternSource, patternSourceCollisions } from './pattern-source.js'
export { fitCutSource, fitCutSourceCollisions } from './fit-cut-source.js'
export { commonExpressionSource, commonExpressionCollisions, commonExpressionAmbiguities } from './common-expression-source.js'
export { necklineSourceResource, necklineSourceCollisions } from './neckline-source.js'
export { materialSourceResource, materialSourceCollisions } from './material-source.js'
export { quantitySourceResource, quantitySourceCollisions } from './quantity-source.js'
export { sizeSourceResource, sizeSourceCollisions, normalizeSizeText } from './size-source.js'
export { productTypeCompatibility, productTypeSourceResource, productTypeSourceAmbiguities } from './product-type-source.js'

export const dictionaries = Object.freeze({
  productTypes, colors, sizes, materials, necklines, fits, patterns, quantities, expressions,
} satisfies { [D in DictionaryDomain]: Dictionary<D> })

/** Separate seed-review candidate index; it never upgrades aliases in trusted dictionaries. */
export const productTypeSource = createProductTypeSourceIndex(dictionaries)
export const activeProductTypes = createActiveProductTypeRegistry(productTypeSource, productTypes)
export const activeColors = createActiveColorRegistry(dictionaries, activeProductTypes)
export const activeSizes = createActiveSizeRegistry(dictionaries, activeProductTypes, activeColors)
export const activeQuantities = createActiveQuantityRegistry(alias => {
  const domains = Object.entries(dictionaries).filter(([domain, dictionary]) => domain !== 'quantities'
    && dictionary.lookup(alias).status !== 'unknown').map(([domain]) => domain)
  if (activeProductTypes.lookup(alias).candidates.length) domains.push('sourceProductTypes')
  if (activeColors.lookup(alias).candidates.length) domains.push('sourceColors')
  if (activeSizes.lookup(alias).candidates.length) domains.push('sourceSizes')
  return [...new Set(domains)]
})
export const activeMaterials = createActiveMaterialRegistry(alias => {
  const domains = Object.entries(dictionaries).filter(([, dictionary]) => dictionary.lookup(alias).status !== 'unknown')
    .map(([domain]) => domain)
  if (activeProductTypes.lookup(alias).candidates.length) domains.push('sourceProductTypes')
  if (activeColors.lookup(alias).candidates.length) domains.push('sourceColors')
  if (activeSizes.lookup(alias).candidates.length) domains.push('sourceSizes')
  for (const group of ['number_aliases', 'unit_aliases', 'direct_phrases', 'modifier_aliases'] as const) {
    if (activeQuantities.lookup(group, alias).length) domains.push(`sourceQuantities:${group}`)
  }
  return domains
})
export const activeNecklines = createActiveNecklineRegistry(alias => {
  const domains = Object.entries(dictionaries).filter(([, dictionary]) => dictionary.lookup(alias).status !== 'unknown').map(([domain]) => domain)
  if (activeProductTypes.lookup(alias).candidates.length) domains.push('sourceProductTypes')
  if (activeColors.lookup(alias).candidates.length) domains.push('sourceColors')
  if (activeSizes.lookup(alias).candidates.length) domains.push('sourceSizes')
  for (const group of ['number_aliases', 'unit_aliases', 'direct_phrases', 'modifier_aliases'] as const) {
    if (activeQuantities.lookup(group, alias).length) domains.push(`sourceQuantities:${group}`)
  }
  if (activeMaterials.lookup(alias).status !== 'unknown') domains.push('sourceMaterials')
  return domains
})

export const activeCommonExpressions = createCommonExpressionRegistry(alias => {
  const domains = Object.entries(dictionaries).filter(([domain, dictionary]) => domain !== 'expressions'
    && dictionary.lookup(alias).status !== 'unknown').map(([domain]) => domain)
  const legacyExpression = expressions.lookup(alias)
  if (!(legacyExpression.status === 'matched' && legacyExpression.value === 'WANT')
    && ['candidate', 'ambiguous'].includes(activeProductTypes.lookup(alias).status)) domains.push('sourceProductTypes')
  if (activeColors.lookup(alias).candidates.length) domains.push('sourceColors')
  if (activeSizes.lookup(alias).candidates.length) domains.push('sourceSizes')
  for (const group of ['number_aliases', 'unit_aliases', 'direct_phrases', 'modifier_aliases'] as const) {
    if (activeQuantities.lookup(group, alias).length) domains.push(`sourceQuantities:${group}`)
  }
  if (activeMaterials.lookup(alias).status !== 'unknown') domains.push('sourceMaterials')
  if (activeNecklines.lookup(alias).status !== 'unknown') domains.push('sourceNecklines')
  return domains
})

/** Additive, contextual descriptors; existing dictionary canonical IDs stay unchanged. */
export const activeFitCuts = createFitCutRegistry(alias => {
  const domains = Object.entries(dictionaries).filter(([domain, dictionary]) => domain !== 'fits'
    && dictionary.lookup(alias).status !== 'unknown').map(([domain]) => domain)
  if (activeProductTypes.lookup(alias).candidates.length) domains.push('sourceProductTypes')
  if (activeColors.lookup(alias).candidates.length) domains.push('sourceColors')
  if (activeSizes.lookup(alias).candidates.length) domains.push('sourceSizes')
  for (const group of ['number_aliases', 'unit_aliases', 'direct_phrases', 'modifier_aliases'] as const) {
    if (activeQuantities.lookup(group, alias).length) domains.push(`sourceQuantities:${group}`)
  }
  if (activeMaterials.lookup(alias).status !== 'unknown') domains.push('sourceMaterials')
  if (activeNecklines.lookup(alias).status !== 'unknown') domains.push('sourceNecklines')
  if (activeCommonExpressions.lookup(alias).status !== 'unknown') domains.push('sourceExpressions')
  return domains
})

export const activePatterns = createPatternRegistry(alias => {
  const domains=Object.entries(dictionaries).filter(([domain,dictionary])=>domain!=='patterns'&&dictionary.lookup(alias).status!=='unknown').map(([domain])=>domain)
  if(activeProductTypes.lookup(alias).candidates.length)domains.push('sourceProductTypes')
  if(activeColors.lookup(alias).candidates.length)domains.push('sourceColors')
  if(activeSizes.lookup(alias).candidates.length)domains.push('sourceSizes')
  for(const group of ['number_aliases','unit_aliases','direct_phrases','modifier_aliases'] as const)if(activeQuantities.lookup(group,alias).length)domains.push(`sourceQuantities:${group}`)
  if(activeMaterials.lookup(alias).status!=='unknown')domains.push('sourceMaterials')
  if(activeNecklines.lookup(alias).status!=='unknown')domains.push('sourceNecklines')
  if(activeCommonExpressions.lookup(alias).status!=='unknown')domains.push('sourceExpressions')
  if(activeFitCuts.lookup(alias).status!=='unknown')domains.push('sourceFitCuts')
  return domains
})

/** Preserve legacy qualified material meaning alongside the additive source concept. */
export function decomposeQualifiedProductAlias(text: string) {
  const product = productTypes.lookup(text)
  if (product.status !== 'matched') return undefined
  const tokens = tokenizeText(text)
  for (let split = 1; split < tokens.length; split++) {
    const prefix = productTypes.lookup(tokens.slice(0, split).join(' '))
    const suffix = materials.lookup(tokens.slice(split).join(' '))
    if (prefix.status === 'ambiguous' && prefix.candidates.includes(product.value) && suffix.status === 'matched') {
      return Object.freeze({ productType: product.value, material: suffix.value, splitToken: split })
    }
  }
  return undefined
}

export interface VocabularyLookup {
  readonly status: 'matched' | 'ambiguous' | 'suggestion' | 'unknown'
  readonly alias: string
  /** Never choose a domain automatically: every candidate remains visible. */
  readonly hits: readonly AnyKnownResult[]
}

export function lookupVocabulary(text: string): VocabularyLookup {
  const alias = normalizeText(text)
  const hits: AnyKnownResult[] = []
  for (const dictionary of Object.values(dictionaries)) {
    const result = dictionary.lookup(alias)
    if (result.status !== 'unknown') hits.push(result)
  }
  const status = hits.length === 0 ? 'unknown'
    : hits.length > 1 || hits.some(hit => hit.status === 'ambiguous') ? 'ambiguous'
    : hits[0].status
  return Object.freeze({ status, alias, hits: Object.freeze(hits) })
}

const maxAliasTokens = Math.max(...Object.values(dictionaries).map(dictionary => dictionary.maxAliasTokens))

export function matchVocabularyTokens(text: string): readonly TokenMatch<VocabularyLookup>[] {
  return matchLongestAliases(text, maxAliasTokens, phrase => {
    const result = lookupVocabulary(phrase)
    return result.status === 'unknown' ? undefined : result
  })
}

export function getDictionaryCoverage() {
  return Object.freeze(Object.values(dictionaries).map(dictionary => Object.freeze({
    domain: dictionary.domain, ...dictionary.coverage,
  })))
}
