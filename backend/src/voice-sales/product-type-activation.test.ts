import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { activeProductTypes, productTypeSourceResource, productTypeSourceAmbiguities, normalizeText } from './index.js'
import { parseVoiceSaleText } from './parser.js'
import { matchParsedCatalog } from './catalog-matcher.js'
import type { CatalogVariant } from './match.types.js'

const variant = (name: string, overrides: Partial<CatalogVariant> = {}): CatalogVariant => ({
  productId: 'product-fixture', variantId: 'variant-fixture', sku: 'TEST-SKU', productName: name, categoryName: 'Clothing',
  color: 'Black', size: 'XL', sellingPrice: '12.50', availableStock: 40, currency: 'USD', ...overrides,
})
const match = (text: string, rows: CatalogVariant[]) => matchParsedCatalog(parseVoiceSaleText(text),
  { variants: rows, scannedVariants: rows.length, truncated: false })

describe('authorized active vocabulary: all 343 concepts and every 2909 record', () => {
  for (const concept of productTypeSourceResource.productTypes) test(concept.id, () => {
    const definite = concept.aliases.filter(alias => activeProductTypes.lookup(alias.text).status === 'candidate')
    assert.ok(definite.length, `no unambiguous catalog label: ${concept.id}`)
    // Choose a real mocked catalog label from another script when possible.
    for (const alias of concept.aliases) {
      const hit = activeProductTypes.lookup(alias.text)
      assert.ok(hit.candidates.some(candidate => candidate.sourceTypeId === concept.id), alias.text)
      if (hit.status === 'blocked') {
        assert.deepEqual(activeProductTypes.matchTokens(alias.text), [])
        continue
      }
      const parser = parseVoiceSaleText(`${alias.text} black XL two pieces`)
      assert.ok(parser.sourceProductType?.candidates.includes(concept.id), `${concept.id}: ${alias.text}`)
      if (hit.status === 'ambiguous') {
        assert.equal(parser.sourceProductType?.value, null, alias.text)
        continue
      }
      assert.equal(parser.sourceProductType?.value, concept.id, alias.text)
      const alternative = definite.find(row => /\p{Script=Arabic}/u.test(row.text) !== /\p{Script=Arabic}/u.test(alias.text)) ?? definite[0]
      const material = parser.attributes.material.value === 'WOOL' ? ' wool' : ''
      const result = match(`${alias.text} black XL two pieces`, [variant(`${alternative.text}${material}`)])
      assert.equal(result.status, 'MATCHED', `${concept.id}: ${alias.text} -> ${alternative.text}: ${JSON.stringify(result.missingFields)}`)
      assert.equal(result.match?.quantity, 2)
      assert.equal(result.requiresConfirmation, true)
    }
  })
})

describe('all source ambiguity relationships stay active and context-dependent', () => {
  for (const relationship of productTypeSourceAmbiguities.ambiguousAliases) test(relationship.sourceNormalized, () => {
    const records = productTypeSourceResource.productTypes.flatMap(concept => concept.aliases)
      .filter(alias => alias.sourceNormalized === relationship.sourceNormalized)
    for (const alias of records) {
      const parser = parseVoiceSaleText(`${alias.text} black XL two pieces`)
      assert.equal(parser.sourceProductType?.status, 'ambiguous')
      assert.deepEqual([...parser.sourceProductType!.candidates].sort(), [...relationship.candidateTypeIds].sort())
      const result = match(`${alias.text} black XL two pieces`, [variant(alias.text)])
      assert.notEqual(result.status, 'MATCHED', `same ambiguous spelling is not independent context: ${alias.text}`)
    }
  })
})

describe('active semantics retain catalog and parser safety', () => {
  test('measured audit partitions every record and preserves only the unsafe filler block', () => {
    const coverage = activeProductTypes.coverage
    assert.equal(coverage.importedRecords, 2909)
    assert.equal(coverage.activatedRecords + coverage.blockedRecords.length, 2909)
    assert.equal(coverage.activatedRecords, 2906)
    assert.equal(coverage.unambiguousRecords, 2792)
    assert.equal(coverage.contextRecords, 114)
    assert.equal(coverage.supportedConcepts, 343)
    assert.equal(coverage.crossLanguageConcepts, 343)
    assert.equal(coverage.unsupportedConcepts, 0)
    assert.deepEqual(coverage.blockedRecords.map(row => normalizeText(row.alias)).sort(), ['baddi', 'bdi', '\u0628\u062f\u064a'].sort())
    assert.equal(coverage.duplicateRecords, 1)
  })
  for (const [spoken, actual] of [
    ['chemise', 'Shirt'], ['\u0628\u0648\u062f\u064a', 'Bodysuit'], ['robe', 'House robe'],
    ['\u0643\u064a\u0644\u0648\u062a', "Men's briefs"], ['\u0643\u0648\u0644\u0648\u0646', 'Leggings'],
  ]) test(`independent catalog concept narrows ${spoken}`, () => {
    assert.equal(match(`${spoken} black XL two pieces`, [variant(actual)]).status, 'MATCHED')
  })
  test('two legitimate meanings never select by stock or price', () => {
    const result = match('robe black XL two pieces', [variant('Dress', { availableStock: 0 }),
      variant('House robe', { variantId: 'other', sellingPrice: '99.00' })])
    assert.equal(result.status, 'AMBIGUOUS')
    assert.equal(result.match, null)
  })
  test('unambiguous category narrows an ambiguous name', () => {
    assert.equal(match('\u0628\u0648\u062f\u064a black XL two pieces',
      [variant('\u0628\u0648\u062f\u064a', { categoryName: 'Baby onesie' })]).status, 'MATCHED')
  })
  for (const name of ['Chemise Classic', 'Chemise Oversized', 'Chemise UnknownBrand']) test(`generic type does not erase model: ${name}`, () => {
    assert.equal(match('chemise black XL two pieces', [variant(name)]).status, 'INCOMPLETE')
  })
  test('unknown brand, similar names, missing size/quantity, stock and price stay protected', () => {
    assert.equal(match('chemise UnknownBrand black XL two pieces', [variant('Shirt Cedar')]).status, 'NOT_FOUND')
    assert.equal(match('chemise black two pieces', [variant('Shirt')]).status, 'INCOMPLETE')
    assert.equal(match('chemise black XL', [variant('Shirt')]).status, 'INCOMPLETE')
    assert.equal(match('chemise black XL two pieces', [variant('Shirt', { availableStock: 1 })]).status, 'INSUFFICIENT_STOCK')
    assert.equal(match('chemise black XL two pieces', [variant('Shirt', { sellingPrice: null })]).status, 'INCOMPLETE')
    assert.equal(match('chemise black XL two pieces', []).status, 'NOT_FOUND')
  })
  test('descriptor context does not create a product identity', () => {
    assert.equal(parseVoiceSaleText('collar Polo').sourceProductType?.status, 'missing')
    assert.equal(parseVoiceSaleText('fabric \u062c\u064a\u0646\u0632').sourceProductType?.status, 'missing')
    assert.equal(parseVoiceSaleText('polo collar').sourceProductType?.status, 'missing')
  })
  test('qualified legacy material remains explicit and verified against actual names', () => {
    const text = '\u0643\u0646\u0632\u0629 \u0635\u0648\u0641 black XL two pieces'
    const parser = parseVoiceSaleText(text)
    assert.equal(parser.attributes.material.value, 'WOOL')
    assert.equal(match(text, [variant('\u0643\u0646\u0632\u0629 \u0635\u0648\u0641')]).status, 'MATCHED')
    assert.equal(match(text, [variant('Sweater wool')]).status, 'MATCHED')
    assert.equal(match(text, [variant('Sweater')]).status, 'INCOMPLETE')
  })
})
