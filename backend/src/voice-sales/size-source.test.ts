import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { activeSizes, sizeSourceResource as seed, sizeSourceCollisions, normalizeSizeText, sizes, activeColors, activeProductTypes } from './index.js'
import { validateSizeResources } from './size-source.js'
import { inferSizeContext, resolveSizeLookup } from './size-context.js'
import { compareSourceSize } from './size-matching.js'
import { parseVoiceSaleText } from './parser.js'
import { createVoiceMatchingService } from './matching.service.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import type { CatalogVariant } from './match.types.js'
import type { SizeFamily } from './size-source-ids.js'

const context = { userId: 'fixture-user', role: UserRole.OWNER, accountId: 'tenant-a', accountStatus: AccountStatus.ACTIVE }
const variant = (size: string | null, productName = 'Tshirt', overrides: Partial<CatalogVariant> = {}): CatalogVariant => ({
  productId: 'fixture-product', variantId: 'fixture-variant', sku: 'TEST-SKU', productName, categoryName: productName,
  color: 'Black', size, sellingPrice: '12.50', availableStock: 40, currency: 'USD', ...overrides,
})
const run = (text: string, rows: CatalogVariant[], truncated = false) => createVoiceMatchingService({ read: async () =>
  ({ variants: rows, scannedVariants: rows.length, truncated }) }).matchVoiceSaleText(text, context)

function csvRows(text: string): string[][] {
  text = text.replace(/^\uFEFF/u, '')
  const rows: string[][] = [], row: string[] = []
  let cell = '', quoted = false
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

describe('Sizes resource integrity and complete original provenance', () => {
  test('all five copied files have the verified source hashes', () => {
    for (const [file, hash] of [
      ['sizes.seed.json', '39bdbf124229f786f46cd7e4ca0b37d4a3ebf68ee91db12d66154488b703f438'],
      ['sizes.source-collisions.json', 'bbd23e4e66c8631c968316eee160e6b96b955171f7a5cb69f48b7bb802d0832f'],
      ['sizes.smoke.json', '5394306121406e2069c26a26ed507e67404f3f2ea36457e1778a478e03571613'],
      ['sizes.manifest.json', '2500d5a7eac2e561a78574609a904ad06e3bfa7dc6f41c195843f93095b5eccc'],
      ['sizes.aliases.csv', '2d80efa108e87e23dfdf70aba4a6c54a6684a17ac5d12b14d4402903112223b5'],
    ]) assert.equal(createHash('sha256').update(readFileSync(new URL(`../../resources/voice-sales/${file}`, import.meta.url))).digest('hex'), hash)
  })
  test('every one of 10448 CSV rows survives unchanged and receives a disposition', () => {
    const csv = csvRows(readFileSync(new URL('../../resources/voice-sales/sizes.aliases.csv', import.meta.url), 'utf8'))
    assert.equal(csv.length, 10449)
    const header = csv.shift()!
    for (const [i, row] of seed.aliases.entries()) {
      const record = Object.fromEntries(header.map((name, column) => [name, csv[i][column]]))
      for (const [key, value] of Object.entries(row)) assert.equal(String(value), record[key], `${row.alias_id} ${key}`)
      const hit = activeSizes.lookup(row.alias)
      assert.ok(hit.records.includes(row), row.alias_id)
      assert.ok(hit.candidates.some(c => c.size_id === row.size_id), row.alias_id)
      assert.ok(Object.isFrozen(row) && Object.isFrozen(hit))
      const disposition = activeSizes.coverage.dispositions[i]
      assert.equal(disposition.aliasId, row.alias_id)
      assert.equal(disposition.sourceSizeId, row.size_id)
      assert.equal(disposition.status === 'blocked', row.match_policy === 'fuzzy_with_context')
    }
    const c = activeSizes.coverage
    assert.equal(c.concepts, 671); assert.equal(c.aliasRecords, 10448); assert.equal(c.families, 22)
    assert.equal(c.activeExact + c.activeContext + c.blocked, 10448)
    assert.equal(c.blocked, 24)
    assert.equal(sizes.coverage.canonicalValues, 14)
    assert.equal(activeColors.coverage.concepts, 307)
    assert.equal(activeProductTypes.coverage.supportedConcepts, 343)
  })
  for (const mutate of [
    (data: any) => { data.size_records[0].size_id = 'INVENTED' },
    (data: any) => { data.size_records[1].size_id = data.size_records[0].size_id },
    (data: any) => { data.aliases[0].size_id = 'INVENTED' },
    (data: any) => { data.aliases[1].alias_id = data.aliases[0].alias_id },
    (data: any) => { data.aliases[0].match_policy = 'blind_fuzzy' },
    (data: any) => { data.aliases[0].confidence = 2 },
    (data: any) => { data.modifiers[0].is_size_id = true },
    (data: any) => { data.ambiguities[0].auto_resolve = true },
  ]) test(`invalid resource fails closed: ${mutate.toString()}`, () => {
    const data = structuredClone(seed); mutate(data)
    assert.throws(() => validateSizeResources(data, sizeSourceCollisions), /Invalid packaged Sizes/)
  })
  test('tampering with the collision targets is rejected', () => {
    const collisions = structuredClone(sizeSourceCollisions) as any
    collisions.entries[0].targetSizeIds[0] = 'ALPHA_XL'
    assert.throws(() => validateSizeResources(seed, collisions), /Invalid packaged Sizes/)
  })
})

const familyGarment: Record<SizeFamily, string> = {
  ALPHA: 'Tshirt', ALPHA_COMBINED: 'Tshirt', ONE_SIZE: 'Tshirt', ADJUSTABLE: 'Tshirt', APPAREL_NUMERIC: 'Dress',
  WAIST_INCH: 'Jeans', INSEAM_INCH: 'Jeans', JEANS_WL: 'Jeans', BABY_AGE: 'Baby Onesie', KIDS_AGE: 'Kids Tshirt',
  KIDS_AGE_RANGE: 'Kids Tshirt', KIDS_HEIGHT: 'Kids Tshirt', BRA_CUP: 'Bra', BRA_BAND: 'Bra', BRA_COMPOSITE: 'Bra',
  SHOES_EU: 'Shoes', SHOES_REGIONAL: 'Shoes', SOCK_RANGE: 'Socks', HOSIERY_NUMERIC: 'Tights',
  HEAD_CIRCUMFERENCE: 'Cap', BELT_CM: 'Belt', GLOVES_NUMERIC: 'Gloves',
}
describe('all 671 typed concepts have real source evidence and a family-aware comparison', () => {
  for (const concept of seed.size_records) test(concept.size_id, () => {
    const aliases = seed.aliases.filter(row => row.size_id === concept.size_id)
    assert.equal(aliases.length, concept.aliases_count)
    assert.equal(activeSizes.concept(concept.size_id), concept)
    const garment = familyGarment[concept.family]
    const explicit = `${garment} size ${concept.canonical_label} ${['EU', 'US', 'UK', 'EU_SHOES', 'US_UK', 'US_MEN', 'US_WOMEN'].includes(concept.size_standard)
      ? concept.size_standard.startsWith('EU') ? 'EU' : concept.size_standard.startsWith('US') ? 'US' : 'UK' : ''}`
    const ctx = inferSizeContext(explicit, true)
    const alias = aliases.find(row => resolveSizeLookup(activeSizes.lookup(row.alias), ctx).candidates.includes(concept.size_id))!
    assert.ok(alias, concept.size_id)
    const hit = activeSizes.lookup(alias.alias)
    const resolved = resolveSizeLookup(hit, ctx)
    assert.ok(resolved.candidates.includes(concept.size_id))
    const parsed = parseVoiceSaleText(`${garment} black size ${alias.alias} two pieces`)
    assert.ok(parsed.sourceSizeId?.candidates.includes(concept.size_id), `parser ${concept.size_id}: ${alias.alias}`)
    assert.equal(parsed.attributes.quantity.value, 2)
    for (const row of aliases) {
      const parsedAlias = parseVoiceSaleText(`${garment} black size ${row.alias} two pieces`)
      assert.ok(parsedAlias.sourceSizeId?.candidates.includes(concept.size_id), `${row.alias_id}: ${row.alias}`)
      assert.equal(parsedAlias.attributes.quantity.value, 2, row.alias_id)
      if (row.match_policy === 'fuzzy_with_context') assert.equal(parsedAlias.sourceSizeId?.value, null, row.alias_id)
    }
    // Every concept participates in the same merchant-column comparison, including
    // partial dimensions and unresolved standards which must remain unselected.
    const request = { startToken: 0, endToken: 1, phrase: alias.alias,
      originalSpan: { start: 0, end: alias.alias.length, text: alias.alias }, result: hit,
      ...resolved, sizeDomainExplicit: true }
    const actual = compareSourceSize(request, alias.alias, ctx)
    assert.notEqual(actual, 'no', `${concept.size_id}: ${alias.alias}`)
    if (['BRA_CUP', 'BRA_BAND', 'WAIST_INCH', 'INSEAM_INCH'].includes(concept.family)) assert.equal(actual, 'unknown')
  })
})

describe('source, shared-runtime and separator-aware collisions never overwrite alternatives', () => {
  for (const collision of sizeSourceCollisions.entries) test(`source collision ${collision.normalizedAlias}`, () => {
    for (const row of collision.originalAliasRecords) {
      const hit = activeSizes.lookup(row.alias)
      collision.targetSizeIds.forEach(id => assert.ok(hit.candidates.some(c => c.size_id === id), row.alias))
      assert.equal(hit.status, 'ambiguous')
    }
  })
  test('all runtime collisions and cross-domain aliases remain explicit', () => {
    assert.equal(activeSizes.coverage.runtimeCollisions.length, 352)
    assert.ok(activeSizes.coverage.preciseCollisions.length >= 352)
    for (const c of activeSizes.coverage.preciseCollisions) assert.equal(activeSizes.lookup(c.alias).status, 'ambiguous')
    for (const c of activeSizes.coverage.crossDomain) assert.equal(activeSizes.lookup(c.alias).status, 'ambiguous')
  })
  test('51 declared ambiguities and 196 modifier records are retained, never schema attributes', () => {
    assert.equal(seed.ambiguities.length, 51)
    seed.ambiguities.forEach(row => assert.equal(row.auto_resolve, false))
    assert.equal(seed.modifiers.length, 23)
    seed.modifier_aliases.forEach(row => assert.ok(activeSizes.modifiers(row.alias).includes(row)))
    for (const text of ['oversized', 'petite', 'tall', 'cm', 'months', 'stretch']) {
      assert.equal(parseVoiceSaleText(text).sourceSizeId?.value, null, text)
      assert.equal(parseVoiceSaleText(text).attributes.quantity.value, null, text)
    }
  })
  test('all 24 uncertain aliases remain suggestions, never SKU proof', async () => {
    for (const row of seed.aliases.filter(row => row.match_policy === 'fuzzy_with_context')) {
      const garment = row.size_id.startsWith('BABY') ? 'Baby Onesie' : 'Tshirt'
      const result = await run(`${garment} black size ${row.alias} two pieces`, [variant(row.alias, garment)])
      assert.notEqual(result.status, 'MATCHED', row.alias)
      assert.equal(result.parser.sourceSizeId?.value, null, row.alias)
    }
  })
})

describe('all 24 supplied parser fixtures, with explicit safety corrections', () => {
  const requiresContext = new Set(['REQUIRES_CATALOG', 'AMBIGUOUS', 'SHOES_EU_38', 'BRA_EU_75_B', 'HEAD_58CM'])
  for (const fixture of seed.parser_tests) test(fixture.request, () => {
    const parsed = parseVoiceSaleText(fixture.request)
    if (requiresContext.has(fixture.expected_size_id)) assert.equal(parsed.sourceSizeId?.value, null)
    else assert.equal(parsed.sourceSizeId?.value, fixture.expected_size_id)
    if (!['REQUIRES_CATALOG', 'AMBIGUOUS'].includes(fixture.expected_size_id)) {
      assert.ok(parsed.sourceSizeId?.candidates.includes(fixture.expected_size_id as any))
    }
    assert.equal(parsed.attributes.quantity.value, null, 'no source fixture independently specifies a trusted sale count')
    if (fixture.request.includes('2ata3')) assert.ok(parsed.productNameResidualTokens.some(t => t.token === '2ata3'))
  })
})

describe('multilingual composites and quantity safety through the actual parser and service', () => {
  const smoke = JSON.parse(readFileSync(new URL('../../resources/voice-sales/sizes.smoke.json', import.meta.url), 'utf8')) as {
    extraSafetyCases: { request: string; expected: string }[] }
  const safetyIds = ['ALPHA_XL', 'WAIST_W32', null, 'SHOES_EU_38', null, 'JEANS_W32_L30', 'BRA_EU_75_B',
    'BABY_0_3M', 'ALPHA_2XL', null, null, 'ALPHA_M', 'ALPHA_M', 'SHOES_EU_40', 'JEANS_W32_L30']
  const safetyQuantities = [2, null, 32, null, null, null, null, null, null, null, null, null, 2, null, 2]
  for (const [i, item] of smoke.extraSafetyCases.entries()) test(`extra source safety: ${item.request}`, () => {
    const parsed = parseVoiceSaleText(item.request)
    assert.equal(parsed.attributes.quantity.value, safetyQuantities[i], item.expected)
    if (safetyIds[i]) assert.ok(parsed.sourceSizeId?.candidates.includes(safetyIds[i] as any), item.expected)
    else assert.equal(parsed.sourceSizeId?.value, null, item.expected)
    if ([1, 3, 4, 6].includes(i)) assert.equal(parsed.sourceSizeId?.value, null, item.expected)
  })
  for (const [text, id] of [
    ['Jeans W32/L30', 'JEANS_W32_L30'], ['Jeans W32 L30', 'JEANS_W32_L30'], ['Jeans 32/30', 'JEANS_W32_L30'],
    ['Jeans W٣٢/L٣٠', 'JEANS_W32_L30'], ['Jeans W۳۲/L۳۰', 'JEANS_W32_L30'],
    ['Baby Onesie 0-3M', 'BABY_0_3M'], ['Kids Tshirt 5-6Y', 'KIDS_RANGE_5_6'],
    ['Shoes EU 38', 'SHOES_EU_38'], ['Bra EU 75B', 'BRA_EU_75_B'],
    ['Tshirt taille XL', 'ALPHA_XL'], ['Tshirt 2yas XXL', 'ALPHA_2XL'], ['Tshirt قياس XXXL', 'ALPHA_3XL'],
  ]) test(text, () => {
    const result = parseVoiceSaleText(text)
    assert.equal(result.sourceSizeId?.value, id)
    assert.equal(result.attributes.quantity.value, null)
    for (const match of result.sourceSizeCandidates ?? []) assert.equal(text.slice(match.originalSpan.start, match.originalSpan.end), match.originalSpan.text)
  })
  test('normalization retains structural punctuation while folding Unicode and digits', () => {
    assert.equal(normalizeSizeText('  W٣٢ ／ L۳۰  '), 'w32/l30')
    assert.equal(normalizeSizeText('۰–۳M'), '0-3m')
    assert.equal(normalizeSizeText('EU ۳۸٫۵'), 'eu 38.5')
    for (const text of ['XXLXL', 'AXL', 'W32/L30ish', 'purpleish', '未知尺码']) assert.equal(activeSizes.lookup(text).status, 'unknown')
  })
  test('explicit size labels and sale counts remain distinct', () => {
    const parsed = parseVoiceSaleText('Tshirt black size 32 32 pieces')
    assert.equal(parsed.attributes.size.value, '32'); assert.equal(parsed.attributes.quantity.value, 32)
    assert.equal(parsed.sourceSizeId?.value, null)
    assert.equal(parseVoiceSaleText('Tshirt black 32 pieces').sourceSizeId?.value, null)
    assert.equal(parseVoiceSaleText('Tshirt black 32').attributes.quantity.value, null)
    for (const text of ['two piece set', '2 piece set', '20D tights', 'quantity -2', 'quantity 2.5', 'Gloves size -8.5', 'Gloves size +8.5']) {
      const p = parseVoiceSaleText(text)
      assert.equal(p.sourceSizeId?.value, null, text)
      assert.equal(p.attributes.quantity.value, null, text)
    }
  })
  test('bare 38, unsupported standards, age abbreviations and partial bra dimensions stay unresolved', async () => {
    for (const text of ['size 38', 'Shoes 38', 'Bra 75B', 'Baby Onesie 3m', 'Bra cup C', 'Bra band 75', 'Tshirt black size 38 US two pieces']) {
      const result = await run(text, [variant('EU 38', 'Shoes'), variant('EU 75B', 'Bra')])
      assert.notEqual(result.status, 'MATCHED', text)
    }
    assert.equal(parseVoiceSaleText('Tshirt black size 38 US two pieces').sourceSizeCandidates?.[0].incompatibleStandard, true)
    assert.equal(parseVoiceSaleText('Kids Tshirt size ولادي 5').sourceSizeId?.value, null, 'no implicit age unit')
    assert.equal(parseVoiceSaleText('Baby Onesie size بيبي 0-3').sourceSizeId?.value, null, 'no implicit months')
  })
  for (const [product, request, stored] of [
    ['Jeans', 'W32/L30', 'W32 L30'], ['Baby Onesie', '0-3M', '0-3M'], ['Kids Tshirt', '5-6Y', '5-6Y'],
    ['Bra', 'EU 75B', 'EU 75B'], ['Shoes', 'EU 38', 'EU 38'], ['Tshirt', 'size 32', '32'],
    ['Tshirt', 'XXL', '2XL'], ['Tshirt', 'one size', 'one-size'],
  ]) test(`actual merchant column ${product}: ${request} -> ${stored}`, async () => {
    const result = await run(`${product} black ${request} two pieces`, [variant(stored, product)])
    assert.equal(result.status, 'MATCHED', JSON.stringify(result.missingFields))
    assert.equal(result.match?.size, stored); assert.equal(result.match?.quantity, 2)
    assert.equal(result.requiresConfirmation, true)
    assert.equal((await run(`${product} black ${request} two pieces`, [])).status, 'NOT_FOUND')
    assert.notEqual((await run(`${product} black ${request} two pieces`, [variant(stored, product)], true)).status, 'MATCHED')
  })
  test('explicit constraints are never dropped and prices/stock are fresh for each read', async () => {
    assert.notEqual((await run('Jeans black W32/L30 two pieces', [variant('W34/L30', 'Jeans')])).status, 'MATCHED')
    assert.notEqual((await run('Shoes black EU 38 two pieces', [variant('US 8', 'Shoes')])).status, 'MATCHED')
    assert.notEqual((await run('Tshirt black XXL two pieces', [variant('XL')])).status, 'MATCHED')
    assert.equal((await run('Tshirt black XXL two pieces', [variant('XXL'), variant('XXL', 'Tshirt', { variantId: 'second' })])).status, 'AMBIGUOUS')
    let row = variant('XXL')
    const service = createVoiceMatchingService({ read: async () => ({ variants: [row], scannedVariants: 1, truncated: false }) })
    const text = 'Tshirt black XXL two pieces'
    assert.equal((await service.matchVoiceSaleText(text, context)).status, 'MATCHED')
    row = { ...row, availableStock: 1, sellingPrice: '99.01' }
    const fresh = await service.matchVoiceSaleText(text, context)
    assert.equal(fresh.status, 'INSUFFICIENT_STOCK'); assert.equal(fresh.match?.sellingPrice, '99.01')
    row = { ...row, sellingPrice: null }
    assert.notEqual((await service.matchVoiceSaleText(text, context)).status, 'MATCHED')
  })
  test('brand/model identity and conflicting sizes remain mandatory while clear items stay independent', async () => {
    assert.notEqual((await run('Tshirt Acme black XXL two pieces', [variant('XXL', 'Tshirt Other')])).status, 'MATCHED')
    assert.notEqual((await run('Tshirt black XL XXL two pieces', [variant('XXL')])).status, 'MATCHED')
    const multiple = await run('Tshirt black XL two pieces and pants navy M one piece', [variant('XL')])
    assert.equal(multiple.status, 'INCOMPLETE')
    assert.equal(multiple.reason, 'MULTIPLE_ITEMS_REQUIRE_INDEPENDENT_CONFIRMATION')
    assert.deepEqual(multiple.items?.map(item => item.result.parser.attributes.size.value), ['XL', 'M'])
    assert.notEqual((await run('Tshirt black XL', [variant('XL')])).status, 'MATCHED')
    assert.equal(parseVoiceSaleText('Tshirt US Polo black size 38 two pieces').sourceSizeId?.value, null)
    assert.notEqual((await run('Dress black size bra 75B two pieces', [variant('EU 75B', 'Dress')])).status, 'MATCHED')
  })
})
