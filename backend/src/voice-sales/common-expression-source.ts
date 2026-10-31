import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { commonExpressionIds, commonExpressionCategories } from './common-expression-ids.js'
import { normalizeText, tokenizeText } from './normalization.js'
import { matchLongestAliases } from './dictionary.js'
import type { CommonExpressionSeed, ExpressionAliasAudit, ExpressionLookup } from './common-expression.types.js'
import type { CommonExpressionId } from './common-expression-ids.js'

export const COMMON_EXPRESSION_HASHES = Object.freeze({
  seed: '9d8360fadbcc5e48f42bd6e8cf019d206bc3e32574c9bf32dcbb629e0d9e2ad0',
  collisions: '1efced26636a7597c9ceb50cf97120140ca86704e111d1b02dda274ebdde8c2d',
  ambiguities: 'c1cc46394b02caad8dbe44d4c1738d0001e63b20923edc0fe75acc7038222cc1',
})
export function freezeExpressions<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeExpressions); Object.freeze(value) }
  return value
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const string = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const ids: readonly string[] = commonExpressionIds
const categories: readonly string[] = commonExpressionCategories
export function validateCommonExpressionResources(seed: unknown, collisions: unknown, ambiguities: unknown): asserts seed is CommonExpressionSeed {
  const fail = () => { throw new Error('Invalid packaged Common Expressions resource') }
  if (!record(seed) || !record(seed.meta) || !record(seed.meta.statistics) || !record(collisions) || !record(ambiguities)) return fail()
  for (const [key, count, meta] of [['expressions', 141, 'entries'], ['alias_index', 1297, 'aliases'], ['categories', 18, 'categories'],
    ['collisions', 6, 'normalized_collisions'], ['ambiguities', 52, 'ambiguous_terms']] as const) {
    if (!Array.isArray(seed[key]) || seed[key].length !== count || seed.meta.statistics[meta] !== count) return fail()
  }
  if (new Set(seed.categories.map((r: any) => r?.id)).size !== 18
    || seed.categories.some((r: any) => !record(r) || !categories.includes(r.id) || !string(r.name))) return fail()
  if (new Set(seed.expressions.map((r: any) => r?.expression_id)).size !== 141
    || seed.expressions.some((r: any) => !record(r) || !ids.includes(r.expression_id) || !categories.includes(r.category)
      || !['label_en', 'label_ar', 'intent'].every(k => string(r[k])) || r.review_status !== 'seed_unvalidated'
      || !['none', 'context_required', 'workflow_validation'].includes(r.handling)
      || !Array.isArray(r.aliases) || !r.aliases.length || !r.aliases.every(string))) return fail()
  if (seed.alias_index.some((r: any) => !record(r) || !string(r.alias) || !normalizeText(r.alias)
    || !string(r.normalized_key) || !Number.isSafeInteger(r.token_count) || r.token_count < 1
    || !['none', 'workflow_validation', 'context'].includes(r.risk)
    || !ids.includes(r.expression_id) || !categories.includes(r.category)
    || seed.expressions.find((c: any) => c.expression_id === r.expression_id)?.category !== r.category
    || !seed.expressions.find((c: any) => c.expression_id === r.expression_id)?.aliases.includes(r.alias))) return fail()
  if (seed.expressions.some((c: any) => c.aliases.some((alias: string) => !seed.alias_index.some((r: any) => r.expression_id === c.expression_id && r.alias === alias)))) return fail()
  if (seed.collisions.some((r: any) => !record(r) || !string(r.normalized_key) || !string(r.action)
    || !Array.isArray(r.expression_ids) || r.expression_ids.length < 2 || new Set(r.expression_ids).size !== r.expression_ids.length
    || r.expression_ids.some((id: string) => !ids.includes(id) || !seed.alias_index.some((a: any) => a.expression_id === id && a.normalized_key === r.normalized_key)))) return fail()
  if (seed.ambiguities.some((r: any) => !record(r) || !ids.includes(r.expression_id)
    || !['phrase', 'reason', 'action'].every(k => string(r[k])))) return fail()
  if (JSON.stringify(collisions.collisions) !== JSON.stringify(seed.collisions)
    || JSON.stringify(ambiguities.ambiguities) !== JSON.stringify(seed.ambiguities)) return fail()
}
const packaged = new URL('../resources/voice-sales/', import.meta.url)
const root = existsSync(new URL('common-expressions.seed.json', packaged)) ? packaged : new URL('../../resources/voice-sales/', import.meta.url)
function load(name: keyof typeof COMMON_EXPRESSION_HASHES): unknown {
  const bytes = readFileSync(new URL(`common-expressions.${name}.json`, root))
  if (createHash('sha256').update(bytes).digest('hex') !== COMMON_EXPRESSION_HASHES[name]) throw new Error('Common Expressions resource integrity check failed')
  return JSON.parse(bytes.toString('utf8'))
}
const seed = load('seed')
export const commonExpressionCollisions = freezeExpressions(load('collisions'))
export const commonExpressionAmbiguities = freezeExpressions(load('ambiguities'))
validateCommonExpressionResources(seed, commonExpressionCollisions, commonExpressionAmbiguities)
export const commonExpressionSource = freezeExpressions(seed)

/** All records remain inspectable; exact lexical recognition never grants workflow authority. */
export function createCommonExpressionRegistry(crossDomains: (alias: string) => readonly string[]) {
  const seed = commonExpressionSource
  const groups = new Map<string, ExpressionAliasAudit[]>()
  const ambiguityGroups = new Map<string, CommonExpressionSeed['ambiguities'][number][]>()
  for (const row of seed.ambiguities) {
    const key = normalizeText(row.phrase), group = ambiguityGroups.get(key) ?? []
    group.push(row); ambiguityGroups.set(key, group)
  }
  const audit: ExpressionAliasAudit[] = seed.alias_index.map((row, sourceIndex) => {
    const normalized = normalizeText(row.alias), domains = [...new Set(crossDomains(row.alias))]
    const reasons: string[] = []
    // A visibly uncertain seed spelling stays a suggestion rather than becoming trusted vocabulary.
    const suggestion = normalized === 'محتاين'
    if (suggestion) reasons.push('Uncertain seed spelling; dialect/transcription validation required.')
    if (row.risk !== 'none') reasons.push(`Source risk: ${row.risk}; recognition only.`)
    if (ambiguityGroups.has(normalized)) reasons.push('Declared ambiguous phrase requires context.')
    if (domains.length) reasons.push('Cross-domain overlap; retain attribute and language roles.')
    const entry: ExpressionAliasAudit = { ...row, sourceIndex, normalized, crossDomains: domains, reasons,
      disposition: suggestion ? 'suggestion' : reasons.length ? 'conditional' : 'active' }
    const group = groups.get(normalized) ?? []; group.push(entry); groups.set(normalized, group)
    return entry
  })
  for (const rows of groups.values()) if (new Set(rows.map(r => r.expression_id)).size > 1) {
    for (const row of rows) Object.assign(row, { disposition: 'conditional', reasons: [...row.reasons, 'Runtime normalized key has multiple intents.'] })
  }
  for (const key of ambiguityGroups.keys()) if (!groups.has(key)) groups.set(key, [])
  const index = new Map<string, ExpressionLookup>()
  for (const [key, rows] of groups) {
    const ambiguities = ambiguityGroups.get(key) ?? []
    const candidates = [...new Set([...rows.map(row => row.expression_id), ...ambiguities.map(row => row.expression_id)])]
    index.set(key, freezeExpressions({ status: rows.length && rows.every(r => r.disposition === 'suggestion') ? 'suggestion'
      : candidates.length > 1 || ambiguities.length || rows.some(r => r.disposition === 'conditional') ? 'context_required' : 'matched',
      candidates, records: rows, ambiguities, crossDomains: [...new Set(rows.flatMap(r => r.crossDomains))] }))
  }
  // Retain existing CONFIRM aliases omitted by this kit. They stay recognition-only,
  // not a new authority or an unreported extra source record.
  for (const alias of ['Confirm', 'أكيد', 'Akid']) {
    const key = normalizeText(alias)
    if (!index.has(key)) index.set(key, freezeExpressions({ status: 'context_required', candidates: ['CONF_YES'],
      records: [], ambiguities: [], crossDomains: ['legacyExpressions:CONFIRM'] }))
  }
  const maxTokens = Math.max(...[...index.keys()].map(key => tokenizeText(key).length))
  const unknown: ExpressionLookup = freezeExpressions({ status: 'unknown', candidates: [], records: [], ambiguities: [], crossDomains: [] })
  const count = (disposition: ExpressionAliasAudit['disposition']) => audit.filter(row => row.disposition === disposition).length
  const sourceById = new Map(seed.expressions.map(row => [row.expression_id, row]))
  return Object.freeze({ audit: freezeExpressions(audit),
    concept: (id: CommonExpressionId) => sourceById.get(id)!,
    lookup: (text: string) => index.get(normalizeText(text)) ?? unknown,
    matchTokens: (text: string) => matchLongestAliases(text, maxTokens, phrase => index.get(phrase)),
    coverage: Object.freeze({ concepts: 141, categories: 18, aliasRecords: 1297, active: count('active'),
      conditional: count('conditional'), suggestions: count('suggestion'), blocked: count('suggestion'), invalid: 0,
      unsupported: 0, uniqueKeys: index.size, duplicateRecords: audit.length - new Set(audit.map(r => `${r.expression_id}:${r.normalized}`)).size,
      runtimeCollisionKeys: [...index.values()].filter(r => r.candidates.length > 1).length,
      normalizationDifferences: audit.filter(r => r.normalized !== r.normalized_key).length,
      crossDomainRecords: audit.filter(r => r.crossDomains.length).length }),
  })
}
