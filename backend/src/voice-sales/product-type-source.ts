import { existsSync, readFileSync } from 'node:fs'
import { sourceProductTypeIds } from './product-type-source-ids.js'
import type { SourceProductTypeId } from './product-type-source-ids.js'
import type { Dictionary, DictionaryDomain, ProductType } from './dictionary.types.js'
import type { ProductTypeAmbiguities, ProductTypeSeed, SourceProductCandidate, SourceProductLookup } from './product-type-source.types.js'
import { matchLongestAliases } from './dictionary.js'
import { normalizeText } from './normalization.js'

function freezeResource<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeResource)
    Object.freeze(value)
  }
  return value
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown): value is string => typeof value === 'string'
const ids = new Set<string>(sourceProductTypeIds)
const isId = (value: unknown): value is SourceProductTypeId => string(value) && ids.has(value)

/** Fail closed on malformed packaged data, before constructing any candidate index. */
export function validateProductTypeResources(seed: unknown, ambiguity: unknown): asserts seed is ProductTypeSeed {
  const fail = () => { throw new Error('Invalid packaged Product Types resource') }
  if (!record(seed) || seed.schemaVersion !== '1.0' || seed.domain !== 'product_types'
    || !record(seed.source) || !string(seed.source.originalFilename) || !string(seed.source.sourceVersion)
    || !string(seed.source.originalJsonSHA256) || !/^[a-f0-9]{64}$/u.test(seed.source.originalJsonSHA256)
    || seed.source.sourceSeedReview !== true || !record(seed.integratePolicy)
    || seed.integratePolicy.databaseWrites !== false
    || ['canonicalIdsMustBeMappedToExistingParserSemantics', 'unknownAmbiguitiesMustRemainCandidates',
      'doNotAssumeEntryDatabaseProductTypes', 'reviewBeforeBroadEnablement'].some(key => (seed.integratePolicy as Record<string, unknown>)[key] !== true)
    || !Array.isArray(seed.productTypes) || seed.productTypes.length !== ids.size) return fail()
  const found = new Set<string>()
  for (const concept of seed.productTypes) {
    if (!record(concept) || !isId(concept.id) || found.has(concept.id) || !string(concept.group)
      || !record(concept.labels) || !string(concept.labels.ar) || !string(concept.labels.en)
      || !string(concept.audienceHint) || !string(concept.note) || !Array.isArray(concept.aliases) || !concept.aliases.length) return fail()
    found.add(concept.id)
    for (const alias of concept.aliases) {
      if (!record(alias) || !string(alias.text) || !normalizeText(alias.text) || !string(alias.sourceNormalized)
        || !string(alias.source) || !string(alias.locale)
        || !['exact_candidate', 'require_context'].includes(String(alias.matchPolicy)) || alias.reviewStatus !== 'seed_review') return fail()
    }
  }
  if (!record(ambiguity) || ambiguity.domain !== 'product_types' || !string(ambiguity.sourceVersion)
    || !Array.isArray(ambiguity.ambiguousAliases)) return fail()
  for (const entry of ambiguity.ambiguousAliases) {
    if (!record(entry) || !string(entry.sourceNormalized) || !normalizeText(entry.sourceNormalized)
      || !Array.isArray(entry.candidateTypeIds) || entry.candidateTypeIds.length < 2
      || entry.candidateTypeIds.some(id => !isId(id)) || new Set(entry.candidateTypeIds).size !== entry.candidateTypeIds.length
      || !string(entry.candidateArabicLabels) || !string(entry.neededContext)) return fail()
  }
}

// Compiled artifacts carry their own resources; source/test runs use the repository copy.
const packagedResources = new URL('../resources/voice-sales/', import.meta.url)
const resourceRoot = existsSync(new URL('product-types.seed.json', packagedResources))
  ? packagedResources : new URL('../../resources/voice-sales/', import.meta.url)
const rawSeed: unknown = JSON.parse(readFileSync(new URL('product-types.seed.json', resourceRoot), 'utf8'))
const rawAmbiguity: unknown = JSON.parse(readFileSync(new URL('product-types.ambiguous.json', resourceRoot), 'utf8'))
validateProductTypeResources(rawSeed, rawAmbiguity)
export const productTypeSourceResource = freezeResource(rawSeed)
export const productTypeSourceAmbiguities = freezeResource(rawAmbiguity as ProductTypeAmbiguities)

/** Exact equivalent concepts only. Narrower gender/style/audience concepts remain unmapped. */
export const productTypeCompatibility = Object.freeze({
  TSHIRT: 'T_SHIRT', POLO: 'POLO_SHIRT', JEANS: 'JEANS', PANTS: 'PANTS', BODYSUIT: 'BODYSUIT',
  SWEATER: 'SWEATER', DRESS: 'DRESS', LEGGINGS: 'LEGGINGS', TIGHTS: 'TIGHTS', BRA: 'BRA',
  HOODIE: 'HOODIE', JACKET: 'JACKET', SHIRT: 'SHIRT', TOP: 'TOP',
} satisfies Partial<Record<SourceProductTypeId, ProductType>>)

export function createProductTypeSourceIndex(domains: { [D in DictionaryDomain]: Dictionary<D> }) {
  const grouped = new Map<string, Map<SourceProductTypeId, SourceProductCandidate>>()
  const concepts = new Map(productTypeSourceResource.productTypes.map(concept => [concept.id, concept]))
  const sourceKeys = new Map<string, Set<string>>()
  let changedKeys = 0, duplicatePairs = 0, aliasCount = 0
  for (const concept of productTypeSourceResource.productTypes) for (const alias of concept.aliases) {
    aliasCount++
    const key = normalizeText(alias.text)
    if (key !== alias.sourceNormalized) changedKeys++
    const sourceIds = sourceKeys.get(alias.sourceNormalized) ?? new Set<string>()
    sourceIds.add(concept.id); sourceKeys.set(alias.sourceNormalized, sourceIds)
    const candidates = grouped.get(key) ?? new Map<SourceProductTypeId, SourceProductCandidate>()
    const existing = candidates.get(concept.id)
    if (existing) duplicatePairs++
    candidates.set(concept.id, { sourceTypeId: concept.id,
      canonicalType: Object.hasOwn(productTypeCompatibility, concept.id)
        ? productTypeCompatibility[concept.id as keyof typeof productTypeCompatibility] : null,
      labels: concept.labels, group: concept.group, audienceHint: concept.audienceHint,
      matchPolicy: existing?.matchPolicy === 'require_context' || alias.matchPolicy === 'require_context' ? 'require_context' : 'exact_candidate',
      reviewStatus: 'seed_review', aliases: [...(existing?.aliases ?? []), alias] })
    grouped.set(key, candidates)
  }
  const index = new Map<string, SourceProductLookup>()
  const rawRuntimeCollisionKeys = [...grouped.values()].filter(candidates => candidates.size > 1).length
  const contextsByRuntimeKey = new Map<string, typeof productTypeSourceAmbiguities.ambiguousAliases[number][]>()
  for (const entry of productTypeSourceAmbiguities.ambiguousAliases) {
    // Source keys may collapse ة into ه; reconnect through the ORIGINAL alias
    // provenance, never register sourceNormalized as a made-up runtime alias.
    const runtimeKeys = new Set(productTypeSourceResource.productTypes.flatMap(concept => concept.aliases
      .filter(alias => alias.sourceNormalized === entry.sourceNormalized).map(alias => normalizeText(alias.text))))
    for (const key of runtimeKeys) {
      const entries = contextsByRuntimeKey.get(key) ?? []
      entries.push(entry); contextsByRuntimeKey.set(key, entries)
    }
  }
  const runtimeCollisions: { key: string; sourceTypeIds: readonly SourceProductTypeId[] }[] = []
  const crossDomainOverlaps: { key: string; domains: readonly string[] }[] = []
  let maxTokens = 0
  for (const [key, candidatesById] of grouped) {
    const context = contextsByRuntimeKey.get(key) ?? []
    // Preserve declared relationships even if the project's normalizer separates a source collision.
    for (const entry of context) for (const id of entry.candidateTypeIds) if (!candidatesById.has(id)) {
      const concept = concepts.get(id)!
      candidatesById.set(id, { sourceTypeId: id, canonicalType: Object.hasOwn(productTypeCompatibility, id)
        ? productTypeCompatibility[id as keyof typeof productTypeCompatibility] : null,
        labels: concept.labels, group: concept.group, audienceHint: concept.audienceHint,
        matchPolicy: 'require_context', reviewStatus: 'seed_review', aliases: [] })
    }
    const overlaps = Object.values(domains).filter(domain => domain.domain !== 'productTypes' && domain.lookup(key).status !== 'unknown').map(domain => domain.domain)
    if (overlaps.length) crossDomainOverlaps.push({ key, domains: overlaps })
    const candidates = [...candidatesById.values()].sort((a, b) => a.sourceTypeId.localeCompare(b.sourceTypeId, 'en'))
    if (candidates.length > 1) runtimeCollisions.push({ key, sourceTypeIds: candidates.map(candidate => candidate.sourceTypeId) })
    const status = overlaps.includes('expressions') ? 'blocked'
      : candidates.length > 1 || context.length || overlaps.length || candidates.some(candidate => candidate.matchPolicy === 'require_context') ? 'ambiguous' : 'candidate'
    index.set(key, freezeResource({ alias: key, status, candidates, context, crossDomainOverlaps: overlaps }))
    maxTokens = Math.max(maxTokens, key.split(' ').length)
  }
  return Object.freeze({
    maxAliasTokens: maxTokens,
    coverage: freezeResource({ concepts: concepts.size, aliases: aliasCount, sourceCollisionKeys: [...sourceKeys.values()].filter(ids => ids.size > 1).length,
      runtimeKeys: grouped.size, rawRuntimeCollisionKeys, preservedSourceAmbiguities: productTypeSourceAmbiguities.ambiguousAliases.length,
      normalizedDuplicatePairs: duplicatePairs, changedKeys,
      runtimeCollisions, crossDomainOverlaps, mappedConcepts: Object.keys(productTypeCompatibility).length,
      stagedConcepts: concepts.size - Object.keys(productTypeCompatibility).length }),
    lookup(text: string): SourceProductLookup {
      const key = normalizeText(text)
      return index.get(key) ?? freezeResource({ alias: key, status: 'unknown' as const, candidates: [], context: [], crossDomainOverlaps: [] })
    },
    matchTokens(text: string) {
      return matchLongestAliases(text, maxTokens, phrase => {
        const hit = index.get(phrase)
        return hit && hit.status !== 'blocked' ? hit : undefined
      })
    },
  })
}
