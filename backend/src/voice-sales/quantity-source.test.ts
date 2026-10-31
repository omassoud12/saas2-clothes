import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { activeQuantities, activeProductTypes, activeColors, activeSizes, quantities,
  quantitySourceResource as seed, normalizeText } from './index.js'
import { validateQuantitySeed } from './quantity-source.js'
import { parseQuantityIntent, maxVoiceSaleQuantity } from './quantity-parser.js'
import { parseVoiceSaleText } from './parser.js'
import { maxSaleQuantity } from '../sales/sale.schemas.js'

const groups = ['number_aliases', 'unit_aliases', 'direct_phrases', 'modifier_aliases'] as const
describe('Quantity resource integrity, complete coverage and immutable provenance', () => {
  test('exact source resources and 65 evaluation cases have verified hashes', () => {
    for (const [file, hash] of [
      ['quantities.seed.json', '571349b70a03189316912edd8393f45ef5d4730f5d6ffc9f3a94dd1ab4cb5176'],
      ['quantities.source-collisions.json', 'be98f12bac4b97f849a99fef7d4293aae07e9b294c477c1242a128d4132d1231'],
      ['quantities.smoke.json', '7351f5cbe87993605fdddae7b56fa40500f052cef0aa4fd7c5e70320d8080fb2'],
    ]) assert.equal(createHash('sha256').update(readFileSync(new URL(`../../resources/voice-sales/${file}`, import.meta.url))).digest('hex'), hash)
    validateQuantitySeed(seed)
    assert.equal(maxVoiceSaleQuantity, maxSaleQuantity)
    assert.equal(activeProductTypes.coverage.supportedConcepts, 343)
    assert.equal(activeColors.coverage.concepts, 307)
    assert.equal(activeSizes.coverage.concepts, 671)
    assert.equal(quantities.coverage.canonicalValues, 17)
    assert.equal(activeQuantities.coverage.aliasRecords, 2426)
    assert.equal(activeQuantities.audit.length, 2426)
  })
  for (const group of groups) seed.data[group].forEach((row, index) => {
    test(`${group} record ${index}: exact recognition, normalized audit and original provenance`, () => {
      const found = activeQuantities.lookup(group, row.alias)
      assert.ok(found.includes(row))
      assert.deepEqual(activeQuantities.lookup(group, normalizeText(row.alias)), found)
      const audit = activeQuantities.audit.find(item => item.group === group && item.sourceIndex === index)!
      assert.equal(audit.alias, row.alias)
      assert.equal(audit.normalizedKey, normalizeText(row.alias))
      assert.equal(audit.sourceNormalizedKey, row.normalized)
      assert.equal(audit.disposition, 'conditional')
      assert.ok(Object.isFrozen(row) && Object.isFrozen(found) && Object.isFrozen(audit.reasons))
      // Every imported string is evaluated in the parser as well. A context overlap
      // may deliberately be unresolved; lexical registration is not a sale count.
      const input = group === 'number_aliases' ? `${row.alias} pieces`
        : group === 'unit_aliases' ? `2 ${row.alias}`
          : group === 'modifier_aliases' ? `${row.alias} 2 pieces` : row.alias
      const parsed = parseVoiceSaleText(input)
      assert.ok(parsed.quantityIntent)
      if (parsed.attributes.quantity.value !== null) {
        assert.equal(parsed.quantityIntent.status, 'resolved')
        assert.equal(parsed.quantityIntent.unitId, 'PIECE')
        assert.equal(parsed.attributes.quantity.value, parsed.quantityIntent.resolvedPieces)
        assert.ok(Number.isSafeInteger(parsed.attributes.quantity.value) && parsed.attributes.quantity.value > 0)
      }
      if (group === 'number_aliases' && 'value' in row) assert.ok(parsed.quantityIntent.evidence.some(e => e.orderUnits === row.value), input)
      if (group === 'direct_phrases' && 'unit_id' in row && row.unit_id !== 'PIECE') assert.equal(parsed.attributes.quantity.value, null)
    })
  })
  test('all source concepts have aliases and references are complete', () => {
    for (const row of seed.data.quantities) assert.ok(seed.data.number_aliases.some(a => a.quantity_id === row.quantity_id))
    for (const row of seed.data.units) assert.ok(seed.data.unit_aliases.some(a => a.unit_id === row.unit_id))
    for (const row of seed.data.modifiers) assert.ok(seed.data.modifier_aliases.some(a => a.modifier_id === row.modifier_id))
    for (const row of seed.data.ambiguities) assert.ok(row.resolution_rule)
    assert.ok(Object.isFrozen(seed.data.ambiguities))
  })
  test('all five runtime/source collisions retain every meaning', () => {
    assert.equal(activeQuantities.coverage.runtimeCollisions.length, 5)
    assert.deepEqual(activeQuantities.lookup('unit_aliases', 'lot').map(row => row.unit_id), ['BUNDLE', 'LOT'])
    assert.deepEqual(activeQuantities.lookup('unit_aliases', 'lots').map(row => row.unit_id), ['BUNDLE', 'LOT'])
    assert.deepEqual(activeQuantities.lookup('unit_aliases', 'شوال').map(row => row.unit_id), ['BAG', 'SACK'])
    assert.deepEqual(activeQuantities.lookup('modifier_aliases', 'just').map(row => row.modifier_id), ['EXACT', 'ONLY'])
    assert.deepEqual(activeQuantities.lookup('modifier_aliases', 'من').map(row => row.modifier_id), ['RANGE', 'OF'])
    assert.deepEqual(parseQuantityIntent('2 lots').unitCandidates, ['BUNDLE', 'LOT'])
    assert.equal(parseVoiceSaleText('2 lots').attributes.quantity.value, null)
    assert.equal(parseVoiceSaleText('just 2 pieces').attributes.quantity.value, null)
    assert.equal(parseVoiceSaleText('قطعتين من هيدا').attributes.quantity.value, 2)
    assert.ok(parseQuantityIntent('تشكيلة 2 pieces').modifiers.some(row => row.ids.includes('ASSORTED')))
  })
  for (const corrupt of ['count', 'reference', 'policy', 'duplicate', 'value', 'unit', 'modifier', 'empty']) {
    test(`invalid source ${corrupt} fails closed`, () => {
      const broken = structuredClone(seed) as any
      if (corrupt === 'count') broken.data.number_aliases.pop()
      if (corrupt === 'reference') broken.data.number_aliases[0].quantity_id = 'QTY_99999'
      if (corrupt === 'policy') broken.data.number_aliases[0].match_policy = 'always_trust'
      if (corrupt === 'duplicate') broken.data.quantities[1].quantity_id = broken.data.quantities[0].quantity_id
      if (corrupt === 'value') broken.data.number_aliases[0].value = 999
      if (corrupt === 'unit') broken.data.unit_aliases[0].unit_id = 'INVENTED'
      if (corrupt === 'modifier') broken.data.modifier_aliases[0].modifier_id = 'CHECKOUT'
      if (corrupt === 'empty') broken.data.direct_phrases[0].alias = '   '
      assert.throws(() => validateQuantitySeed(broken), /Invalid packaged Quantity/u)
    })
  }
})

describe('Quantity source fixtures: audited SKU semantics, not literal seed conversion', () => {
  seed.data.parser_test_cases.forEach((fixture, index) => {
    test(`source ${index + 1}: ${fixture.input}`, () => {
      const parsed = parseVoiceSaleText(fixture.input)
      const exactPiece = fixture.expected_unit === 'PIECE' && fixture.expected_intent === 'order'
      assert.equal(parsed.attributes.quantity.value, exactPiece ? fixture.expected_order_units : null)
      if (exactPiece) assert.equal(parsed.quantityIntent?.resolvedPieces, fixture.expected_individual_pieces)
      else assert.notEqual(parsed.quantityIntent?.status, 'resolved')
      if (fixture.expected_unit && fixture.expected_unit !== 'PIECE'
        && !['طقم بيجاما', '3-pack socks'].includes(fixture.input)) {
        assert.equal(parsed.quantityIntent?.resolvedPieces, null)
      }
      if (['approx', 'min', 'max', 'range', 'add', 'remove', 'inventory', 'allocation'].includes(fixture.expected_intent)) {
        assert.equal(parsed.quantityIntent?.intent, fixture.expected_intent)
      }
    })
  })
})

describe('Quantity/size/identifier safety and exact span precedence', () => {
  for (const [input, expected] of [
    ['Tshirt black XL 3 habbet', 3], ['Tshirt black XXL 3 7abbet', 3], ['Tshirt black XXXL 3pcs', 3],
    ['بدي تيشيرت أسود قياس 32 قطعتين', 2], ['بدي 38 قطعة', 38], ['quantity 1200', 1200],
    ['quantity 1000000', 1000000], ['۳۸ pièces', 38], ['Tshirt black XL kt3ten', 2],
    ['quantity twenty one', 21], ['Tshirt black XL send ٢ حبات', 2],
    ['ثلا\u200eث pieces', 3], ['Tshirt black XL ３８ PCS', 38],
  ] as const) test(`explicit request ${input}`, () => {
    const p = parseVoiceSaleText(input)
    assert.equal(p.attributes.quantity.value, expected)
    for (const e of p.quantityIntent!.evidence) assert.equal(input.slice(e.originalSpan.start, e.originalSpan.end), e.originalSpan.text)
  })
  for (const input of ['38', 'two', 'واحد', 'size 32', 'قياس 38', 'Jeans W32/L30', 'XL', 'XXL', 'XXXL', 'Bra 38C',
    'Baby 0-3M', 'Shoes size 38', '2-piece set', 'two piece set', '3-pack socks', 'Tshirt model 32',
    'price 20$', 'stock 2 pieces', '2 pieces in stock', 'barcode 32', 'SKU-24', 'date 12/03/2026', 'offer 1+1',
    'Tshirt XL 0 pieces', 'Tshirt XL -2 pieces', 'Tshirt XL +2 pieces', 'Tshirt XL 1.5 pieces', 'Tshirt XL 1,5 pieces',
    'Tshirt XL 2-3 pieces', '1000001 pieces', '999999999999999999 pieces', '4قطعتين',
    'approx 2 pieces', 'at least 2 pieces', '2 dozen', '2 pairs', '2 packs', '2 cartons', '2 meters',
    '2 lots', '2 شوال', 'just 2 pieces', 'add 2 pieces', 'remove 2 pieces', '2 per color',
    'exactly approximately 2 pieces', 'more than less than 2 pieces', 'exactly at least 2 pieces', '1 piece 2 pieces']) test(`no trusted stock quantity: ${input}`, () => {
    assert.equal(parseVoiceSaleText(input).attributes.quantity.value, null)
  })
  test('longest phrase keeps counts, units and modifiers separate', () => {
    assert.equal(parseQuantityIntent('two hundred pieces').orderUnits, 200)
    assert.equal(parseQuantityIntent('two two pieces').resolvedPieces, 2)
    assert.equal(parseQuantityIntent('one two pieces').status, 'conflict')
    assert.equal(parseQuantityIntent('between 2 and 3 pieces').orderUnits, null)
    assert.equal(parseQuantityIntent('pack of 3').resolvedPieces, null)
    assert.equal(parseQuantityIntent('one and half dozen').resolvedPieces, null)
    assert.equal(parseQuantityIntent('2 pieceXYZ').resolvedPieces, null)
  })
  test('descriptors and unknown brand/model words remain literal catalog constraints', () => {
    const p = parseVoiceSaleText('3-pack Socks two pieces')
    assert.equal(p.attributes.quantity.value, 2)
    assert.deepEqual(p.productNameResidualTokens.map(row => row.token), ['3', 'pack'])
    const spaced = parseVoiceSaleText('3 Pack Socks two pieces')
    assert.equal(spaced.attributes.quantity.value, 2)
    assert.deepEqual(spaced.productNameResidualTokens.map(row => row.token), ['3', 'pack'])
    assert.deepEqual(parseVoiceSaleText('Twenty Moon Tshirt black XL two pieces').productNameResidualTokens.map(row => row.token), ['twenty', 'moon'])
    assert.deepEqual(parseVoiceSaleText('بدي Twenty Moon Tshirt black XL two pieces').productNameResidualTokens.map(row => row.token), ['twenty', 'moon'])
  })
})
