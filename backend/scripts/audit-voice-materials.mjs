import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { activeMaterials, materialSourceResource as seed, normalizeText } from '../.test-dist/voice-sales/index.js'
import { parseVoiceSaleText } from '../.test-dist/voice-sales/parser.js'
import { createVoiceMatchingService } from '../.test-dist/voice-sales/matching.service.js'

// Actual extracted kit, including Windows suffixes; no environment or database reads.
const repository = new URL('../../voice-dictionaries/05-materials-fabrics/', import.meta.url)
const folder = readdirSync(repository, { withFileTypes: true }).filter(d => d.isDirectory()
  && d.name.startsWith('SAAS2_Materials_Fabrics_Dictionary_Integration_Kit')
  && existsSync(new URL(`${d.name}/data/materials.seed.json`, repository)))
assert.equal(folder.length, 1, 'One complete Materials integration kit is required')
const kit = new URL(`${folder[0].name}/`, repository)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', kit), 'utf8'))
const hashes = Object.entries(manifest.sha256).map(([file, expected]) => {
  const bytes = readFileSync(new URL(file, kit)), sha256 = createHash('sha256').update(bytes).digest('hex')
  assert.equal(sha256, expected, file)
  return { file, sha256, verified: true }
})
function csvRows(text) {
  const rows = [], row = []; let cell = '', quoted = false
  text = text.replace(/^\uFEFF/u, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (!quoted && c === ',') { row.push(cell); cell = '' }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); if (row.some(Boolean)) rows.push([...row]); row.length = 0; cell = ''
    } else cell += c
  }
  if (row.length || cell) { row.push(cell); rows.push([...row]) }
  return rows
}
const originalCsv = []
for (const [file, group] of Object.entries({ saas2_fabrics: 'fabrics', saas2_fabric_aliases: 'fabric_aliases',
  saas2_fabric_modifiers: 'modifiers', saas2_fabric_modifier_aliases: 'modifier_aliases',
  saas2_fabric_categories: 'groups', saas2_fabric_ambiguities: 'ambiguities', saas2_fabric_parser_test_cases: 'test_cases' })) {
  const rows = csvRows(readFileSync(new URL(`reference/original-source/${file}.csv`, kit), 'utf8'))
  assert.equal(rows.length - 1, seed[group].length, file)
  rows.slice(1).forEach((row, index) => rows[0].forEach((key, cell) => assert.equal(row[cell], String(seed[group][index][key] ?? ''), `${file}:${index}:${key}`)))
  originalCsv.push({ file, rows: rows.length - 1, columns: rows[0], verified: true })
}
const keyGroups = new Map()
for (const row of activeMaterials.audit) {
  const group = keyGroups.get(row.normalized) ?? []; group.push(row); keyGroups.set(row.normalized, group)
}
const collisions = [...keyGroups].filter(([, rows]) => new Set(rows.map(r => `${r.domain}:${r.id}`)).size > 1)
  .map(([key, rows]) => ({ key, targets: [...new Set(rows.map(r => `${r.domain}:${r.id}`))], records: rows }))
const cases = JSON.parse(readFileSync(new URL('reference/material-smoke-test-cases.json', kit), 'utf8'))
const baselineFile = new URL('../../.tools/materials-baseline/parser.json', import.meta.url)
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : []
const sourceCases = cases.cases.map(fixture => {
  const parsed = parseVoiceSaleText(fixture.text)
  const actualIds = [...new Set((parsed.materialCandidates ?? []).flatMap(row => [...row.result.fabrics, ...row.result.modifiers]))]
  const percentages = (parsed.materialComposition ?? []).filter(row => row.status === 'requested').map(row => String(row.percentage))
  const agreement = fixture.origin !== 'source' ? null : JSON.stringify([...actualIds].sort()) === JSON.stringify([...fixture.expectedSourceIds].sort())
    && JSON.stringify(percentages) === JSON.stringify(fixture.expectedCompositionPercent)
  if (fixture.origin === 'source') {
    if (fixture.id === 'SRC_010') assert.deepEqual(actualIds.sort(), ['FLEECE', 'POLAR_FLEECE'])
    else assert.equal(agreement, true, fixture.id)
  }
  return { fixture, sourceExpectationUnchanged: true, exactIdAndPercentageAgreement: agreement,
    reconciliation: agreement === false ? 'SRC_010 expects POLAR_FLEECE alone but the same source declares polaire FLEECE/POLAR_FLEECE ambiguous; both retained, never forced.' : null,
    before: baseline.find(row => row.id === fixture.id)?.parser ?? null,
    after: { sourceMaterial: parsed.sourceMaterial, materialCandidates: parsed.materialCandidates,
      materialComposition: parsed.materialComposition, attributes: parsed.attributes,
      residual: parsed.productNameResidualTokens, status: parsed.status, issues: parsed.ambiguities } }
})
const row = { productId: 'fixture-product', variantId: 'fixture-variant', productName: 'Cotton T-Shirt', categoryName: 'T-Shirt',
  size: 'XL', color: 'Black', sellingPrice: '12.50', availableStock: 40, currency: 'USD' }
const context = { userId: 'fixture-user', accountId: 'fixture-account', accountStatus: 'ACTIVE', role: 'OWNER' }
const examples = []
for (const [name, text] of [['Cotton T-Shirt', 'Tshirt fabric coton black XL two pieces'],
  ['T-Shirt', 'Tshirt fabric coton black XL two pieces'], ['Velvet T-Shirt', 'Tshirt fabric مخمل black XL two pieces'],
  ['مخمل T-Shirt', 'Tshirt fabric مخمل black XL two pieces'], ['Cotton T-Shirt', 'Tshirt fabric coton black XXL two pieces'],
  ['Cotton T-Shirt', 'Tshirt cotton 95% elastane 5% black XL two pieces']]) {
  const service = createVoiceMatchingService({ read: async () => ({ variants: [{ ...row, productName: name }], scannedVariants: 1, truncated: false }) })
  const result = await service.matchVoiceSaleText(text, context)
  examples.push({ text, actualCatalogName: name, status: result.status, reason: result.reason,
    requestedMaterial: result.parser.sourceMaterial, quantity: result.parser.attributes.quantity.value, missingFields: result.missingFields,
    catalogEvidence: result.match?.evidence ?? result.candidates.flatMap(row => row.evidence), liveSupabase: false })
}
const report = { kit: folder[0].name, sourceVersion: seed.meta.version, verifiedFiles: hashes, originalCsv,
  coverage: activeMaterials.coverage,
  domains: ['fabric', 'modifier'].map(domain => ({ domain, records: activeMaterials.audit.filter(row => row.domain === domain).length,
    active: activeMaterials.audit.filter(row => row.domain === domain && row.disposition === 'active').length,
    conditional: activeMaterials.audit.filter(row => row.domain === domain && row.disposition === 'conditional').length,
    blocked: activeMaterials.audit.filter(row => row.domain === domain && row.disposition === 'blocked').length })),
  blockedRecords: activeMaterials.audit.filter(row => row.disposition === 'blocked'),
  normalizedSourceDifferences: activeMaterials.audit.filter(row => row.normalized !== normalizeText(row.sourceNormalized)),
  rawNormalizedSourceDifferences: activeMaterials.audit.filter(row => row.normalized !== row.sourceNormalized).length,
  collisions, crossDomainRecords: activeMaterials.audit.filter(row => row.crossDomains.length),
  repeatedSameIdKeys: [...keyGroups].filter(([, rows]) => rows.length > 1 && new Set(rows.map(r => `${r.domain}:${r.id}`)).size === 1).length,
  declaredAmbiguities: seed.ambiguities, aliasRecords: activeMaterials.audit,
  fixtures: { original: 21, additional: 15, exactOriginalIdAndPercentageAgreement: sourceCases.filter(row => row.exactIdAndPercentageAgreement).length,
    reconciledSourceExceptions: sourceCases.filter(row => row.exactIdAndPercentageAgreement === false).length, sourceCases }, examples,
  limitations: ['No Supabase connection. All matching examples are read-only synthetic fixtures.',
    'No composition/certification schema: bound percentages and genuine/origin/coating claims always require clarification.',
    'Only integer adjacent component percentages are supported; no full composition NLP or automatic blending.',
    'Source review flags and missing modifier metadata remain conditional. No linguistic certification of generated aliases.',
    'Cross-role terms can require explicit fabric/material cues; ambiguity is never resolved by registry order.',
    'Brand/model dictionary overlap cannot be exhaustively enumerated because real merchant names are dynamic. Unknown/model words stay literal.',
    'Original fixtures validate recognized IDs and percentages; they do not certify all slot/garment grammar or live matching outcomes.'],
  writes: 0, liveSupabaseVerified: false }
writeFileSync(new URL('../src/voice-sales/MATERIALS_AUDIT.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ verifiedFiles: hashes.length, originalCsv: originalCsv.map(({ file, rows }) => ({ file, rows })),
  coverage: report.coverage, domains: report.domains, blocked: report.blockedRecords,
  collisionKeys: collisions.map(row => row.key), crossDomainRecords: report.crossDomainRecords.length,
  originalAgreement: report.fixtures.exactOriginalIdAndPercentageAgreement, sourceExceptions: report.fixtures.reconciledSourceExceptions,
  examples: examples.map(({ text, status }) => ({ text, status })) }, null, 2))
