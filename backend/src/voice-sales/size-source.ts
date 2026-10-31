import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { normalizeText } from './normalization.js'
import { sourceSizeIds, sizeFamilies } from './size-source-ids.js'
import type { SourceSizeId } from './size-source-ids.js'
import type { Dictionary, DictionaryDomain, Size } from './dictionary.types.js'
import type { SizeSeed, SizeCollisionResource, SourceSizeAlias, SourceSizeLookup } from './size-source.types.js'

/** Shared letter/digit normalization, with local structural separators retained. */
export function normalizeSizeText(text: string): string {
  return text.normalize('NFKC').replace(/[\p{Pd}−]/gu, '-').replace(/٫/gu, '.')
    .split(/([/.-])/u).map(part => /^(?:[/.-])$/u.test(part) ? part : normalizeText(part))
    .join(' ').replace(/\s*([/.-])\s*/gu, '$1').replace(/\s+/gu, ' ').trim()
}
const idSet = new Set<string>(sourceSizeIds)
const shape = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const sourceHash = '39bdbf124229f786f46cd7e4ca0b37d4a3ebf68ee91db12d66154488b703f438'
export function validateSizeResources(seed: unknown, collisions: unknown): asserts seed is SizeSeed {
  const fail = (): never => { throw new Error('Invalid packaged Sizes resource') }
  if (!shape(seed) || seed.version !== '1.0-seed' || !nonempty(seed.warning)
    || !Array.isArray(seed.size_records) || seed.size_records.length !== 671
    || !Array.isArray(seed.aliases) || seed.aliases.length !== 10448
    || !Array.isArray(seed.modifiers) || seed.modifiers.length !== 23
    || !Array.isArray(seed.modifier_aliases) || seed.modifier_aliases.length !== 196
    || !Array.isArray(seed.ambiguities) || seed.ambiguities.length !== 51
    || !Array.isArray(seed.parser_tests) || seed.parser_tests.length !== 24 || !shape(seed.stats)
    || seed.stats.canonical_sizes !== 671 || seed.stats.alias_rows !== 10448 || seed.stats.size_families !== 22) return fail()
  const concepts = new Map<string, number>(), rows = new Map<string, SourceSizeAlias>()
  for (const value of seed.size_records) {
    if (!shape(value) || !idSet.has(value.size_id) || concepts.has(value.size_id) || !sizeFamilies.includes(value.family)
      || ['canonical_label', 'size_standard', 'size_value', 'display_ar', 'display_en', 'apparel_scope', 'required_context']
        .some(key => !nonempty(value[key])) || typeof value.notes !== 'string' || !Number.isInteger(value.aliases_count)) return fail()
    concepts.set(value.size_id, 0)
  }
  const sourceGroups = new Map<string, Set<string>>(), sourceCounts = new Map<string, number>()
  let fuzzy = 0
  for (const value of seed.aliases) {
    if (!shape(value) || !nonempty(value.alias_id) || rows.has(value.alias_id) || !concepts.has(value.size_id)
      || ['alias', 'normalized_alias', 'language', 'alias_kind', 'required_context'].some(key => !nonempty(value[key]))
      || !normalizeText(value.alias) || !['contextual', 'fuzzy_with_context'].includes(value.match_policy)
      || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1
      || typeof value.notes !== 'string') return fail()
    rows.set(value.alias_id, value as SourceSizeAlias)
    concepts.set(value.size_id, concepts.get(value.size_id)! + 1)
    if (value.match_policy === 'fuzzy_with_context') fuzzy++
    const group = sourceGroups.get(value.normalized_alias) ?? new Set<string>()
    group.add(value.size_id); sourceGroups.set(value.normalized_alias, group)
    sourceCounts.set(value.normalized_alias, (sourceCounts.get(value.normalized_alias) ?? 0) + 1)
  }
  if (fuzzy !== 24 || seed.size_records.some((row: any) => row.aliases_count !== concepts.get(row.size_id))
    || sourceGroups.size !== 9384 || [...sourceGroups.values()].filter(group => group.size > 1).length !== 352) return fail()
  const modifiers = new Set<string>()
  for (const row of seed.modifiers) {
    if (!shape(row) || !nonempty(row.modifier_id) || modifiers.has(row.modifier_id) || row.is_size_id !== false
      || !nonempty(row.modifier_type) || !nonempty(row.modifier_name_en) || !nonempty(row.modifier_name_ar)) return fail()
    modifiers.add(row.modifier_id)
  }
  if (seed.modifier_aliases.some((row: any) => !shape(row) || !modifiers.has(row.modifier_id)
    || !nonempty(row.alias) || !normalizeText(row.alias) || !nonempty(row.type) || !nonempty(row.normalized_alias))) return fail()
  const ambiguities = new Set<string>()
  for (const row of seed.ambiguities) {
    if (!shape(row) || !nonempty(row.ambiguity_id) || ambiguities.has(row.ambiguity_id) || row.auto_resolve !== false
      || !nonempty(row.token) || !nonempty(row.resolution_rule) || !nonempty(row.possible_meanings)) return fail()
    ambiguities.add(row.ambiguity_id)
  }
  if (!shape(collisions) || collisions.countKeysMappingMultipleSizeIds !== 352 || collisions.countKeysWithMultipleAliasRecords !== 861
    || !Array.isArray(collisions.entries) || collisions.entries.length !== 352) return fail()
  const keys = new Set<string>()
  for (const collision of collisions.entries) {
    if (!shape(collision) || keys.has(collision.normalizedAlias) || !sourceGroups.has(collision.normalizedAlias)
      || !Array.isArray(collision.targetSizeIds) || !Array.isArray(collision.originalAliasRecords)) return fail()
    keys.add(collision.normalizedAlias)
    const expected = sourceGroups.get(collision.normalizedAlias)!
    if (collision.targetSizeIds.length !== expected.size || new Set(collision.targetSizeIds).size !== expected.size
      || collision.targetSizeIds.some((id: string) => !expected.has(id))) return fail()
    for (const row of collision.originalAliasRecords) {
      const original = rows.get(row.aliasId)
      if (!original || original.normalized_alias !== collision.normalizedAlias || original.size_id !== row.sizeId
        || original.alias !== row.alias || original.match_policy !== row.matchPolicy || original.required_context !== row.requiredContext) return fail()
    }
    if (collision.originalAliasRecords.length !== sourceCounts.get(collision.normalizedAlias)
      || new Set(collision.originalAliasRecords.map((row: any) => row.aliasId)).size !== collision.originalAliasRecords.length) return fail()
  }
}
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(immutable); Object.freeze(value) }
  return value
}
const packaged = new URL('../resources/voice-sales/', import.meta.url)
const root = existsSync(new URL('sizes.seed.json', packaged)) ? packaged : new URL('../../resources/voice-sales/', import.meta.url)
function load(file: string, hash: string): unknown {
  const bytes = readFileSync(new URL(file, root))
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Invalid packaged Sizes resource integrity')
  return JSON.parse(bytes.toString('utf8'))
}
const seed = load('sizes.seed.json', sourceHash)
const collisions = load('sizes.source-collisions.json', 'bbd23e4e66c8631c968316eee160e6b96b955171f7a5cb69f48b7bb802d0832f')
validateSizeResources(seed, collisions)
export const sizeSourceResource = immutable(seed)
export const sizeSourceCollisions = immutable(collisions as SizeCollisionResource)
const legacyAlpha: Readonly<Record<string, Size>> = { ALPHA_XS: 'XS', ALPHA_S: 'S', ALPHA_M: 'M', ALPHA_L: 'L', ALPHA_XL: 'XL', ALPHA_2XL: 'XXL', ALPHA_3XL: 'XXXL' }
export function createActiveSizeRegistry(domains: { [D in DictionaryDomain]: Dictionary<D> },
  productRegistry: { lookup(text: string): { status: string; candidates: readonly unknown[] } },
  colorRegistry: { lookup(text: string): { status: string; candidates: readonly unknown[] } }) {
  const concepts = new Map(sizeSourceResource.size_records.map(row => [row.size_id, row]))
  const groups = new Map<string, SourceSizeAlias[]>(), sourceGroups = new Map<string, SourceSizeAlias[]>(), runtime = new Map<string, Set<SourceSizeId>>()
  const raw = new Set<string>(), normalized = new Set<string>()
  let rawDuplicates = 0, runtimeDuplicates = 0, changedKeys = 0
  for (const row of sizeSourceResource.aliases) {
    const key = normalizeSizeText(row.alias), shared = normalizeText(row.alias)
    groups.set(key, [...groups.get(key) ?? [], row])
    sourceGroups.set(row.normalized_alias, [...sourceGroups.get(row.normalized_alias) ?? [], row])
    const ids = runtime.get(shared) ?? new Set<SourceSizeId>(); ids.add(row.size_id); runtime.set(shared, ids)
    const pair = JSON.stringify([row.size_id, row.alias]), normalizedPair = JSON.stringify([row.size_id, shared])
    if (raw.has(pair)) rawDuplicates++; raw.add(pair)
    if (normalized.has(normalizedPair)) runtimeDuplicates++; normalized.add(normalizedPair)
    if (shared !== row.normalized_alias) changedKeys++
  }
  // A source-declared collision remains a relationship even if the local
  // separator-preserving normalizer distinguishes its spellings (US-8 / US 8).
  // Retain every source alternative; punctuation alone is never a size system.
  for (const [key, records] of groups) {
    const related = records.flatMap(row => sourceGroups.get(row.normalized_alias) ?? [])
    groups.set(key, [...new Map([...records, ...related].map(row => [row.alias_id, row])).values()])
  }
  const index = new Map<string, SourceSizeLookup>()
  const crossDomain: { alias: string; domains: DictionaryDomain[] }[] = []
  for (const [key, records] of groups) {
    const ids = [...new Set(records.map(row => row.size_id))]
    const overlap = Object.entries(domains).flatMap(([domain, dictionary]) => domain !== 'sizes'
      && dictionary.lookup(key).status !== 'unknown' ? [domain as DictionaryDomain] : [])
    if (productRegistry.lookup(key).candidates.length && !overlap.includes('productTypes')) overlap.push('productTypes')
    if (colorRegistry.lookup(key).candidates.length && !overlap.includes('colors')) overlap.push('colors')
    if (overlap.length) crossDomain.push({ alias: key, domains: overlap })
    const suggestion = records.every(row => row.match_policy === 'fuzzy_with_context')
    const legacy = domains.sizes.lookup(key)
    const legacySize = ids.length === 1 ? legacyAlpha[ids[0]] ?? (legacy.status === 'matched' ? legacy.value : null) : null
    const ambiguous = ids.length > 1 || overlap.length > 0 || /^\d+(?:\.\d+)?$/u.test(key)
      || ['small', 'medium', 'large', 'big', 'petit', 'grand'].includes(key)
    index.set(key, immutable({ alias: key, status: suggestion ? 'suggestion' : ambiguous ? 'ambiguous' : 'matched',
      candidates: ids.map(id => concepts.get(id)!), records, crossDomainOverlaps: overlap, legacySize,
      reason: suggestion ? 'Speculative/fuzzy source spelling needs clarification; confidence is not proof.'
        : ambiguous ? 'Size family, standard, numeric/domain or model context is required.' : null }))
  }
  const unknown = (key: string): SourceSizeLookup => immutable({ alias: key, status: 'unknown', candidates: [], records: [],
    legacySize: null, crossDomainOverlaps: [], reason: null })
  const modifierGroups = new Map<string, typeof sizeSourceResource.modifier_aliases[number][]>()
  for (const row of sizeSourceResource.modifier_aliases) {
    const key = normalizeSizeText(row.alias)
    modifierGroups.set(key, [...modifierGroups.get(key) ?? [], row])
  }
  const units: Readonly<Record<string, string>> = { UNIT_CM: 'cm', UNIT_MONTH: 'months', UNIT_YEAR: 'years', UNIT_INCH: 'inch' }
  const lookup = (text: string): SourceSizeLookup => {
    const key = normalizeSizeText(text), direct = index.get(key)
    if (direct) return direct
    // Compose only verified unit and regional grammar over existing source IDs.
    // Preserve original alias rows; these expressions never masquerade as CSV rows.
    const unitText = key.split(' ').map(word => {
      const unit = modifierGroups.get(word)?.find(row => units[row.modifier_id])
      return unit ? units[unit.modifier_id] : word
    }).join(' ').replace(/^(?:age|عمر)\s+/u, '').replace(/^محيط راس /u, 'محيط الراس ')
    const normalizedUnit = index.get(unitText)
      ?? (/^\d+ months$/u.test(unitText) ? index.get(unitText.replace(' months', 'm')) : undefined)
    if (normalizedUnit) return immutable({ ...normalizedUnit, alias: key })
    const region = key.match(/^(eu|us|uk) (.+)$/u) ?? key.match(/^(.+) (eu|us|uk)$/u)
    if (region) {
      const prefix = /^(eu|us|uk)$/u.test(region[1])
      const base = index.get(prefix ? region[2] : region[1])
      if (base) return immutable({ ...base, alias: key })
    }
    return unknown(key)
  }
  const dispositions = sizeSourceResource.aliases.map(row => {
    const hit = lookup(row.alias)
    const status = row.match_policy === 'fuzzy_with_context' ? 'blocked'
      : hit.status === 'matched' ? 'active_exact' : 'active_context'
    return immutable({ aliasId: row.alias_id, sourceSizeId: row.size_id, alias: row.alias,
      runtimeKey: normalizeText(row.alias), preciseKey: hit.alias, status,
      reason: status === 'blocked' ? 'Fuzzy/context spelling recognized as a suggestion; not variant selection proof.' : hit.reason })
  })
  return Object.freeze({ lookup, concept: (id: SourceSizeId) => concepts.get(id)!,
    legacySize: (id: SourceSizeId): Size | null => legacyAlpha[id] ?? null,
    modifiers: (text: string) => Object.freeze([...(modifierGroups.get(normalizeSizeText(text)) ?? [])]),
    maxTokens: Math.max(...[...groups.keys()].map(key => normalizeText(key).split(' ').length)),
    coverage: immutable({ concepts: concepts.size, aliasRecords: dispositions.length, families: sizeFamilies.length,
      activeExact: dispositions.filter(row => row.status === 'active_exact').length,
      activeContext: dispositions.filter(row => row.status === 'active_context').length,
      blocked: dispositions.filter(row => row.status === 'blocked').length,
      rawDuplicates, runtimeDuplicates, changedKeys, preciseKeys: index.size, runtimeKeys: runtime.size,
      runtimeCollisions: [...runtime].filter(([, ids]) => ids.size > 1).map(([alias, ids]) => ({ alias, candidates: [...ids].sort() })),
      preciseCollisions: [...index.values()].filter(row => row.candidates.length > 1).map(row => ({ alias: row.alias, candidates: row.candidates.map(c => c.size_id) })),
      crossDomain, dispositions }) })
}
