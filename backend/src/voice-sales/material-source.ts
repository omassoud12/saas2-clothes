import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { normalizeText, tokenizeText } from './normalization.js'
import { matchLongestAliases } from './dictionary.js'
import { sourceMaterialIds, sourceFabricModifierIds } from './material-source-ids.js'
import type { SourceMaterialId } from './material-source-ids.js'
import type { Material } from './dictionary.types.js'
import type { MaterialSeed, MaterialAliasAudit, SourceMaterialLookup } from './material-source.types.js'

export const MATERIAL_SOURCE_SHA256 = '7c28f0dc1efb7452135894a79ff9aff4d5792ac9b93b14791de397432eb413d3'
export const MATERIAL_COLLISIONS_SHA256 = 'bfd5a039488ee63fe666296d6d0a9bf9bd763d454f5351a0efa1b683a1f1680b'
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function validateMaterialResources(seed: unknown, collisions: unknown): asserts seed is MaterialSeed {
  const fail = () => { throw new Error('Invalid packaged Materials resource') }
  const counts = { fabrics: 147, fabric_aliases: 1133, groups: 15, modifiers: 35, modifier_aliases: 288, ambiguities: 50, test_cases: 21 }
  if (!record(seed) || !record(seed.meta) || !record(seed.stats) || !record(collisions)
    || !record(collisions.counts) || collisions.counts.sourceDeclaredAmbiguities !== 50) return fail()
  for (const [key, count] of Object.entries(counts)) {
    if (!Array.isArray(seed[key]) || seed[key].length !== count || seed.stats[key] !== count) return fail()
  }
  const groups = new Set(seed.groups.map((row: any) => row.group_id))
  if (groups.size !== 15 || seed.groups.some((r: any) => !record(r) || !str(r.group_id) || !str(r.group_label))) return fail()
  for (const [key, idKey, ids] of [['fabrics', 'fabric_id', sourceMaterialIds], ['modifiers', 'modifier_id', sourceFabricModifierIds]] as const) {
    if (new Set(seed[key].map((r: any) => r[idKey])).size !== ids.length
      || seed[key].some((r: any) => !record(r) || !(ids as readonly string[]).includes(r[idKey])
        || !str(r.canonical_en) || !str(r.canonical_ar) || !str(r.group_id)
        || typeof r.notes !== 'string' || key === 'fabrics' && (!groups.has(r.group_id) || !str(r.canonical_fr) || !str(r.review_status)))) return fail()
  }
  for (const [key, idKey, ids] of [['fabric_aliases', 'fabric_id', sourceMaterialIds], ['modifier_aliases', 'modifier_id', sourceFabricModifierIds]] as const) {
    if (seed[key].some((r: any) => !record(r) || !(ids as readonly string[]).includes(r[idKey]) || !str(r.alias)
      || !normalizeText(r.alias) || !str(r.normalized) || !str(r.locale) || !str(r.source)
      || key === 'fabric_aliases' && (!['exact_candidate', 'review_candidate', 'needs_context'].includes(r.match_policy)
        || !['seed_review', 'needs_review'].includes(r.review_status)))) return fail()
    if (ids.some(id => !seed[key].some((r: any) => r[idKey] === id))) return fail()
  }
  if (seed.ambiguities.some((r: any) => !record(r) || !str(r.alias) || !str(r.normalized)
    || !str(r.candidate_ids) || !str(r.why_ambiguous) || !str(r.safe_default)
    || r.candidate_ids.split(';').some((id: string) => ![...sourceMaterialIds, ...sourceFabricModifierIds].includes(id as any)))) return fail()
  if (!Array.isArray(collisions.sourceDeclaredAmbiguities) || collisions.sourceDeclaredAmbiguities.length !== 50
    || collisions.sourceDeclaredAmbiguities.some((r: any, index: number) => !record(r)
      || r.sourceRecordIndex !== index || r.alias !== seed.ambiguities[index].alias
      || r.whyAmbiguous !== seed.ambiguities[index].why_ambiguous || r.safeDefault !== seed.ambiguities[index].safe_default
      || !Array.isArray(r.candidateIds) || r.candidateIds.join(';') !== seed.ambiguities[index].candidate_ids)) return fail()
  for (const [key, count] of [['fabricCrossIdKeys', 4], ['modifierCrossIdKeys', 0], ['fabricModifierOverlapKeys', 2], ['sameConceptRepeatedKeys', 41]] as const) {
    if (!Array.isArray(collisions[key]) || collisions[key].length !== count) return fail()
  }
}
const packaged = new URL('../resources/voice-sales/', import.meta.url)
const root = existsSync(new URL('materials.seed.json', packaged)) ? packaged : new URL('../../resources/voice-sales/', import.meta.url)
function load(name: string, hash: string): unknown {
  const bytes = readFileSync(new URL(name, root))
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Materials resource integrity check failed')
  return JSON.parse(bytes.toString('utf8'))
}
const seed = load('materials.seed.json', MATERIAL_SOURCE_SHA256)
export const materialSourceCollisions = freeze(load('materials.source-collisions.json', MATERIAL_COLLISIONS_SHA256))
validateMaterialResources(seed, materialSourceCollisions)
export const materialSourceResource = freeze(seed)
const compatibility: Partial<Record<SourceMaterialId, Material>> = {
  COTTON: 'COTTON', VELVET: 'VELVET', DENIM: 'DENIM', WOOL_FIBER: 'WOOL', LINEN_FIBER: 'LINEN', GENUINE_LEATHER: 'LEATHER',
}
// Language recognition cannot establish certification, origin, genuine hide or coating.
export const materialNeedsSpecification = (id: SourceMaterialId): boolean => {
  const concept = materialSourceResource.fabrics.find(row => row.fabric_id === id)!
  return ['LEATHER_FAMILY', 'COATED_FABRIC', 'ANIMAL_MATERIAL'].includes(concept.group_id)
    || ['ORGANIC_COTTON', 'EGYPTIAN_COTTON', 'PIMA_COTTON', 'RECYCLED_POLYESTER', 'RECYCLED_NYLON', 'TENCEL', 'BAMBOO_RAW', 'SILK'].includes(id)
}
export function createActiveMaterialRegistry(crossDomains: (alias: string) => readonly string[]) {
  const groups = new Map<string, MaterialAliasAudit[]>()
  const declared = new Map<string, MaterialSeed['ambiguities'][number][]>()
  for (const row of materialSourceResource.ambiguities) {
    const key = normalizeText(row.alias), list = declared.get(key) ?? []
    list.push(row); declared.set(key, list)
  }
  const audit: MaterialAliasAudit[] = []
  for (const [domain, rows] of [['fabric', materialSourceResource.fabric_aliases], ['modifier', materialSourceResource.modifier_aliases]] as const) {
    rows.forEach((row, sourceIndex) => {
      const key = normalizeText(row.alias), domains = [...new Set(crossDomains(row.alias))]
      const reasons: string[] = []
      const blocked = ['مش', 'موديل', 'جوك'].includes(key) || /^\d+$/u.test(key)
      if (blocked) reasons.push('Negation/model/noisy transcription or unattached numeric alias; never trusted as fabric.')
      if (domain === 'modifier') reasons.push('Source modifier has no linguistic review metadata; catalog context required.')
      if ('match_policy' in row && (row.match_policy !== 'exact_candidate' || row.review_status !== 'seed_review')) reasons.push('Source entry needs review/context.')
      if (declared.has(key)) reasons.push(...declared.get(key)!.map(r => r.why_ambiguous))
      if (domains.length) reasons.push('Cross-domain alias requires an explicit role or independent catalog evidence.')
      const entry: MaterialAliasAudit = { domain, sourceIndex, alias: row.alias,
        id: 'fabric_id' in row ? row.fabric_id : row.modifier_id, normalized: key, sourceNormalized: row.normalized,
        disposition: blocked ? 'blocked' : reasons.length ? 'conditional' : 'active', reasons, crossDomains: domains }
      audit.push(entry); const list = groups.get(key) ?? []; list.push(entry); groups.set(key, list)
    })
  }
  for (const rows of groups.values()) if (new Set(rows.map(row => `${row.domain}:${row.id}`)).size > 1) {
    for (const row of rows) if (row.disposition !== 'blocked') {
      Object.assign(row, { disposition: 'conditional', reasons: [...row.reasons, 'Normalized alias has multiple concept/domain interpretations.'] })
    }
  }
  // Source ambiguity relationships add alternatives even where the seed assigned one ID.
  const index = new Map<string, SourceMaterialLookup>()
  for (const [key, records] of groups) {
    const usable = records.filter(row => row.disposition !== 'blocked')
    const ambiguities = declared.get(key) ?? []
    const fabricIds = new Set(usable.filter(r => r.domain === 'fabric').map(r => r.id as SourceMaterialId))
    const modifierIds = new Set(usable.filter(r => r.domain === 'modifier').map(r => r.id as typeof sourceFabricModifierIds[number]))
    if (usable.length) for (const ambiguity of ambiguities) for (const id of ambiguity.candidate_ids.split(';')) {
      if ((sourceMaterialIds as readonly string[]).includes(id)) fabricIds.add(id as SourceMaterialId)
      else modifierIds.add(id as typeof sourceFabricModifierIds[number])
    }
    // Stretch is an observable property, never an implicit fiber/composition claim.
    if (modifierIds.has('STRETCH') && ['stretch', 'ستريتش'].includes(key)) fabricIds.clear()
    const fabrics = [...fabricIds], modifiers = [...modifierIds]
    index.set(key, freeze({ alias: key, status: !usable.length ? 'blocked'
      : usable.some(row => row.disposition === 'conditional') || fabrics.length + modifiers.length > 1 ? 'context_required' : 'matched',
      fabrics, modifiers, records, ambiguities, crossDomains: [...new Set(records.flatMap(r => r.crossDomains))],
      legacyMaterial: fabrics.length === 1 ? compatibility[fabrics[0]] ?? null : null }))
  }
  freeze(audit)
  const maxTokens = Math.max(...[...index.keys()].map(key => tokenizeText(key).length))
  const lookup = (text: string): SourceMaterialLookup => index.get(normalizeText(text)) ?? freeze({
    status: 'unknown', alias: normalizeText(text), fabrics: [], modifiers: [], records: [], ambiguities: [], crossDomains: [], legacyMaterial: null,
  })
  return Object.freeze({ audit, lookup,
    coverage: Object.freeze({ concepts: 147, modifiers: 35, fabricAliasRecords: 1133, modifierAliasRecords: 288, uniqueKeys: index.size,
      active: audit.filter(r => r.disposition === 'active').length, conditional: audit.filter(r => r.disposition === 'conditional').length,
      blocked: audit.filter(r => r.disposition === 'blocked').length }),
    matchTokens: (text: string) => matchLongestAliases(text, maxTokens, phrase => index.get(phrase)),
  })
}
