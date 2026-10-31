import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import type { AuthContext } from '../auth/auth.types.js'
import { createVoiceMatchingService } from './matching.service.js'
import { segmentVoiceSaleText } from './multi-item-segmenter.js'
import { parseVoiceSaleText } from './parser.js'
import { requestIntentAliasCount, requestIntentDeclaredAliasCount, requestIntentIds } from './request-intent.js'

const auth: AuthContext = { userId: 'user-a', accountId: 'account-a', role: UserRole.OWNER,
  accountStatus: AccountStatus.ACTIVE }

describe('request verb and intent recognition', () => {
  for (const [intent, examples] of Object.entries({
    REQ_WANT: ['بدي', 'بدّي', 'أريد', 'اريد', 'bdi', 'baddi', 'bade', 'badi', 'beddi', 'I want', 'I need', 'je veux'],
    REQ_GIVE: ['عطيني', 'اعطيني', 'أعطني', '3tini', 'atini', 'give me'],
    REQ_GET: ['جيبلي', 'جيب لي', 'هاتلي', 'jiblie', 'jib li', 'hatli', 'get me'],
    REQ_ADD_INTENT: ['زيدلي', 'زيد لي', 'zidli', 'add', 'add me'],
  })) for (const expression of examples) test(`${expression} resolves to ${intent}`, () => {
    const parsed = parseVoiceSaleText(`${expression} t shirt black L two pieces`)
    assert.equal(parsed.requestIntents?.[0]?.canonicalIntent, intent)
    assert.equal(parsed.requestIntents?.[0]?.polarity, 'affirmative')
    assert.equal(parsed.requestIntents?.[0]?.certainty, 'exact')
    assert.equal(parsed.requestIntents?.[0]?.recognitionOnly, true)
    assert.equal(parsed.requestIntents?.[0]?.authorizesAction, false)
    assert.equal(parsed.attributes.productType.value, 'T_SHIRT')
    assert.equal(parsed.attributes.color.value, 'BLACK')
    assert.equal(parsed.attributes.size.value, 'L')
    if (intent === 'REQ_ADD_INTENT') {
      assert.equal(parsed.attributes.quantity.value, null)
      assert.equal(parsed.quantityIntent?.intent, 'add')
      assert.equal(parsed.quantityIntent?.status, 'advisory')
    } else assert.equal(parsed.attributes.quantity.value, 2)
    for (let index = parsed.requestIntents![0]!.sourceSpan.startToken;
      index < parsed.requestIntents![0]!.sourceSpan.endToken; index++) {
      assert.ok(!parsed.productNameResidualTokens.some(token => token.index === index))
      assert.ok(!parsed.unrecognizedTokens.some(token => token.index === index))
    }
  })

  test('registry exposes four canonical intents and unique normalized aliases', () => {
    assert.deepEqual(requestIntentIds, ['REQ_WANT', 'REQ_GIVE', 'REQ_GET', 'REQ_ADD_INTENT'])
    assert.equal(requestIntentDeclaredAliasCount, 31)
    assert.equal(requestIntentAliasCount, 29)
  })

  test('mixed-language request preserves brand, constraints and request evidence', () => {
    const parsed = parseVoiceSaleText('badi t shirt zara black L kt3ten')
    assert.deepEqual(parsed.requestIntents?.map(row => row.canonicalIntent), ['REQ_WANT'])
    assert.equal(parsed.requestIntents?.[0]?.matchedExpression, 'badi')
    assert.equal(parsed.requestIntents?.[0]?.languageEvidence, 'arabizi')
    assert.deepEqual(parsed.productNameResidualTokens.map(token => token.token), ['zara'])
    assert.equal(parsed.attributes.productType.value, 'T_SHIRT')
    assert.equal(parsed.attributes.color.value, 'BLACK')
    assert.equal(parsed.attributes.size.value, 'L')
    assert.equal(parsed.attributes.quantity.value, 2)
  })

  for (const input of ['ما بدي تي شيرت اسود', 'لا أريد قميص اسود', 'ma bdi tshirt black',
    "I don't want a black shirt", 'I do not need a black shirt', 'je ne veux pas de chemise noire']) {
    test(`negation remains scoped: ${input}`, async () => {
      const parsed = parseVoiceSaleText(input)
      assert.equal(parsed.requestIntents?.[0]?.canonicalIntent, 'REQ_WANT')
      assert.equal(parsed.requestIntents?.[0]?.polarity, 'negated')
      assert.equal(parsed.commonExpressionSafety?.reason, 'NEGATED_INTENT')
      assert.equal(parsed.commonExpressionSafety?.salePreviewAllowed, false)
      let reads = 0
      const result = await createVoiceMatchingService({ async read() { reads++; return { variants: [], scannedVariants: 0, truncated: false } } })
        .matchVoiceSaleText(input, auth)
      assert.equal(result.match, null)
      assert.equal(reads, 0)
    })
  }

  test('body remains a product, badi remains a request, and contextual aliases fail closed', () => {
    const body = parseVoiceSaleText('body black')
    assert.equal(body.requestIntents?.length, 0)
    assert.ok(body.attributes.productType.candidates.includes('BODYSUIT')
      || body.sourceProductType?.candidates.includes('BODYSUIT'))
    assert.equal(parseVoiceSaleText('badi body black').requestIntents?.[0]?.canonicalIntent, 'REQ_WANT')
    assert.equal(parseVoiceSaleText('بديلي').requestIntents?.[0]?.certainty, 'context_required')
    assert.equal(parseVoiceSaleText('بديلي تيشيرت').requestIntents?.[0]?.certainty, 'exact')
    assert.equal(parseVoiceSaleText('زيدلي').requestIntents?.[0]?.certainty, 'exact')
    assert.equal(parseVoiceSaleText('add').requestIntents?.[0]?.certainty, 'context_required')
  })
})

describe('request intents in multi-item segmentation', () => {
  test('one leading request remains on the first independent conjunction item', () => {
    const segmented = segmentVoiceSaleText('بدي تيشيرت اسود وبنطلون ابيض')
    assert.equal(segmented.status, 'segmented')
    const parsed = segmented.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
    assert.equal(parsed[0]?.requestIntents?.[0]?.canonicalIntent, 'REQ_WANT')
    assert.equal(parsed[0]?.requestIntents?.[0]?.itemIndex, 0)
    assert.equal(parsed[1]?.requestIntents?.length, 0)
    assert.equal(parsed[0]?.attributes.color.value, 'BLACK')
    assert.equal(parsed[1]?.attributes.color.value, 'WHITE')
  })

  test('repeated request verbs stay independent', () => {
    const segmented = segmentVoiceSaleText('bdi polo zar2a w bdi pantalon aswad')
    assert.equal(segmented.status, 'segmented')
    const parsed = segmented.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
    assert.deepEqual(parsed.map(row => row.requestIntents?.[0]?.canonicalIntent), ['REQ_WANT', 'REQ_WANT'])
    assert.deepEqual(parsed.map(row => row.requestIntents?.[0]?.itemIndex), [0, 1])
    assert.equal(parsed[0]?.attributes.color.value, 'BLUE')
    assert.equal(parsed[1]?.attributes.color.value, 'BLACK')
  })

  test('different clause verbs retain independent canonical intents', () => {
    const segmented = segmentVoiceSaleText('عطيني قميص أبيض وجيبلي بنطلون أسود')
    assert.equal(segmented.status, 'segmented')
    const parsed = segmented.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
    assert.deepEqual(parsed.map(row => row.requestIntents?.[0]?.canonicalIntent), ['REQ_GIVE', 'REQ_GET'])
    assert.deepEqual(parsed.map(row => row.attributes.productType.value), ['SHIRT', 'PANTS'])
    assert.deepEqual(parsed.map(row => row.attributes.color.value), ['WHITE', 'BLACK'])
  })
})
