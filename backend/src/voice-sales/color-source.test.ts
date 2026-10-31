import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { activeColors, colorSourceResource, colorSourceCollisions, normalizeText, colors } from './index.js'
import { validateColorResources } from './color-source.js'
import { parseVoiceSaleText } from './parser.js'
import { createVoiceMatchingService } from './matching.service.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import type { CatalogVariant } from './match.types.js'

const context = { userId: 'test-user', role: UserRole.OWNER, accountId: 'tenant-a', accountStatus: AccountStatus.ACTIVE }
const variant = (color: string | null, overrides: Partial<CatalogVariant> = {}): CatalogVariant => ({ productId: 'product', variantId: 'variant', sku: 'TEST-SKU',
  productName: 'Tshirt', categoryName: 'Clothing', color, size: 'XL', sellingPrice: '12.50', availableStock: 40, currency: 'USD', ...overrides })
const run = (text: string, rows: CatalogVariant[], truncated = false) => createVoiceMatchingService({ read: async () =>
  ({ variants: rows, scannedVariants: rows.length, truncated }) }).matchVoiceSaleText(text, context)

/** Reference CSV reader for provenance verification only, never used by the runtime matcher. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [], row: string[] = []
  let cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted
    } else if (!quoted && character === ',') { row.push(cell); cell = '' }
    else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push([...row]); row.length = 0; cell = ''
    } else cell += character
  }
  if (row.length || cell) { row.push(cell); rows.push([...row]) }
  return rows
}

describe('Colors resource integrity and every original source row', () => {
  test('all copied source hashes match the supplied files and manifest', () => {
    for (const [file, hash] of [
      ['colors.seed.json', '7894cfd50b44b013be06b6755780f5e4d0da7a0edf6323f6801009fe18bdeb77'],
      ['colors.source-collisions.json', '0080ed668b250019bf435d3cce1d101a5b41469be65607b572916dc9f5dc528f'],
      ['colors.aliases.csv', 'f50e8977a07b212801966b6cc2b1c063676ce92d768c212d50c34232d9d07c85'],
      ['colors.smoke.json', 'e12387ae2e071e1dcdc9939af99266544db2d319496c160c2e539ed8697aa41b'],
      ['colors.manifest.json', '937f5c4c77e399763b434b1a5962bd9ecf9ea9d753e647abcbcf735999f527d8'],
    ]) assert.equal(createHash('sha256').update(readFileSync(new URL(`../../resources/voice-sales/${file}`, import.meta.url))).digest('hex'), hash)
  })
  test('JSON round-trips all CSV values with exact row provenance, including repeated spellings', () => {
    const csv = csvRows(readFileSync(new URL('../../resources/voice-sales/colors.aliases.csv', import.meta.url), 'utf8'))
    assert.equal(csv.length, 3476)
    for (const concept of colorSourceResource.colors) for (const row of concept.aliases) {
      assert.deepEqual(csv[row.sourceCsvLine - 1], [concept.colorId, row.alias, row.sourceNormalized, row.source, row.locale, row.matchPolicy, row.reviewStatus])
      assert.ok(activeColors.lookup(row.alias).candidates.includes(concept.colorId))
      assert.ok(activeColors.lookup(row.alias).records.includes(row))
      assert.ok(Object.isFrozen(row))
    }
    assert.equal(colors.coverage.canonicalValues, 13)
    assert.equal(activeColors.coverage.concepts, 307)
    assert.equal(activeColors.coverage.aliasRecords, 3475)
    assert.equal(activeColors.coverage.disposition.length, 3475)
    assert.equal(activeColors.coverage.activeUnambiguous + activeColors.coverage.activeContext + activeColors.coverage.deferred + activeColors.coverage.blocked, 3475)
  })
  for (const mutate of [
    (seed: any) => { seed.colors[0].colorId = 'INVENTED' },
    (seed: any) => { seed.colors[1].colorId = seed.colors[0].colorId },
    (seed: any) => { seed.colors[0].aliases[0].sourceCsvLine = 0 },
    (seed: any) => { seed.colors[0].aliases[1].sourceCsvLine = seed.colors[0].aliases[0].sourceCsvLine },
    (seed: any) => { seed.colors[0].aliases[0].matchPolicy = 'fuzzy' },
    (seed: any) => { seed.colors[0].aliases[0].reviewStatus = 'verified' },
    (seed: any) => { seed.colors[0].aliases[0].alias = '!!!' },
    (seed: any) => { seed.sourceSha256 = '0'.repeat(64) },
  ]) test(`malformed source fails closed: ${mutate.toString()}`, () => {
    const resource = structuredClone(colorSourceResource)
    mutate(resource)
    assert.throws(() => validateColorResources(resource, colorSourceCollisions), /Invalid packaged Colors/)
  })
  test('a missing/incorrect declared collision is rejected', () => {
    const collisions = structuredClone(colorSourceCollisions) as any
    collisions.collisions[0].colorIds[0] = 'BLACK'
    assert.throws(() => validateColorResources(colorSourceResource, collisions), /Invalid packaged Colors/)
  })
})

describe('307 concepts and all 3475 alias records through the actual guarded pipeline', () => {
  for (const concept of colorSourceResource.colors) test(concept.colorId, async () => {
    const safeCatalog = concept.aliases.find(row => activeColors.lookup(row.alias).status === 'matched')
      ?? concept.aliases.find(row => activeColors.lookup(row.alias).status === 'ambiguous' && activeColors.lookup(row.alias).candidates.length === 1)
    for (const row of concept.aliases) {
      const lookup = activeColors.lookup(row.alias)
      const text = `Tshirt color ${row.alias} XL two pieces`
      const parser = parseVoiceSaleText(text)
      assert.ok(parser.sourceColorId?.candidates.includes(concept.colorId), `${concept.colorId}: ${row.alias}`)
      if (lookup.status === 'deferred') {
        assert.equal(parser.sourceColorId?.value, null)
        assert.ok(parser.ambiguities.some(issue => issue.kind === 'uncertain_transcription'))
        assert.notEqual((await run(text, [variant(safeCatalog?.alias ?? row.alias)])).status, 'MATCHED')
      } else if (lookup.candidates.length > 1) {
        assert.equal(parser.sourceColorId?.value, null)
        assert.notEqual((await run(text, [variant(row.alias)])).status, 'MATCHED')
      } else if (safeCatalog) {
        const target = lookup.embeddedPattern ? row.alias : safeCatalog.alias
        const result = await run(text, [variant(target)])
        assert.equal(result.status, 'MATCHED', `${concept.colorId}: ${row.alias} -> ${target}: ${JSON.stringify(result.missingFields)}`)
        assert.equal(result.match?.color, target)
        assert.equal(result.match?.quantity, 2)
        assert.equal(result.requiresConfirmation, true)
      }
    }
  })
})

describe('all 64 declared collisions and runtime/cross-domain safety', () => {
  const smoke = JSON.parse(readFileSync(new URL('../../resources/voice-sales/colors.smoke.json', import.meta.url), 'utf8')) as {
    cases: { utterance: string; colorExpression: string; expectedColorSourceIdIfUniquelyGrounded: string | null;
      existsAsRawSourceAlias: boolean; sourceColorIds: string[] }[] }
  for (const item of smoke.cases) test(`supplied smoke: ${item.colorExpression}`, () => {
    const parsed = parseVoiceSaleText(item.utterance)
    const lookup = activeColors.lookup(item.colorExpression)
    assert.equal(lookup.records.some(row => row.alias === item.colorExpression), item.existsAsRawSourceAlias)
    item.sourceColorIds.forEach(id => assert.ok(parsed.sourceColorId?.candidates.includes(id as any)))
    if (item.expectedColorSourceIdIfUniquelyGrounded) assert.equal(parsed.sourceColorId?.value, item.expectedColorSourceIdIfUniquelyGrounded)
    else if (item.existsAsRawSourceAlias) assert.equal(parsed.sourceColorId?.value, null)
    assert.equal(parsed.attributes.size.value, 'XL')
    assert.equal(parsed.attributes.quantity.value, 2)
  })
  for (const collision of colorSourceCollisions.collisions) test(collision.sourceNormalizedKey, async () => {
    for (const aliases of Object.values(collision.sourceAliasesByColor)) for (const alias of aliases) {
      const hit = activeColors.lookup(alias)
      for (const id of collision.colorIds) assert.ok(hit.candidates.includes(id), alias)
      assert.equal(hit.value, null)
      const result = await run(`Tshirt color ${alias} XL two pieces`, [variant(alias)])
      assert.notEqual(result.status, 'MATCHED', alias)
    }
  })
  test('every runtime collision, including new ones, retains all alternatives', async () => {
    for (const collision of activeColors.coverage.runtimeCollisions) {
      assert.equal(activeColors.lookup(collision.alias).value, null)
      assert.notEqual((await run(`Tshirt color ${collision.alias} XL two pieces`, [variant(collision.alias)])).status, 'MATCHED')
    }
  })
  test('cross-domain words are context-dependent and size/quantity remain separate', () => {
    for (const overlap of activeColors.coverage.crossDomain) assert.equal(activeColors.lookup(overlap.alias).status, 'ambiguous')
    for (const size of ['XL', 'XXL', 'XXXL']) assert.equal(parseVoiceSaleText(`Tshirt noir ${size} two pieces`).attributes.size.value, size)
    const numeric = parseVoiceSaleText('Tshirt noir size 32 32 pieces')
    assert.equal(numeric.attributes.size.value, '32'); assert.equal(numeric.attributes.quantity.value, 32)
    assert.equal(parseVoiceSaleText('Tshirt noir 32').attributes.quantity.value, null)
    assert.equal(parseVoiceSaleText('Tshirt noir XL').attributes.quantity.value, null)
  })
  test('domain markers preserve product/material/color distinction and cannot supply an unspoken color', async () => {
    const bare = parseVoiceSaleText('Tshirt denim XL two pieces')
    assert.equal(bare.attributes.material.value, 'DENIM')
    assert.equal(bare.sourceColorId?.value, null)
    const result = await run('Tshirt denim XL two pieces', [variant('Black', { productName: 'Tshirt Denim' })])
    assert.equal(result.status, 'INCOMPLETE')
    assert.ok(result.missingFields.includes('color'))
    const explicit = parseVoiceSaleText('Tshirt color denim XL two pieces')
    assert.equal(explicit.sourceColorId?.value, 'DENIM_BLUE')
    assert.equal(explicit.attributes.material.value, null)
    assert.equal((await run('Tshirt color denim XL two pieces', [variant('Denim Blue')])).status, 'MATCHED')
    const fabric = parseVoiceSaleText('Tshirt material denim noir XL two pieces')
    assert.equal(fabric.attributes.material.value, 'DENIM')
    assert.equal(fabric.sourceColorId?.value, 'BLACK')
    const jeans = parseVoiceSaleText('product jeans color denim XL two pieces')
    assert.equal(jeans.attributes.productType.value, 'JEANS')
    assert.equal(jeans.sourceColorId?.value, 'DENIM_BLUE')
  })
  test('French Gold operator requires an explicit color marker; negation remains blocked', async () => {
    assert.equal(parseVoiceSaleText('Tshirt color or XL two pieces').sourceColorId?.value, 'GOLD')
    for (const text of ['Tshirt or Pants gold XL two pieces', 'Tshirt not black XL two pieces', 'Tshirt color no black XL two pieces']) {
      assert.notEqual((await run(text, [variant('Gold')])).status, 'MATCHED')
    }
  })
  test('deferred records remain explicit in the audit; suggestions are never promoted', () => {
    for (const concept of colorSourceResource.colors) for (const alias of concept.aliases.filter(row => row.reviewStatus === 'needs_review')) {
      assert.equal(activeColors.coverage.disposition.find(row => row.sourceCsvLine === alias.sourceCsvLine)?.status, 'deferred')
    }
    assert.equal(activeColors.lookup('soda').status, 'deferred')
    assert.equal(activeColors.lookup('unknowncolor').status, 'unknown')
    assert.deepEqual(activeColors.matchTokens('noirish xlxxl'), [])
  })
  test('legacy gendered variants remain supported without claiming CSV coverage', () => {
    for (const [alias, id] of [['\u0643\u062d\u0644\u064a\u0629', 'NAVY_BLUE'], ['\u0632\u064a\u062a\u064a\u0629', 'OLIVE_GREEN']]) {
      assert.equal(activeColors.lookup(alias).value, id)
      assert.deepEqual(activeColors.lookup(alias).records, [])
    }
  })
})

describe('independent color/shade acceptance and matcher protections', () => {
  for (const [alias, actual, expected] of [['sawda', 'Black', 'BLACK'], ['noir', 'Black', 'BLACK'],
    ['bleu marine', 'Navy Blue', 'NAVY_BLUE'], ['zayti', 'Olive Green', 'OLIVE_GREEN'], ['orange', 'ORANGE', 'ORANGE']]) {
    test(`${alias} matches actual ${actual}`, async () => {
      assert.equal(parseVoiceSaleText(`Tshirt ${alias} XL two pieces`).sourceColorId?.value, expected)
      assert.equal((await run(`Tshirt ${alias} XL two pieces`, [variant(actual)])).status, 'MATCHED')
    })
  }
  test('different precise shades never collapse to a generic color', async () => {
    for (const [requested, actual] of [['Black', 'Jet Black'], ['Navy Blue', 'Blue'], ['Cream', 'Off White'],
      ['Burgundy', 'Wine Red'], ['Khaki Green', 'Khaki Beige']]) {
      assert.notEqual((await run(`Tshirt color ${requested} XL two pieces`, [variant(actual)])).status, 'MATCHED')
    }
  })
  test('verified legacy colors in product names retain identity without hiding unrelated model words', async () => {
    assert.equal((await run('Tshirt noir XL two pieces', [variant('Black', { productName: 'Tshirt Black' })])).status, 'MATCHED')
    assert.equal((await run('Tshirt noir XL two pieces', [variant('Black', { productName: 'Tshirt Black Classic' })])).status, 'INCOMPLETE')
    assert.notEqual((await run('Tshirt color jet black XL two pieces', [variant('Jet Black', { productName: 'Tshirt Black' })])).status, 'MATCHED')
  })
  test('ambiguous requested shade may narrow against an independently definite real color', async () => {
    assert.equal((await run('Tshirt color kaki XL two pieces', [variant('Khaki Green')])).status, 'MATCHED')
    assert.equal((await run('Tshirt color kaki XL two pieces', [variant('Khaki Green'), variant('Khaki Beige', { variantId: 'other' })])).status, 'AMBIGUOUS')
    assert.equal((await run('Tshirt color kaki XL two pieces', [variant('kaki')])).status, 'INCOMPLETE')
  })
  test('explicit pattern inside a color phrase is preserved', async () => {
    const text = 'Tshirt \u0627\u0633\u0648\u062f \u0633\u0627\u062f\u0629 XL two pieces'
    assert.equal(parseVoiceSaleText(text).attributes.pattern.value, 'PLAIN')
    assert.equal((await run(text, [variant('Black')])).status, 'INCOMPLETE')
    assert.equal((await run(text, [variant('\u0627\u0633\u0648\u062f \u0633\u0627\u062f\u0629')])).status, 'MATCHED')
    const sourcePhrase = '\u0627\u0633\u0648\u062f \u0633\u0627\u062f\u0647'
    const sourceText = `Tshirt ${sourcePhrase} XL two pieces`
    assert.equal(parseVoiceSaleText(sourceText).attributes.pattern.value, 'PLAIN')
    assert.equal((await run(sourceText, [variant('Black')])).status, 'INCOMPLETE')
    assert.equal((await run(sourceText, [variant(sourcePhrase)])).status, 'MATCHED')
  })
  test('color mode needs a real non-null stored label, never inferred components', async () => {
    for (const mode of ['No Color', 'Multicolor', 'Assorted Colors', 'Color Block', 'Gradient', 'Ombre']) {
      assert.notEqual((await run(`Tshirt color ${mode} XL two pieces`, [variant(null)])).status, 'MATCHED')
      assert.notEqual((await run(`Tshirt color ${mode} XL two pieces`, [variant('Black')])).status, 'MATCHED')
    }
  })
  test('stock, price, missing color/size/quantity, brands, empty/partial catalogs stay protected', async () => {
    const text = 'Tshirt noir XL two pieces'
    assert.equal((await run(text, [variant('Black', { availableStock: 1 })])).status, 'INSUFFICIENT_STOCK')
    assert.equal((await run(text, [variant('Black', { sellingPrice: null })])).status, 'INCOMPLETE')
    assert.equal((await run(text, [variant(null)])).status, 'INCOMPLETE')
    assert.equal((await run('Tshirt noir two pieces', [variant('Black')])).status, 'INCOMPLETE')
    assert.equal((await run('Tshirt noir XL', [variant('Black')])).status, 'INCOMPLETE')
    assert.equal((await run('Tshirt XL two pieces', [variant('Black')])).status, 'INCOMPLETE')
    assert.equal((await run('Tshirt UnknownBrand noir XL two pieces', [variant('Black')])).status, 'NOT_FOUND')
    assert.equal((await run(text, [variant('Black', { productName: 'Tshirt Classic' })])).status, 'INCOMPLETE')
    assert.equal((await run(text, [])).status, 'NOT_FOUND')
    assert.equal((await run(text, [variant('Black')], true)).status, 'INCOMPLETE')
  })
  test('material, fit, neckline and exact model requirements survive imported colors', async () => {
    for (const descriptor of ['cotton', 'slim fit', 'crew neck']) {
      assert.equal((await run(`Tshirt ${descriptor} dusty rose XL two pieces`, [variant('Dusty Rose')])).status, 'INCOMPLETE')
      assert.equal((await run(`Tshirt ${descriptor} dusty rose XL two pieces`, [variant('Dusty Rose', { productName: `Tshirt ${descriptor}` })])).status, 'MATCHED')
    }
    assert.equal((await run('Tshirt noir XL two pieces', [variant('Black', { productName: 'Tshirt Coffee' })])).status, 'INCOMPLETE')
    assert.notEqual((await run('Tshirt coffee XL two pieces', [variant('Black')])).status, 'MATCHED')
    assert.equal((await run('Tshirt color coffee XL two pieces', [variant('Coffee')])).status, 'MATCHED')
  })
})
