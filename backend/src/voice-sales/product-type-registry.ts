import { matchLongestAliases } from './dictionary.js'
import { normalizeText } from './normalization.js'
import type { Dictionary, ProductType } from './dictionary.types.js'
import { productTypeCompatibility, productTypeSourceResource } from './product-type-source.js'
import type { createProductTypeSourceIndex } from './product-type-source.js'
import type { SourceProductTypeId } from './product-type-source-ids.js'
import type { SourceProductCandidate, SourceProductLookup } from './product-type-source.types.js'

/** User-authorized LANGUAGE vocabulary. Recognition never identifies a real variant by itself. */
export function createActiveProductTypeRegistry(source: ReturnType<typeof createProductTypeSourceIndex>, legacy: Dictionary<'productTypes'>) {
  const concepts = new Map(productTypeSourceResource.productTypes.map(concept => [concept.id, concept]))
  const reverse = new Map<ProductType, SourceProductTypeId>(Object.entries(productTypeCompatibility)
    .map(([sourceId, canonical]) => [canonical, sourceId as SourceProductTypeId]))
  const inheritedLookup = (text: string): SourceProductLookup => {
    const hit = source.lookup(text)
    const previous = legacy.lookup(text)
    if (hit.status !== 'unknown' && (hit.status !== 'candidate' || previous.status !== 'ambiguous')) return hit
    if (previous.status === 'unknown' || previous.status === 'suggestion') return hit
    const values = previous.status === 'matched' ? [previous.value] : previous.candidates
    const candidates: SourceProductCandidate[] = values.flatMap(canonical => {
      const id = reverse.get(canonical)
      if (!id) return []
      const concept = concepts.get(id)!
      return [Object.freeze({ sourceTypeId: id, canonicalType: canonical, labels: concept.labels,
        group: concept.group, audienceHint: concept.audienceHint, matchPolicy: 'exact_candidate' as const,
        reviewStatus: 'seed_review' as const, aliases: Object.freeze([]) })]
    })
    const merged = [...hit.candidates, ...candidates.filter(candidate =>
      !hit.candidates.some(existing => existing.sourceTypeId === candidate.sourceTypeId))]
    return !merged.length ? hit : Object.freeze({ alias: hit.alias,
      status: previous.status === 'matched' ? 'candidate' as const : 'ambiguous' as const,
      candidates: Object.freeze(merged), context: hit.context, crossDomainOverlaps: hit.crossDomainOverlaps })
  }
  // All imported overrides are resolved once, not reconstructed per sentence/catalog row.
  const index = new Map<string, SourceProductLookup>()
  for (const concept of concepts.values()) for (const alias of concept.aliases) {
    const key = normalizeText(alias.text)
    if (!index.has(key)) index.set(key, inheritedLookup(alias.text))
  }
  const lookup = (text: string) => index.get(normalizeText(text)) ?? inheritedLookup(text)
  const blockedRecords: { sourceTypeId: SourceProductTypeId; alias: string; normalized: string; reason: string }[] = []
  let unambiguousRecords = 0, contextRecords = 0, crossLanguageConcepts = 0
  const uniqueActiveKeys = new Set<string>()
  const supportedIds = new Set<SourceProductTypeId>()
  for (const concept of productTypeSourceResource.productTypes) {
    const scripts = new Set<string>()
    for (const alias of concept.aliases) {
      const hit = lookup(alias.text)
      if (hit.status === 'blocked') {
        blockedRecords.push(Object.freeze({ sourceTypeId: concept.id, alias: alias.text, normalized: hit.alias,
          reason: 'Conversational expression collision; never a product type without a qualified phrase.' }))
        continue
      }
      uniqueActiveKeys.add(hit.alias)
      supportedIds.add(concept.id)
      if (hit.status === 'candidate') unambiguousRecords++; else contextRecords++
      if (/\p{Script=Arabic}/u.test(alias.text)) scripts.add('arabic')
      if (/\p{Script=Latin}/u.test(alias.text)) scripts.add('latin')
    }
    if (scripts.size > 1) crossLanguageConcepts++
  }
  return Object.freeze({
    authorization: 'user_authorized_vocabulary' as const,
    coverage: Object.freeze({ importedRecords: source.coverage.aliases,
      activatedRecords: unambiguousRecords + contextRecords, unambiguousRecords, contextRecords,
      blockedRecords: Object.freeze(blockedRecords), duplicateRecords: source.coverage.normalizedDuplicatePairs,
      uniqueActiveKeys: uniqueActiveKeys.size, supportedConcepts: supportedIds.size, crossLanguageConcepts,
      unsupportedConcepts: concepts.size - supportedIds.size }),
    sourceIdForCanonical: (value: ProductType) => reverse.get(value) ?? null,
    lookup,
    matchTokens(text: string) {
      return matchLongestAliases(text, Math.max(source.maxAliasTokens, legacy.maxAliasTokens), phrase => {
        const hit = lookup(phrase)
        return hit.status === 'candidate' || hit.status === 'ambiguous' ? hit : undefined
      })
    },
  })
}
