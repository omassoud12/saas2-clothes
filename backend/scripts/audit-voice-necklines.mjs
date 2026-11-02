import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { activeNecklines, necklineSourceResource as seed, normalizeText } from '../.test-dist/voice-sales/index.js'
import { parseVoiceSaleText } from '../.test-dist/voice-sales/parser.js'

const repository = new URL('../../voice-dictionaries/08-necklines-collars/', import.meta.url)
const folders = readdirSync(repository, { withFileTypes: true }).filter(d => d.isDirectory()
  && d.name.startsWith('SAAS2_Necklines_Collars_Dictionary_Integration_Kit')
  && existsSync(new URL(`${d.name}/data/necklines.seed.json`, repository)))
assert.equal(folders.length, 1, 'Exactly one complete Necklines integration kit is required')
const kit = new URL(`${folders[0].name}/`, repository), manifest = JSON.parse(readFileSync(new URL('manifest.json', kit), 'utf8'))
const requiredFiles = manifest.integration_files.map(file => {
  const bytes = readFileSync(new URL(file, kit))
  return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
})
assert.equal(requiredFiles.find(f => f.file === manifest.imported_seed_path).sha256, manifest.imported_seed_sha256)
const archive = readFileSync(new URL('reference/SAAS2_Necklines_Collars_TypeScript_Complete.original.zip', kit))
const archiveHash = createHash('sha256').update(archive).digest('hex')
assert.equal(archiveHash, manifest.source_sha256)
for (const [key, expected] of Object.entries({ styles: 92, style_aliases: 807, modifiers: 38, modifier_aliases: 234, ambiguities: 34, test_cases: 18 })) {
  assert.equal(seed[key].length, expected)
}
assert.equal(seed.styles.filter(r => r.group === 'neckline_shape').length, 45)
assert.equal(seed.styles.filter(r => r.group === 'collar_type').length, 47)
const keyGroups = new Map()
for (const record of activeNecklines.audit) {
  const rows = keyGroups.get(record.normalized) ?? []; rows.push(record); keyGroups.set(record.normalized, rows)
}
const runtimeCollisions = [...keyGroups].filter(([, rows]) => new Set(rows.map(r => `${r.domain}:${r.id}`)).size > 1)
  .map(([key, rows]) => ({ key, identities: [...new Set(rows.map(r => `${r.domain}:${r.id}`))], records: rows }))
const baseline = JSON.parse(readFileSync(new URL('../../.tools/necklines-baseline/parser-before.json', import.meta.url), 'utf8'))
const fixtures = seed.test_cases.map(fixture => {
  const parser = parseVoiceSaleText(fixture.input_text)
  const candidates = [...new Set(parser.necklineCandidates.flatMap(m => [...m.result.shapes, ...m.result.collars, ...m.result.modifiers]))]
  const member = fixture.expected_style_id === 'NONE' ? !candidates.length : candidates.includes(fixture.expected_style_id)
  assert.equal(member, true, fixture.input_text)
  return { fixture, expectedCandidatePreserved: member,
    sourceReviewFlagIsAuthoritative: false,
    actualRequiresNecklineContext: parser.unresolvedInformation.includes('neckline'),
    before: baseline.find(b => b.text === fixture.input_text).parser,
    after: parser }
})
const editorialAlternatives = activeNecklines.audit.filter(r => r.alias.includes('|')).flatMap(r => r.alias.split('|').map(part => ({
  sourceIndex: r.sourceIndex, sourceId: r.id, rawPart: part, normalized: normalizeText(part), result: activeNecklines.lookup(part) })))
const stats = domain => {
  const rows = activeNecklines.audit.filter(r => r.domain === domain)
  const keys = new Map()
  rows.forEach(r => { const group = keys.get(r.normalized) ?? []; group.push(r); keys.set(r.normalized, group) })
  return { records: rows.length, uniqueSourceKeys: keys.size, duplicateKeys: [...keys.values()].filter(r => r.length > 1).length,
    crossIdKeys: [...keys.values()].filter(r => new Set(r.map(r => r.id)).size > 1).length }
}
const report = { kitPath: kit.pathname, manifestCounts: manifest.source_counts, requiredFiles,
  sourceArchive: { sha256: archiveHash, verified: true }, coverage: activeNecklines.coverage,
  runtimeStyleKeys: stats('style'), runtimeModifierKeys: stats('modifier'), runtimeCollisions,
  sourceNormalizedDifferences: activeNecklines.audit.filter(r => r.sourceNormalized !== r.normalized),
  normalizationPolicy: 'Only raw alias text enters existing normalizeText. Preserve ة and Latin accents; never import standalone folded normalized_key as an alias.',
  aliasAudit: activeNecklines.audit, editorialAlternatives,
  declaredAmbiguities: seed.ambiguities,
  crossDomainRecords: activeNecklines.audit.filter(r => r.crossDomains.length), fixtures,
  sourceFixtureMembershipPass: fixtures.length,
  limitations: ['Source review:false is overridden where its own ambiguity table or runtime collisions require alternatives.',
    'Polo product-role interpretation is retained without inventing an additional collar property.',
    'Unknown brand/model terms remain real name constraints. Category alone cannot prove a new neckline/collar.',
    'This audit is pure language and synthetic-catalog testing; no live Supabase connection.'],
  liveSupabase: false, databaseCalls: 0, writes: 0 }
writeFileSync(new URL('../src/voice-sales/NECKLINES_AUDIT.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ coverage: report.coverage, styles: report.runtimeStyleKeys, modifiers: report.runtimeModifierKeys,
  runtimeCollisionKeys: runtimeCollisions.length, normalizedDifferences: report.sourceNormalizedDifferences.length,
  crossDomainRecords: report.crossDomainRecords.length, sourceFixtureMembershipPass: fixtures.length, editorialParts: editorialAlternatives.length }, null, 2))
