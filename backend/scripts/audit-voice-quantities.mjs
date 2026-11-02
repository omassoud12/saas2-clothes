import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { activeQuantities, quantitySourceResource as seed, quantities } from '../.test-dist/voice-sales/index.js'
import { parseVoiceSaleText } from '../.test-dist/voice-sales/parser.js'
import { createVoiceMatchingService } from '../.test-dist/voice-sales/matching.service.js'

// Read-only vocabulary/fixture audit. No .env, Supabase connection or business writes.
const kit = new URL('../../voice-dictionaries/04-quantities/SAAS2_Quantities_Dictionary_Integration_Kit/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', kit), 'utf8'))
const hashes = manifest.files.map(row => {
  const bytes = readFileSync(new URL(row.path, kit))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  assert.equal(sha256, row.sha256, row.path)
  assert.equal(bytes.length, row.size, row.path)
  return { file: row.path, verified: true, sha256 }
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
      row.push(cell); rows.push([...row]); row.length = 0; cell = ''
    } else cell += c
  }
  if (row.length || cell) { row.push(cell); rows.push([...row]) }
  return rows
}
const csvCounts = {}
for (const [file, group] of Object.entries({ saas2_quantities: 'quantities', saas2_quantity_aliases: 'number_aliases',
  saas2_quantity_units: 'units', saas2_quantity_unit_aliases: 'unit_aliases', saas2_quantity_direct_phrases: 'direct_phrases',
  saas2_quantity_modifiers: 'modifiers', saas2_quantity_modifier_aliases: 'modifier_aliases',
  saas2_quantity_ambiguities: 'ambiguities', saas2_quantity_parser_test_cases: 'parser_test_cases' })) {
  const rows = csvRows(readFileSync(new URL(`reference/raw-csv/${file}.csv`, kit), 'utf8'))
  assert.equal(rows.length - 1, seed.data[group].length, file)
  const header = rows[0]
  for (let index = 1; index < rows.length; index++) {
    const source = seed.data[group][index - 1]
    header.forEach((key, cell) => {
      const expected = source[key] === null ? '' : String(source[key] ?? '')
      assert.equal(rows[index][cell], expected, `${file}:${index}:${key}`)
    })
  }
  csvCounts[group] = rows.length - 1
}
const fixtures = seed.data.parser_test_cases.map((fixture, index) => {
  const parsed = parseVoiceSaleText(fixture.input)
  const exactPiece = fixture.expected_unit === 'PIECE' && fixture.expected_intent === 'order'
  const expectedSafeQuantity = exactPiece ? fixture.expected_order_units : null
  assert.equal(parsed.attributes.quantity.value, expectedSafeQuantity, fixture.input)
  const actual = parsed.quantityIntent
  const differences = []
  if (actual.orderUnits !== fixture.expected_order_units) differences.push('order_units')
  if (actual.unitId !== fixture.expected_unit) differences.push('unit_id')
  if (actual.resolvedPieces !== fixture.expected_individual_pieces) differences.push('resolved_individual_pieces')
  if (actual.intent !== fixture.expected_intent) differences.push('intent')
  const reason = actual.needsCatalogMetadata ? 'No packaging/measurement mapping exists in ProductVariant; no physical-to-SKU conversion.'
    : ['approx', 'min', 'max', 'range', 'add', 'remove', 'allocation', 'inventory'].includes(fixture.expected_intent)
      ? 'Advisory/bounded quantities are recognized; they are not exact sellable counts.'
      : /pack|طقم/iu.test(fixture.input) ? 'A product/package descriptor is not a requested line quantity.'
        : 'Bare/ambiguous or metadata amounts have no verified order-unit interpretation.'
  return { id: `SOURCE_CASE_${String(index + 1).padStart(3, '0')}`, input: fixture.input,
    sourceExpectation: { orderUnits: fixture.expected_order_units, unitId: fixture.expected_unit,
      resolvedPieces: fixture.expected_individual_pieces, intent: fixture.expected_intent },
    policyTest: 'PASS', expectedSafeQuantity, parserStatus: parsed.status, actual,
    literalSeedAgreement: !differences.length, differingFields: differences,
    reconciliation: differences.length ? reason : null }
})
const row = { productId: 'fixture-product', variantId: 'fixture-variant', productName: 'T-Shirt', categoryName: 'Clothing',
  size: 'XL', color: 'Black', sellingPrice: '12.50', availableStock: 40, currency: 'USD' }
const service = createVoiceMatchingService({ read: async () => ({ variants: [row], scannedVariants: 1, truncated: false }) })
const context = { userId: 'fixture-user', accountId: 'fixture-account', accountStatus: 'ACTIVE', role: 'OWNER' }
const examples = []
for (const input of ['Tshirt black XL 38 pcs', 'Tshirt black size 32 38 pieces', 'Tshirt black XL 2 pairs',
  'Tshirt black XL about 10 pieces', 'Tshirt black XL one two pieces', 'Tshirt black XL two']) {
  const result = await service.matchVoiceSaleText(input, context)
  examples.push({ input, legacyExactVocabulary: quantities.lookup(input.split('XL ').at(-1)).status,
    quantity: result.parser.attributes.quantity.value, quantityIntent: result.parser.quantityIntent,
    matchingStatus: result.status, reason: result.reason, scannedVariants: result.catalog.scannedVariants })
}
const groups = ['number_aliases', 'unit_aliases', 'direct_phrases', 'modifier_aliases']
const report = { source: 'SAAS2_Quantities_Dictionary_Integration_Kit', sourceVersion: seed.metadata.version,
  verifiedKitFiles: hashes, originalCsvRecordsVerified: csvCounts, sourceCounts: seed.metadata.counts,
  coverage: activeQuantities.coverage,
  aliasesByGroup: groups.map(group => ({ group, records: seed.data[group].length,
    conditional: activeQuantities.audit.filter(row => row.group === group && row.disposition === 'conditional').length,
    conflicting: activeQuantities.audit.filter(row => row.group === group && row.conflictingTargets.length).length })),
  aliasRecords: activeQuantities.audit,
  fixtureSummary: { total: 65, policyPass: 65, literalSeedAgreement: fixtures.filter(row => row.literalSeedAgreement).length,
    reconciledExceptions: fixtures.filter(row => !row.literalSeedAgreement).length }, fixtures, examples,
  limitations: ['No real Supabase verification; all catalog examples are synthetic.',
    'Recognition counts include guarded aliases; no imported alias is unconditionally authorized as a sale quantity.',
    'Known number words in brand/model names remain literal constraints unless qualified by quantity evidence.',
    'Containers, pairs, dozens, weight and length require verified sellable-SKU metadata; current schema has none.',
    '61 source ambiguity flags are preserved as review metadata, not 61 implemented contextual grammar rules.'],
  writes: 0 }
writeFileSync(new URL('../src/voice-sales/QUANTITIES_AUDIT.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ csvCounts, coverage: report.coverage, fixtures: report.fixtureSummary,
  examples: examples.map(({ input, quantity, matchingStatus }) => ({ input, quantity, matchingStatus })) }, null, 2))
