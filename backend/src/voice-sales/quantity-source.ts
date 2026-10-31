import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { normalizeText } from './normalization.js'
import { quantityUnitIds, quantityModifierIds } from './quantity-source.types.js'
import type { QuantitySeed, QuantityAliasGroup, QuantityAliasAudit } from './quantity-source.types.js'

const hashes = { 'quantities.seed.json': '571349b70a03189316912edd8393f45ef5d4730f5d6ffc9f3a94dd1ab4cb5176',
  'quantities.source-collisions.json': 'be98f12bac4b97f849a99fef7d4293aae07e9b294c477c1242a128d4132d1231' } as const
function load(name: keyof typeof hashes): unknown {
  const built = new URL(`../resources/voice-sales/${name}`, import.meta.url)
  const source = new URL(`../../resources/voice-sales/${name}`, import.meta.url)
  const bytes = readFileSync(existsSync(built) ? built : source)
  if (createHash('sha256').update(bytes).digest('hex') !== hashes[name]) throw new Error('Invalid packaged Quantity resource integrity')
  return JSON.parse(bytes.toString('utf8')) as unknown
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value) }
  return value
}
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const groups = ['number_aliases', 'unit_aliases', 'direct_phrases', 'modifier_aliases'] as const
export function validateQuantitySeed(seed: unknown): asserts seed is QuantitySeed {
  const fail = (): never => { throw new Error('Invalid packaged Quantity resource shape') }
  const counts = { quantities: 1006, number_aliases: 1533, units: 23, unit_aliases: 361, direct_phrases: 312,
    modifiers: 24, modifier_aliases: 220, ambiguities: 61, alias_collisions: 3, parser_test_cases: 65, normalization_rules: 22 }
  if (!record(seed) || !record(seed.metadata) || seed.metadata.version !== '1.0-seed'
    || !text(seed.metadata.caution) || !record(seed.metadata.counts) || !record(seed.data)) return fail()
  for (const [key, count] of Object.entries(counts)) if (!Array.isArray(seed.data[key]) || seed.data[key].length !== count) return fail()
  for (const [key, value] of Object.entries(counts)) {
    if (key === 'normalization_rules') continue
    const name = key === 'quantities' ? 'quantity_values' : key === 'alias_collisions' ? 'unit_alias_collisions' : key
    if (seed.metadata.counts[name] !== value) return fail()
  }
  const values = new Map<string, number>()
  for (const row of seed.data.quantities) {
    if (!record(row) || !/^QTY_\d{5}$/u.test(row.quantity_id) || values.has(row.quantity_id)
      || !Number.isSafeInteger(row.value) || row.value <= 0 || row.kind !== 'integer'
      || ['arabic_display', 'english_display', 'recognition_note'].some(key => !text(row[key]))) return fail()
    values.set(row.quantity_id, row.value)
  }
  const unitIds = new Set<string>(), modifierIds = new Set<string>()
  for (const row of seed.data.units) {
    if (!record(row) || !quantityUnitIds.includes(row.unit_id) || unitIds.has(row.unit_id)
      || !['fixed', 'inventory_dependent', 'unknown', 'length', 'weight'].includes(row.conversion_type)
      || row.known_pieces_per_unit !== null && (!Number.isSafeInteger(row.known_pieces_per_unit) || row.known_pieces_per_unit <= 0)
      || ['english_name', 'arabic_name', 'notes'].some(key => !text(row[key]))) return fail()
    unitIds.add(row.unit_id)
  }
  for (const row of seed.data.modifiers) {
    if (!record(row) || !quantityModifierIds.includes(row.modifier_id) || modifierIds.has(row.modifier_id)
      || ['arabic_name', 'semantic_action', 'notes'].some(key => !text(row[key]))) return fail()
    modifierIds.add(row.modifier_id)
  }
  for (const group of groups) for (const row of seed.data[group]) {
    if (!record(row) || !text(row.alias) || !text(row.normalized) || !normalizeText(row.alias)) return fail()
    if (group === 'number_aliases' && (values.get(row.quantity_id) !== row.value
      || !['needs_quantity_context', 'needs_context_if_ambiguous'].includes(row.match_policy)
      || !text(row.language) || !text(row.alias_type) || !text(row.review_status))) return fail()
    if (group === 'unit_aliases' && (!unitIds.has(row.unit_id)
      || !['unit_context', 'verify_phrase_for_implicit_number', 'catalog_conversion_required'].includes(row.match_policy)
      || !text(row.language) || !text(row.review_status))) return fail()
    if (group === 'direct_phrases' && (!unitIds.has(row.unit_id) || !Number.isFinite(row.order_units) || row.order_units <= 0
      || !['yes', 'no'].includes(row.requires_pack_metadata) || !text(row.note)
      || row.resolved_pieces !== null && (!Number.isFinite(row.resolved_pieces) || row.resolved_pieces <= 0))) return fail()
    if (group === 'modifier_aliases' && (!modifierIds.has(row.modifier_id) || row.match_policy !== 'context_only' || !text(row.language))) return fail()
  }
  if (seed.data.ambiguities.some((row: any) => !record(row)
    || ['expression', 'may_mean', 'domain_hint', 'resolution_rule', 'review_status'].some(key => !text(row[key])))
    || seed.data.parser_test_cases.some((row: any) => !record(row) || !text(row.input) || !text(row.expected_intent)
      || row.expected_unit !== null && !unitIds.has(row.expected_unit))) return fail()
  if (seed.data.normalization_rules.some((row: any) => !record(row) || !text(row.rule) || !text(row.implementation))
    || seed.data.alias_collisions.some((row: any) => !record(row) || !text(row.normalized_alias)
      || !text(row.unit_ids) || !text(row.handling))) return fail()
}
const loaded = load('quantities.seed.json')
validateQuantitySeed(loaded)
export const quantitySourceResource: QuantitySeed = deepFreeze(loaded)
export const quantitySourceCollisions = deepFreeze(load('quantities.source-collisions.json'))

/** Indexes are closed over; callers cannot mutate maps or frozen source provenance. */
export function createActiveQuantityRegistry(crossDomains: (alias: string) => readonly string[]) {
  const indexes = {
    number_aliases: new Map<string, QuantitySeed['data']['number_aliases'][number][]>(),
    unit_aliases: new Map<string, QuantitySeed['data']['unit_aliases'][number][]>(),
    direct_phrases: new Map<string, QuantitySeed['data']['direct_phrases'][number][]>(),
    modifier_aliases: new Map<string, QuantitySeed['data']['modifier_aliases'][number][]>(),
  }
  const target = (group: QuantityAliasGroup, row: Record<string, any>): string => group === 'number_aliases'
    ? String(row.value) : group === 'modifier_aliases' ? row.modifier_id : group === 'direct_phrases'
      ? `${row.unit_id}:${row.order_units}` : row.unit_id
  const sourceIndexes = new Map<QuantityAliasGroup, Map<string, Set<string>>>()
  for (const group of groups) for (const row of quantitySourceResource.data[group]) {
    const key = normalizeText(row.alias)
    const index = indexes[group] as Map<string, typeof row[]>
    const rows = index.get(key) ?? []; rows.push(row); index.set(key, rows)
    const source = sourceIndexes.get(group) ?? new Map<string, Set<string>>()
    const meanings = source.get(row.normalized) ?? new Set<string>()
    meanings.add(target(group, row)); source.set(row.normalized, meanings); sourceIndexes.set(group, source)
  }
  for (const index of Object.values(indexes)) for (const rows of index.values()) Object.freeze(rows)
  const audit: QuantityAliasAudit[] = []
  for (const group of groups) quantitySourceResource.data[group].forEach((row, sourceIndex) => {
    const key = normalizeText(row.alias)
    // Preserve source-declared collisions even if project normalization splits a key.
    const meanings = [...new Set([...indexes[group].get(key)!.map(other => target(group, other)),
      ...sourceIndexes.get(group)!.get(row.normalized)!])]
    const overlaps = [...crossDomains(key), ...groups.filter(other => other !== group && indexes[other].has(key))
      .map(other => `quantity:${other}`)]
    audit.push(Object.freeze({ group, sourceIndex, alias: row.alias, normalizedKey: key, sourceNormalizedKey: row.normalized,
      disposition: 'conditional', conflictingTargets: Object.freeze(meanings.length > 1 ? meanings : []),
      crossDomains: Object.freeze([...overlaps]), reasons: Object.freeze([
        'Requires order/unit/span context; recognition is not sale authorization.',
        ...(meanings.length > 1 ? ['Multiple source/runtime meanings; never select by row order.'] : []),
        ...(overlaps.length ? ['Cross-domain vocabulary overlap.'] : []),
        ...(group === 'direct_phrases' && 'unit_id' in row && row.unit_id !== 'PIECE'
          ? ['Physical pieces cannot establish sellable SKU conversion.'] : []),
      ]) }))
  })
  const lookup = <G extends QuantityAliasGroup>(group: G, phrase: string): readonly QuantitySeed['data'][G][number][] =>
    indexes[group].get(normalizeText(phrase)) ?? Object.freeze([])
  const coverage = Object.freeze({ concepts: 1006, unitConcepts: 23, modifierConcepts: 24,
    aliasRecords: audit.length, recognizedConditional: audit.length, blocked: 0,
    lexicallyUnambiguous: audit.filter(row => !row.conflictingTargets.length).length,
    conflictingAliasRecords: audit.filter(row => row.conflictingTargets.length).length,
    runtimeCollisions: Object.freeze(groups.flatMap(group => [...indexes[group]].filter(([, rows]) =>
      new Set(rows.map(row => target(group, row))).size > 1).map(([key, rows]) => Object.freeze({ group, key,
        targets: Object.freeze([...new Set(rows.map(row => target(group, row)))]) })))),
  })
  return Object.freeze({ lookup, audit: Object.freeze(audit), coverage,
    maxTokens: Math.max(...audit.map(row => row.normalizedKey.split(' ').length)),
  })
}
