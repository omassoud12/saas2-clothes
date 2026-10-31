import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { normalizeText } from './normalization.js'
import { matchLongestAliases } from './dictionary.js'
import { sourceColorIds } from './color-source-ids.js'
import type { SourceColorId } from './color-source-ids.js'
import type { Color, Dictionary, DictionaryDomain } from './dictionary.types.js'
import type { ColorSeed, ColorCollisions, SourceColorAlias, SourceColorLookup } from './color-source.types.js'

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const ids = new Set<string>(sourceColorIds)
const isId = (value: unknown): value is SourceColorId => typeof value === 'string' && ids.has(value)
const string = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
export const COLOR_SOURCE_SHA256 = 'f50e8977a07b212801966b6cc2b1c063676ce92d768c212d50c34232d9d07c85'

/** Shape, stable IDs, source rows and declared collision consistency; bytes are pinned below. */
export function validateColorResources(seed: unknown, collisions: unknown): asserts seed is ColorSeed {
  const fail = () => { throw new Error('Invalid packaged Colors resource') }
  if (!record(seed) || seed.kind !== 'SAAS2_COLOR_SHADES_IMPORT_SEED' || seed.schemaVersion !== '1.0.0'
    || seed.sourceSha256 !== COLOR_SOURCE_SHA256 || !string(seed.sourceFile) || !string(seed.important)
    || !record(seed.metadata) || seed.metadata.colorConceptCount !== 307 || seed.metadata.sourceAliasRecordCount !== 3475
    || seed.metadata.generatedDefiniteArabicReviewCount !== 433 || !string(seed.metadata.scope)
    || !Array.isArray(seed.colors) || seed.colors.length !== ids.size) return fail()
  const concepts = new Set<string>(), lines = new Set<number>()
  const sourceGroups = new Map<string, Set<string>>()
  const counts = { exact_candidate: 0, needs_context: 0, seed_review: 0, needs_review: 0 }
  for (const concept of seed.colors) {
    if (!record(concept) || !isId(concept.colorId) || concepts.has(concept.colorId)
      || !string(concept.canonicalEn) || !string(concept.canonicalAr) || !Array.isArray(concept.aliases) || !concept.aliases.length) return fail()
    concepts.add(concept.colorId)
    for (const alias of concept.aliases) {
      if (!record(alias) || !string(alias.alias) || !normalizeText(alias.alias) || !string(alias.sourceNormalized)
        || !string(alias.source) || !['ar', 'latin'].includes(alias.locale)
        || !['exact_candidate', 'needs_context'].includes(alias.matchPolicy)
        || !['seed_review', 'needs_review'].includes(alias.reviewStatus)
        || !Number.isInteger(alias.sourceCsvLine) || alias.sourceCsvLine < 2 || alias.sourceCsvLine > 3476
        || lines.has(alias.sourceCsvLine)) return fail()
      lines.add(alias.sourceCsvLine)
      counts[alias.matchPolicy as 'exact_candidate' | 'needs_context']++
      counts[alias.reviewStatus as 'seed_review' | 'needs_review']++
      const group = sourceGroups.get(alias.sourceNormalized) ?? new Set<string>()
      group.add(concept.colorId); sourceGroups.set(alias.sourceNormalized, group)
    }
  }
  if (lines.size !== 3475 || counts.exact_candidate !== 3314 || counts.needs_context !== 161
    || counts.seed_review !== 3042 || counts.needs_review !== 433) return fail()
  if (!record(collisions) || !string(collisions.note) || collisions.collisionCount !== 64
    || !Array.isArray(collisions.collisions) || collisions.collisions.length !== 64) return fail()
  const keys = new Set<string>()
  for (const collision of collisions.collisions) {
    if (!record(collision) || !string(collision.sourceNormalizedKey) || keys.has(collision.sourceNormalizedKey)
      || !Array.isArray(collision.colorIds) || collision.colorIds.length < 2
      || collision.colorIds.some((id: unknown) => !isId(id)) || new Set(collision.colorIds).size !== collision.colorIds.length
      || !record(collision.sourceAliasesByColor) || collision.policy !== 'MUST_REQUIRE_CONTEXT_OR_CLARIFICATION') return fail()
    keys.add(collision.sourceNormalizedKey)
    const expected = sourceGroups.get(collision.sourceNormalizedKey)
    if (!expected || expected.size !== collision.colorIds.length || collision.colorIds.some((id: string) => !expected.has(id))) return fail()
    for (const id of collision.colorIds) {
      const declared = collision.sourceAliasesByColor[id]
      const original = seed.colors.find((concept: any) => concept.colorId === id)!.aliases
        .filter((alias: any) => alias.sourceNormalized === collision.sourceNormalizedKey).map((alias: any) => alias.alias)
      if (!Array.isArray(declared) || !declared.length || declared.some((alias: unknown) => !string(alias) || !original.includes(alias))) return fail()
    }
  }
  if ([...sourceGroups].filter(([, values]) => values.size > 1).some(([key]) => !keys.has(key))) return fail()
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const packaged = new URL('../resources/voice-sales/', import.meta.url)
const resourceRoot = existsSync(new URL('colors.seed.json', packaged)) ? packaged : new URL('../../resources/voice-sales/', import.meta.url)
function load(name: string, expectedHash: string): unknown {
  const bytes = readFileSync(new URL(name, resourceRoot))
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('Invalid packaged Colors resource integrity')
  return JSON.parse(bytes.toString('utf8'))
}
const rawSeed = load('colors.seed.json', '7894cfd50b44b013be06b6755780f5e4d0da7a0edf6323f6801009fe18bdeb77')
const rawCollisions = load('colors.source-collisions.json', '0080ed668b250019bf435d3cce1d101a5b41469be65607b572916dc9f5dc528f')
validateColorResources(rawSeed, rawCollisions)
export const colorSourceResource = freeze(rawSeed)
export const colorSourceCollisions = freeze(rawCollisions as ColorCollisions)
const legacyIds = new Set<Color>(['BLACK', 'WHITE', 'NAVY_BLUE', 'OLIVE_GREEN', 'GREEN', 'RED', 'BLUE', 'GREY', 'BEIGE', 'BROWN', 'PINK', 'YELLOW', 'ORANGE'])
const modes = new Set<SourceColorId>(['NO_COLOR', 'MULTICOLOR', 'ASSORTED_COLORS', 'COLORBLOCK', 'GRADIENT', 'OMBRE', 'RAINBOW', 'TIE_DYE', 'TRANSPARENT'])
// French “or” means Gold, but outside explicit color context it is an English operator.
const modelWords = new Set(['coffee', 'bone', 'rose', 'marine', 'nude', 'or'])

export function createActiveColorRegistry(domains: { [D in DictionaryDomain]: Dictionary<D> },
  productRegistry: { lookup(text: string): { status: string; candidates: readonly unknown[] } }) {
  const groups = new Map<string, { ids: Set<SourceColorId>; records: SourceColorAlias[] }>()
  let changedKeys = 0, rawDuplicates = 0, normalizedDuplicates = 0
  const rawPairs = new Set<string>(), normalizedPairs = new Set<string>()
  const contextByKey = new Map(colorSourceCollisions.collisions.map(collision => [collision.sourceNormalizedKey, collision.colorIds]))
  for (const concept of colorSourceResource.colors) for (const alias of concept.aliases) {
    const key = normalizeText(alias.alias)
    if (key !== alias.sourceNormalized) changedKeys++
    const rawPair = JSON.stringify([concept.colorId, alias.alias]), normalizedPair = JSON.stringify([concept.colorId, key])
    if (rawPairs.has(rawPair)) rawDuplicates++; else rawPairs.add(rawPair)
    if (normalizedPairs.has(normalizedPair)) normalizedDuplicates++; else normalizedPairs.add(normalizedPair)
    const group = groups.get(key) ?? { ids: new Set<SourceColorId>(), records: [] }
    group.ids.add(concept.colorId); group.records.push(alias); groups.set(key, group)
  }
  const rawRuntimeCollisions = [...groups].filter(([, group]) => group.ids.size > 1).length
  // Preserve source relationships through provenance; never treat sourceNormalized as runtime text.
  for (const concept of colorSourceResource.colors) for (const alias of concept.aliases) {
    contextByKey.get(alias.sourceNormalized)?.forEach(id => groups.get(normalizeText(alias.alias))!.ids.add(id))
  }
  const index = new Map<string, SourceColorLookup>()
  const crossDomain: { alias: string; domains: DictionaryDomain[] }[] = []
  for (const [key, group] of groups) {
    const old = domains.colors.lookup(key)
    if (old.status === 'matched') group.ids.add(old.value)
    const overlap: DictionaryDomain[] = Object.entries(domains).flatMap(([domain, dictionary]) =>
      domain !== 'colors' && dictionary.lookup(key).status !== 'unknown' ? [domain as DictionaryDomain] : [])
    const product = productRegistry.lookup(key)
    if (!['unknown', 'blocked'].includes(product.status) && product.candidates.length && !overlap.includes('productTypes')) overlap.push('productTypes')
    if (overlap.length) crossDomain.push({ alias: key, domains: overlap })
    // CSV line 272 explicitly spells Black/plain with colloquial ه. Match its
    // verified PLAIN component without globally conflating Arabic ة and ه.
    const patternText = key === normalizeText('اسود ساده') ? normalizeText('اسود سادة') : key
    const patternHits = domains.patterns.matchTokens(patternText)
    const pattern = patternHits.find(match => match.result.status === 'matched')?.result
    const embeddedPattern = key.includes(' ') && pattern?.status === 'matched' ? pattern.value : null
    const candidates = [...group.ids].sort() as SourceColorId[]
    const needsReview = group.records.every(alias => alias.reviewStatus === 'needs_review')
    const ambiguous = candidates.length > 1 || overlap.length > 0 || modelWords.has(key)
      || candidates.some(id => modes.has(id)) || group.records.some(alias => alias.matchPolicy === 'needs_context')
    const deferred = needsReview || old.status === 'suggestion'
    const status = deferred ? 'deferred' : ambiguous ? 'ambiguous' : 'matched'
    index.set(key, freeze({ alias: key, status, value: status === 'matched' ? candidates[0] : null,
      candidates, legacyColor: candidates.length === 1 && legacyIds.has(candidates[0] as Color) ? candidates[0] as Color : null,
      records: [...group.records], crossDomainOverlaps: overlap, embeddedPattern,
      colorMode: candidates.some(id => modes.has(id)),
      reason: deferred ? 'Unreviewed generated/source spelling or existing uncertain transcription; never auto-select.'
        : ambiguous ? 'Color alternatives, domain/model context or explicit stored color-mode evidence required.' : null } as SourceColorLookup))
  }
  const lookup = (text: string): SourceColorLookup => {
    const key = normalizeText(text), known = index.get(key)
    if (known) return known
    // Preserve verified PLAIN semantics across existing spellings (ساده / سادة).
    // This is compositional exact-token evidence, never a fabricated source CSV row.
    const tokens = key.split(' ')
    for (let split = 1; split < tokens.length; split++) {
      const pattern = domains.patterns.lookup(tokens.slice(split).join(' '))
      const color = index.get(tokens.slice(0, split).join(' '))
      if (pattern.status === 'matched' && pattern.value === 'PLAIN' && color) {
        return freeze({ ...color, alias: key, embeddedPattern: 'PLAIN' as const })
      }
    }
    const old = domains.colors.lookup(key)
    return freeze({ alias: key, status: old.status === 'matched' ? 'matched' : old.status === 'suggestion' ? 'deferred' : 'unknown',
      value: old.status === 'matched' ? old.value : null,
      candidates: old.status === 'matched' ? [old.value] : old.status === 'suggestion' ? [...old.candidates] : [],
      legacyColor: old.status === 'matched' ? old.value : null, records: [], crossDomainOverlaps: [], embeddedPattern: null,
      colorMode: false, reason: old.status === 'suggestion' ? old.reason : null } as SourceColorLookup)
  }
  const disposition = colorSourceResource.colors.flatMap(concept => concept.aliases.map(alias => {
    const result = lookup(alias.alias)
    const status = alias.reviewStatus === 'needs_review' || result.status === 'deferred' ? 'deferred'
      : result.status === 'matched' ? 'active_unambiguous' : 'active_context'
    return freeze({ sourceColorId: concept.colorId, sourceCsvLine: alias.sourceCsvLine, alias: alias.alias,
      normalized: result.alias, status, reason: status === 'deferred' ? result.reason ?? 'needs_review source record retained without automatic promotion.' : result.reason })
  }))
  const maxTokens = Math.max(domains.colors.maxAliasTokens, ...[...index.keys()].map(key => key.split(' ').length))
    + domains.patterns.maxAliasTokens
  return Object.freeze({ lookup,
    matchTokens(text: string) { return matchLongestAliases(text, maxTokens, phrase => {
      const hit = lookup(phrase); return hit.status === 'unknown' ? undefined : hit
    }) },
    coverage: freeze({ concepts: ids.size, aliasRecords: disposition.length, rawDuplicates, normalizedDuplicates,
      changedKeys, runtimeKeys: index.size, sourceCollisionKeys: 64, rawRuntimeCollisions,
      runtimeCollisions: [...index.values()].filter(hit => hit.candidates.length > 1), crossDomain,
      activeUnambiguous: disposition.filter(row => row.status === 'active_unambiguous').length,
      activeContext: disposition.filter(row => row.status === 'active_context').length,
      deferred: disposition.filter(row => row.status === 'deferred').length, blocked: 0, disposition }),
  })
}
