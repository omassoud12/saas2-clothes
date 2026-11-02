import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { activeCommonExpressions, commonExpressionSource as seed } from '../.test-dist/voice-sales/index.js'
import { parseVoiceSaleText } from '../.test-dist/voice-sales/parser.js'

const repository = new URL('../../voice-dictionaries/09-common-expressions/', import.meta.url)
const folders = readdirSync(repository, { withFileTypes: true }).filter(entry => entry.isDirectory()
  && /^SAAS2_Common_Expressions_Dictionary_Integration_Kit(?: \(\d+\))?$/.test(entry.name)
  && existsSync(new URL(`${entry.name}/data/common-expressions.seed.json`, repository)))
assert.equal(folders.length, 1, 'Exactly one complete Common Expressions kit is required')
const kit = new URL(`${folders[0].name}/`, repository)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', kit), 'utf8'))
const requiredFiles = Object.entries(manifest.sha256).map(([file, expected]) => {
  const bytes = readFileSync(new URL(file, kit)), sha256 = createHash('sha256').update(bytes).digest('hex')
  assert.equal(sha256, expected, file)
  return { file, bytes: bytes.length, sha256, verified: true }
})
for (const [key, count] of Object.entries({ expressions: 141, alias_index: 1297, categories: 18, collisions: 6, ambiguities: 52 })) {
  assert.equal(seed[key].length, count)
}
for (const kind of ['seed', 'collisions', 'ambiguities']) assert.deepEqual(
  readFileSync(new URL(`data/common-expressions.${kind}.json`, kit)),
  readFileSync(new URL(`../resources/voice-sales/common-expressions.${kind}.json`, import.meta.url)))
const groups = new Map()
for (const row of activeCommonExpressions.audit) {
  const rows = groups.get(row.normalized) ?? []; rows.push(row); groups.set(row.normalized, rows)
}
const runtimeCollisions = [...groups].filter(([, rows]) => new Set(rows.map(row => row.expression_id)).size > 1)
  .map(([normalized, rows]) => ({ normalized, candidates: [...new Set(rows.map(row => row.expression_id))], rows }))
const fixtures = JSON.parse(readFileSync(new URL('reference/common-expressions-smoke-test-cases.json', kit), 'utf8')).cases.map(fixture => {
  const parser = parseVoiceSaleText(fixture.input)
  const candidates = parser.commonExpressionMatches.flatMap(row => row.candidates)
  const passed = fixture.expectIntentOneOf.length ? fixture.expectIntentOneOf.some(id => candidates.includes(id)) : !candidates.length
  assert.equal(passed, true, fixture.id)
  return { fixture, candidateMembershipPassed: passed, after: parser }
})
const report = { kit: folders[0].name, requiredFiles, coverage: activeCommonExpressions.coverage,
  categoryCoverage: seed.categories.map(category => ({ category: category.id,
    concepts: seed.expressions.filter(r => r.category === category.id).length,
    aliasRecords: seed.alias_index.filter(r => r.category === category.id).length,
    active: activeCommonExpressions.audit.filter(r => r.category === category.id && r.disposition === 'active').length,
    conditional: activeCommonExpressions.audit.filter(r => r.category === category.id && r.disposition === 'conditional').length,
    suggestions: activeCommonExpressions.audit.filter(r => r.category === category.id && r.disposition === 'suggestion').length })),
  sourceArchive: { manifestReportedSha256: manifest.source_archive_sha256, archiveBytesIndependentlyVerified: false,
    reason: 'The original Complete ZIP is not a required kit file; all imported data/reference bytes were independently verified against the manifest.' },
  originalRiskCounts: Object.fromEntries(['none', 'workflow_validation', 'context'].map(risk => [risk, seed.alias_index.filter(r => r.risk === risk).length])),
  handlingCounts: Object.fromEntries(['none', 'workflow_validation', 'context_required'].map(h => [h, seed.expressions.filter(r => r.handling === h).length])),
  sourceDeclaredCollisions: seed.collisions, sourceDeclaredAmbiguities: seed.ambiguities,
  runtimeCollisions, aliasAudit: activeCommonExpressions.audit,
  normalizedKeyDifferences: activeCommonExpressions.audit.filter(r => r.normalized !== r.normalized_key),
  crossDomainRecords: activeCommonExpressions.audit.filter(r => r.crossDomains.length),
  compatibilityAliases: { existingLegacyConfirmAliases: ['Confirm', 'أكيد', 'Akid'], sourceId: 'CONF_YES',
    sourceAliasCountsUnchanged: true, recognitionOnly: true },
  sourceFixtureMembershipPassed: fixtures.length, fixtures,
  fixtureCorrections: ['bdi 2 tshirt soda size L: bare 2 remains unresolved, soda remains a color suggestion; source assertions cannot override existing quantity/color safety.',
    'بدي تلات كنزات: unqualified تلات remains unresolved quantity; no piece-unit inference.',
    'Rejection/cancellation are advisory; positive L after the exact rejected-size phrase is retained without an eligible sale preview.'],
  normalizationPolicy: 'Use raw aliases through shared normalizeText; preserve ة and French accents. Source normalized_key is traceability metadata only.',
  safetyPolicy: 'All cues recognitionOnly=true and authorizesAction=false. Only affirmative WANT/NEED/SEARCH prefixes or existing attribute grammar can permit advisory catalog comparison. Non-sale/ambiguous/negated cues prevent a sale preview.',
  liveSupabase: false, databaseCalls: 0, writes: 0 }
writeFileSync(new URL('../src/voice-sales/COMMON_EXPRESSIONS_AUDIT.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ requiredFilesVerified: requiredFiles.length, coverage: report.coverage,
  originalRiskCounts: report.originalRiskCounts, handlingCounts: report.handlingCounts, smokeCases: fixtures.length }, null, 2))
