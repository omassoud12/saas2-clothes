import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { normalizeText, tokenizeText } from './normalization.js'
import { matchLongestAliases } from './dictionary.js'
import { sourceNecklineShapeIds, sourceCollarTypeIds, sourceNecklineModifierIds } from './neckline-source-ids.js'
import type { SourceNecklineShapeId, SourceCollarTypeId, SourceNecklineModifierId, SourceNecklineStyleId } from './neckline-source-ids.js'
import type { NecklineAliasAudit, NecklineSeed, SourceNecklineLookup } from './neckline-source.types.js'

export const NECKLINE_SOURCE_SHA256 = '0178ce4499f5236e2cdfecc27aad538f84b8a55e9f71931077371affaffe7ddc'
export const NECKLINE_COLLISIONS_SHA256 = 'ba0d834fe07475af315ffc7b3531b4ece2e0dc075b1e5a6be424b32679667e44'
export function freezeNeckline<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeNeckline); Object.freeze(value) }
  return value
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const styleIds = [...sourceNecklineShapeIds, ...sourceCollarTypeIds]
export function validateNecklineResources(seed: unknown, collisions: unknown): asserts seed is NecklineSeed {
  const fail = () => { throw new Error('Invalid packaged Necklines resource') }
  if (!record(seed) || !record(seed.meta) || !record(seed.meta.units) || !record(collisions)) return fail()
  for (const [key, count, meta] of [['styles', 92, 'style_entries'], ['style_aliases', 807, 'style_aliases'],
    ['modifiers', 38, 'modifiers'], ['modifier_aliases', 234, 'modifier_aliases'], ['ambiguities', 34, 'ambiguity_records'], ['test_cases', 18, 'test_cases']] as const) {
    if (!Array.isArray(seed[key]) || seed[key].length !== count || seed.meta.units[meta] !== count) return fail()
  }
  if (new Set(seed.styles.map((r: any) => r.style_id)).size !== 92
    || seed.styles.some((r: any) => !record(r) || !styleIds.includes(r.style_id)
      || !(r.group === 'neckline_shape' ? sourceNecklineShapeIds : r.group === 'collar_type' ? sourceCollarTypeIds : []).includes(r.style_id as never)
      || !['english', 'arabic_fusha', 'lebanese', 'syrian', 'french', 'source', 'review_status'].every(k => str(r[k])) || typeof r.description !== 'string'
      || !Array.isArray(r.aliases) || !r.aliases.every(str) || !Number.isInteger(r.alias_count))) return fail()
  if (new Set(seed.modifiers.map((r: any) => r.modifier_id)).size !== 38
    || seed.modifiers.some((r: any) => !record(r) || !sourceNecklineModifierIds.includes(r.modifier_id)
      || !['slot', 'english', 'arabic', 'rule'].every(k => str(r[k])) || !Array.isArray(r.aliases) || !r.aliases.every(str))) return fail()
  for (const [key, idKey, ids, concepts] of [['style_aliases', 'style_id', styleIds, seed.styles],
    ['modifier_aliases', 'modifier_id', sourceNecklineModifierIds, seed.modifiers]] as const) {
    if (seed[key].some((r: any) => !record(r) || !ids.includes(r[idKey] as never)
      || !str(r.alias) || !normalizeText(r.alias) || !str(r.normalized_key)
      || key === 'style_aliases' && (!str(r.script) || !str(r.locale_group) || !['default', 'review', 'ambiguous'].includes(r.review_priority)
        || r.group !== concepts.find((c: any) => c[idKey] === r[idKey])?.group)
      || key === 'modifier_aliases' && (!str(r.rule) || r.slot !== concepts.find((c: any) => c[idKey] === r[idKey])?.slot))) return fail()
    if (ids.some(id => !seed[key].some((r: any) => r[idKey] === id))) return fail()
  }
  const external = new Set(['PRODUCT_POLO_SHIRT', 'SIZE/OTHER', 'PRODUCT_CUT', 'GENERAL_PHRASE', 'PRODUCT_DESIGN',
    'MOD_EXPOSURE', 'PRODUCT_WRAP', 'FABRIC_FUR', 'MATERIAL_LACE', 'PRODUCT_DRESS'])
  if (seed.ambiguities.some((r: any) => !record(r) || !['phrase', 'candidates', 'reason', 'action', 'severity'].every(k => str(r[k]))
    || r.candidates.split('|').some((id: string) => !styleIds.includes(id as never) && !sourceNecklineModifierIds.includes(id as never) && !external.has(id)))) return fail()
  if (JSON.stringify(collisions.source_declared_ambiguities) !== JSON.stringify(seed.ambiguities)
    || seed.test_cases.some((r: any) => !record(r) || !str(r.input_text) || typeof r.expect_review !== 'boolean'
      || r.expected_style_id !== 'NONE' && !styleIds.includes(r.expected_style_id))) return fail()
}
const packaged = new URL('../resources/voice-sales/', import.meta.url)
const root = existsSync(new URL('necklines.seed.json', packaged)) ? packaged : new URL('../../resources/voice-sales/', import.meta.url)
function load(name: string, hash: string): unknown {
  const bytes = readFileSync(new URL(name, root))
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Necklines resource integrity check failed')
  return JSON.parse(bytes.toString('utf8'))
}
const seed = load('necklines.seed.json', NECKLINE_SOURCE_SHA256)
export const necklineSourceCollisions = freezeNeckline(load('necklines.source-collisions.json', NECKLINE_COLLISIONS_SHA256))
validateNecklineResources(seed, necklineSourceCollisions)
export const necklineSourceResource = freezeNeckline(seed)

export function createActiveNecklineRegistry(crossDomains: (alias: string) => readonly string[]) {
  const groups = new Map<string, NecklineAliasAudit[]>()
  const declared = new Map<string, NecklineSeed['ambiguities'][number][]>()
  for (const ambiguity of necklineSourceResource.ambiguities) {
    const key = normalizeText(ambiguity.phrase), rows = declared.get(key) ?? []
    rows.push(ambiguity); declared.set(key, rows)
  }
  const audit: NecklineAliasAudit[] = []
  for (const [domain, rows] of [['style', necklineSourceResource.style_aliases], ['modifier', necklineSourceResource.modifier_aliases]] as const) rows.forEach((row, sourceIndex) => {
    const normalized = normalizeText(row.alias), domains = [...new Set(crossDomains(row.alias))]
    const reasons: string[] = []
    const blocked = row.alias.includes('|')
    if (blocked) reasons.push('Editorial alternatives separated by | are not one spoken phrase; register each exact part separately.')
    if (domain === 'modifier') reasons.push('Neckline role and independently stored product-name evidence required.')
    if ('review_priority' in row && row.review_priority !== 'default') reasons.push('Source review-priority alias requires context.')
    if (declared.has(normalized)) reasons.push(...declared.get(normalized)!.map(r => r.reason))
    if (domains.length) reasons.push('Existing dictionary domain overlap; retain role alternatives.')
    const entry: NecklineAliasAudit = { domain, sourceIndex, id: 'style_id' in row ? row.style_id : row.modifier_id,
      alias: row.alias, normalized, sourceNormalized: row.normalized_key,
      disposition: blocked ? 'blocked' : reasons.length ? 'conditional' : 'active', reasons, crossDomains: domains }
    audit.push(entry)
    // Preserve the complete source record; the literal pipe concatenation is never a trusted alias.
    if (!blocked) { const group = groups.get(normalized) ?? []; group.push(entry); groups.set(normalized, group) }
    else for (const part of row.alias.split('|')) {
      const key = normalizeText(part), group = groups.get(key) ?? []
      group.push({ ...entry, alias: part, normalized: key, disposition: 'conditional',
        reasons: ['Exact alternative extracted from the source editorial phrase.', ...(declared.get(key) ?? []).map(a => a.reason)], crossDomains: crossDomains(part) })
      groups.set(key, group)
    }
  })
  for (const rows of groups.values()) if (new Set(rows.map(r => `${r.domain}:${r.id}`)).size > 1) {
    for (const row of rows) Object.assign(row, { disposition: 'conditional', reasons: [...row.reasons, 'Runtime normalized key has multiple identities.'] })
  }
  // Declared ambiguity phrases are active recognizers even if absent from style_aliases.
  for (const key of declared.keys()) if (!groups.has(key)) groups.set(key, [])
  // Explicit backwards-compatible phrases are owned by the existing dictionary, not invented products.
  const legacy: Record<string, readonly (SourceNecklineStyleId | SourceNecklineModifierId)[]> = {
    'قبة polo': ['COLLAR_POLO'],
    '2abbet polo': ['COLLAR_POLO'], '2abbet v': ['NECK_V'], '2abbe mabroume': ['COLLAR_RIBBED', 'TRIM_ROLLED', 'NECK_CREW'],
    'قبة في': ['NECK_V'],
  }
  for (const key of Object.keys(legacy)) if (!groups.has(key)) groups.set(key, [])
  const index = new Map<string, SourceNecklineLookup>()
  for (const [key, records] of groups) {
    const ambiguities = declared.get(key) ?? []
    const ids = new Set<string>(records.map(r => r.id))
    for (const row of ambiguities) row.candidates.split('|').forEach(id => ids.add(id))
    legacy[key]?.forEach(id => ids.add(id))
    const shapes = [...ids].filter(id => (sourceNecklineShapeIds as readonly string[]).includes(id)) as SourceNecklineShapeId[]
    const collars = [...ids].filter(id => (sourceCollarTypeIds as readonly string[]).includes(id)) as SourceCollarTypeId[]
    const modifiers = [...ids].filter(id => (sourceNecklineModifierIds as readonly string[]).includes(id)) as SourceNecklineModifierId[]
    const externalRoles = [...ids].filter(id => !styleIds.includes(id as never) && !sourceNecklineModifierIds.includes(id as never))
    index.set(key, freezeNeckline({ status: ambiguities.length || ids.size > 1 || records.some(r => r.disposition === 'conditional') ? 'context_required' : 'matched',
      shapes, collars, modifiers, externalRoles, records, ambiguities, crossDomains: [...new Set([...records.flatMap(r => r.crossDomains), ...crossDomains(key)])] }))
  }
  freezeNeckline(audit)
  const maxTokens = Math.max(...[...index.keys()].map(key => tokenizeText(key).length))
  const unknown: SourceNecklineLookup = freezeNeckline({ status: 'unknown', shapes: [], collars: [], modifiers: [], externalRoles: [], records: [], ambiguities: [], crossDomains: [] })
  const count = (domain: 'style' | 'modifier', disposition: NecklineAliasAudit['disposition']) => audit.filter(r => r.domain === domain && r.disposition === disposition).length
  return Object.freeze({ audit, lookup: (text: string) => index.get(normalizeText(text)) ?? unknown,
    coverage: Object.freeze({ shapes: 45, collars: 47, styles: 92, modifiers: 38, styleAliases: 807, modifierAliases: 234,
      styleActive: count('style', 'active'), styleConditional: count('style', 'conditional'), styleBlocked: count('style', 'blocked'),
      modifierActive: count('modifier', 'active'), modifierConditional: count('modifier', 'conditional'), modifierBlocked: count('modifier', 'blocked'), uniqueKeys: index.size }),
    matchTokens: (text: string) => matchLongestAliases(text, maxTokens, phrase => index.get(phrase)),
  })
}
