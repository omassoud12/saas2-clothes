import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { activeCommonExpressions, activeProductTypes, normalizeText, commonExpressionSource as seed } from './index.js'
import { commonExpressionCollisions, commonExpressionAmbiguities, validateCommonExpressionResources } from './common-expression-source.js'
import { parseVoiceSaleText } from './parser.js'
import { createVoiceMatchingService } from './matching.service.js'
import { matchParsedCatalog } from './catalog-matcher.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import type { AuthContext } from '../auth/auth.types.js'
import type { CatalogSnapshot } from './match.types.js'
import { commonExpressionIds } from './common-expression-ids.js'

const ids = (input: string) => parseVoiceSaleText(input).commonExpressionMatches!.flatMap(cue => cue.candidates)
const context: AuthContext = { userId: 'test-user', accountId: 'test-account', role: UserRole.OWNER, accountStatus: AccountStatus.ACTIVE }
const catalog: CatalogSnapshot = { variants: [{ productId: 'p', variantId: 'v', sku: 'TEST-SKU', productName: 'Cedar T-Shirt',
  categoryName: 'T-Shirts', color: 'Black', size: 'XL', sellingPrice: '20.00', availableStock: 10, currency: 'USD' }],
  scannedVariants: 1, truncated: false }

describe('Common Expressions immutable source and genuine alias activation', () => {
  for (const concept of seed.expressions) test(`concept ${concept.expression_id}`, () => {
    assert.ok(commonExpressionIds.includes(concept.expression_id))
    assert.equal(concept.review_status, 'seed_unvalidated')
    assert.ok(concept.aliases.some(alias => activeCommonExpressions.lookup(alias).candidates.includes(concept.expression_id)))
    assert.ok(Object.isFrozen(activeCommonExpressions.concept(concept.expression_id)))
  })
  for (const [index, alias] of seed.alias_index.entries()) test(`alias ${index}: ${alias.alias}`, () => {
    const hit = activeCommonExpressions.lookup(alias.alias)
    assert.ok(hit.candidates.includes(alias.expression_id))
    assert.ok(activeCommonExpressions.matchTokens(alias.alias).some(row => row.result.candidates.includes(alias.expression_id)))
    const parsed = parseVoiceSaleText(alias.alias)
    assert.ok(parsed.commonExpressionMatches!.some(cue => cue.candidates.includes(alias.expression_id)))
    assert.ok(parsed.commonExpressionMatches!.every(cue => cue.recognitionOnly && !cue.authorizesAction && cue.provenance === 'seed_unvalidated'))
    const audit = activeCommonExpressions.audit[index]
    assert.equal(audit.normalized, normalizeText(alias.alias))
    assert.equal(audit.alias, alias.alias)
    assert.ok(Object.isFrozen(audit))
    if (audit.disposition === 'active') assert.equal(hit.status, 'matched')
    if (audit.disposition === 'suggestion') assert.equal(hit.status, 'suggestion')
    if (audit.disposition === 'conditional') assert.equal(hit.status, 'context_required')
    assert.ok(Object.isFrozen(hit))
  })
  for (const collision of seed.collisions) test(`collision ${collision.normalized_key}`, () => {
    // Source-normalized keys are metadata, not extra aliases under the current normalizer.
    const aliases = seed.alias_index.filter(row => row.normalized_key === collision.normalized_key)
    for (const alias of aliases) {
      const hit = activeCommonExpressions.lookup(alias.alias)
      assert.equal(hit.status, 'context_required')
      for (const id of collision.expression_ids) assert.ok(hit.candidates.includes(id))
    }
  })
  for (const ambiguity of seed.ambiguities) test(`ambiguity ${ambiguity.phrase}`, () => {
    const hit = activeCommonExpressions.lookup(ambiguity.phrase)
    assert.equal(hit.status, 'context_required')
    assert.ok(hit.candidates.includes(ambiguity.expression_id))
    assert.notEqual(matchParsedCatalog(parseVoiceSaleText(ambiguity.phrase), catalog).status, 'MATCHED')
  })
  test('all records are partitioned without first-entry selection; invalid resources fail closed', () => {
    const coverage = activeCommonExpressions.coverage
    assert.equal(coverage.concepts, 141); assert.equal(coverage.aliasRecords, 1297)
    assert.equal(coverage.active + coverage.conditional + coverage.suggestions, 1297)
    for (const mutate of [(s: any) => s.expressions.pop(), (s: any) => s.alias_index[0].expression_id = 'INVENTED',
      (s: any) => s.alias_index[0].risk = 'trusted', (s: any) => s.categories[0].id = 'INVENTED',
      (s: any) => s.expressions[0].review_status = 'verified', (s: any) => s.collisions[0].expression_ids = ['REQ_WANT'],
      (s: any) => s.ambiguities[0].expression_id = 'INVENTED']) {
      const copy = structuredClone(seed); mutate(copy)
      assert.throws(() => validateCommonExpressionResources(copy, commonExpressionCollisions, commonExpressionAmbiguities), /Invalid packaged/)
    }
  })
})

describe('Integration source fixtures and normalized token boundaries', () => {
  const smoke = JSON.parse(readFileSync(new URL('../../resources/voice-sales/common-expressions.smoke.json', import.meta.url), 'utf8'))
  for (const row of smoke.cases) test(`source smoke ${row.id}`, () => {
    const candidates = ids(row.input)
    assert.ok(!row.expectIntentOneOf.length ? !candidates.length : row.expectIntentOneOf.some((id: string) => candidates.includes(id as never)))
  })
  for (const input of ['bdi Cedar Tshirt black XL two pieces', 'baddi Cedar Tshirt black XL two pieces', 'بدي تي شيرت سودا XL قطعتين',
    'I WANT Cedar T-shirt Black XL ٢ pieces', 'je veux Cedar T-shirt black XL two pieces',
    'jveux Cedar T-shirt black XL two pieces']) test(`affirmative request preserves slots: ${input}`, () => {
    const p = parseVoiceSaleText(input)
    assert.ok(ids(input).includes('REQ_WANT'))
    assert.equal(p.commonExpressionSafety!.salePreviewAllowed, true)
    assert.equal(p.attributes.productType.value, 'T_SHIRT'); assert.equal(p.attributes.color.value, 'BLACK')
    assert.equal(p.attributes.size.value, 'XL'); assert.equal(p.attributes.quantity.value, 2)
  })
  test('bdi/baddi/بدي never becomes Body; uncertain seed spelling stays a suggestion', () => {
    for (const input of ['bdi', 'baddi', 'بدي']) {
      const p = parseVoiceSaleText(input)
      assert.ok(ids(input).includes('REQ_WANT'))
      assert.equal(p.attributes.productType.value, null)
      assert.equal(p.sourceProductType?.value, null)
      assert.notEqual(activeProductTypes.lookup(input).status, 'candidate')
    }
    assert.equal(activeCommonExpressions.lookup('محتاين').status, 'suggestion')
    assert.equal(parseVoiceSaleText('محتاين').commonExpressionSafety!.salePreviewAllowed, false)
  })
  test('whole-token matching, Unicode and Arabic ة are preserved', () => {
    assert.equal(normalizeText('هَدِيّة'), 'هدية')
    assert.equal(activeCommonExpressions.lookup('xxbdi').status, 'unknown')
    assert.equal(activeCommonExpressions.matchTokens('khalasification').length, 0)
    assert.equal(activeCommonExpressions.lookup('BＤI').candidates[0], 'REQ_WANT')
    assert.equal(activeCommonExpressions.lookup('d’accord').candidates.length, 2)
  })
  for (const size of ['XL', 'XXL', 'XXXL']) test(`${size} remains a distinct literal size`, () => {
    const p = parseVoiceSaleText(`bdi Tshirt black size ${size} two pieces`)
    assert.equal(p.attributes.size.value, size); assert.equal(p.attributes.quantity.value, 2)
    assert.equal(p.commonExpressionSafety!.salePreviewAllowed, true)
  })
  test('32-size, explicit 32-piece quantity and bare numbers remain differentiated', () => {
    const p = parseVoiceSaleText('bdi Jeans size 32 two pieces')
    assert.equal(p.attributes.size.value, '32'); assert.equal(p.attributes.quantity.value, 2)
    assert.equal(parseVoiceSaleText('bdi Tshirt XL 32 pieces').attributes.quantity.value, 32)
    assert.equal(parseVoiceSaleText('bdi 2 tshirt soda size L').attributes.quantity.value, null)
    assert.equal(parseVoiceSaleText('bdi 2 tshirt soda size L').attributes.color.value, null)
    assert.equal(parseVoiceSaleText('بدي تلات كنزات').attributes.quantity.value, null)
  })
  test('exact count qualifiers stay attributes, while standalone confirmation stays advisory', () => {
    const p = parseVoiceSaleText('bdi Cedar Tshirt black XL exactly two pieces')
    assert.equal(p.attributes.quantity.value, 2)
    assert.equal(p.commonExpressionSafety!.salePreviewAllowed, true)
    assert.ok(p.commonExpressionMatches!.some(cue => cue.candidates.includes('CONF_CORRECT') && cue.role === 'attribute_overlap'))
    assert.equal(parseVoiceSaleText('exactly').commonExpressionSafety!.salePreviewAllowed, false)
    assert.equal(matchParsedCatalog(p, catalog).status, 'MATCHED')
  })
})

describe('Negation, partial phrases, domain ownership and non-sale safety', () => {
  test('negated cancellation keeps the order cue and suppresses embedded CANCEL', () => {
    for (const input of ['ما بدي ألغي الطلب', "don't cancel", 'ne pas annuler', 'ma bdi elghi']) {
      assert.ok(ids(input).includes('CHANGE_KEEP_ORDER'))
      assert.ok(!ids(input).includes('CANCEL_ORDER'))
      assert.equal(parseVoiceSaleText(input).commonExpressionSafety!.salePreviewAllowed, false)
    }
    const p = parseVoiceSaleText('not cancel order')
    assert.equal(p.commonExpressionMatches![0].polarity, 'negated')
    assert.equal(p.commonExpressionSafety!.reason, 'NEGATED_INTENT')
  })
  test('known rejected size stays negative; later explicit L survives without a sale preview', () => {
    const p = parseVoiceSaleText('مش هالقياس بدي L')
    assert.equal(p.attributes.size.value, 'L')
    assert.ok(p.commonExpressionMatches!.some(cue => cue.candidates.includes('REJ_NOT_SIZE')))
    assert.equal(p.commonExpressionMatches!.find(cue => cue.candidates.includes('REQ_WANT'))!.polarity, 'affirmative')
    assert.equal(p.commonExpressionSafety!.salePreviewAllowed, false)
    assert.equal(p.status, 'needs_clarification')
    assert.ok(ids('بدون طبعة').includes('PREF_NO_PRINT'))
    assert.equal(parseVoiceSaleText('بدون طبعة').attributes.pattern.value, null)
  })
  test('material/fit/neckline/size ownership cannot be consumed by an expression', () => {
    const p = parseVoiceSaleText('bdi Shirt Cedar slim fit mandarin collar black XL two pieces')
    assert.equal(p.attributes.fit.value, 'SLIM_FIT')
    assert.equal(p.sourceCollarType!.value, 'COLLAR_MANDARIN')
    assert.equal(p.commonExpressionSafety!.salePreviewAllowed, true)
    assert.ok(p.productNameResidualTokens.some(row => row.token === 'cedar'))
    assert.equal(parseVoiceSaleText('فيها ليكرا').commonExpressionSafety!.salePreviewAllowed, false)
  })
  test('unknown brands and explicit model phrases remain exact name constraints', () => {
    const p = parseVoiceSaleText('bdi Shirt Cedar Unknown Collection black XL two pieces')
    assert.deepEqual(p.productNameResidualTokens.map(row => row.token), ['cedar', 'unknown', 'collection'])
    const literal = parseVoiceSaleText('Shirt model original black XL two pieces')
    assert.ok(literal.productNameResidualTokens.some(row => row.token === 'original'))
    assert.ok(literal.commonExpressionMatches!.some(row => row.role === 'literal_name'))
    const confirmedName = parseVoiceSaleText('Shirt model Akid black XL two pieces')
    assert.ok(confirmedName.productNameResidualTokens.some(row => row.token === 'akid'))
    const interior = parseVoiceSaleText('Shirt Cedar i need black XL two pieces')
    assert.ok(interior.productNameResidualTokens.some(row => row.token === 'need'))
    assert.equal(interior.commonExpressionSafety!.salePreviewAllowed, false)
  })
  for (const input of ['خلص', 'yes', 'okay', 'تمام', 'أكيد', 'في منها XL', 'زيدلي قطعة',
    'cancel order', 'return item', 'دفع عند الاستلام', 'reserve for me', 'بدي دليفري', 'بدون طبعة',
    'غيرلي اللون', 'd accord', 'قديش السعر', 'ما بدي ألغي الطلب']) test(`no automatic sale/read/write: ${input}`, async () => {
    let calls = 0
    const service = createVoiceMatchingService({ async read() { calls++; return catalog } })
    const result = await service.matchVoiceSaleText(`${input} Cedar Tshirt black XL two pieces`, context)
    assert.notEqual(result.status, 'MATCHED'); assert.equal(result.match, null)
    assert.equal(calls, 0); assert.equal(result.requiresConfirmation, true)
    assert.notEqual(matchParsedCatalog(result.parser, catalog).status, 'MATCHED')
  })
  test('read-only affirmative catalog matching uses actual product/variant and remains advisory', async () => {
    const service = createVoiceMatchingService({ async read() { return catalog } })
    const result = await service.matchVoiceSaleText('je veux Cedar T-shirt black XL two pieces', context)
    assert.equal(result.status, 'MATCHED'); assert.equal(result.match!.variantId, 'v')
    assert.equal(result.match!.quantity, 2); assert.equal(result.requiresConfirmation, true)
    assert.notEqual((await service.matchVoiceSaleText('je veux Unknown T-shirt black XL two pieces', context)).status, 'MATCHED')
    assert.notEqual((await service.matchVoiceSaleText('bdi T-shirt black two pieces', context)).status, 'MATCHED')
  })
  test('input limits and multi-product safety survive; authority is checked before language gating', async () => {
    assert.equal(parseVoiceSaleText('بدي تي شيرت سودا و فستان حمرا').status, 'unsupported_multiple_items')
    assert.equal(parseVoiceSaleText('bdi '.repeat(1100)).status, 'invalid_input')
    assert.equal(parseVoiceSaleText('\u0000yes').status, 'invalid_input')
    let calls = 0
    const service = createVoiceMatchingService({ async read() { calls++; return catalog } })
    for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
      assert.equal((await service.matchVoiceSaleText('yes', { ...context, role })).match, null)
    }
    for (const ctx of [{ ...context, role: UserRole.SUPER_ADMIN }, { ...context, accountStatus: AccountStatus.SUSPENDED }]) {
      await assert.rejects(service.matchVoiceSaleText('yes', ctx), /active authorized tenant/)
    }
    assert.equal(calls, 0)
  })
})
