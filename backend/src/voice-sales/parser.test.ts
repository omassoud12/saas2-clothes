import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MAX_VOICE_SALE_TEXT_LENGTH, parseVoiceSaleText } from './parser.js'
import { segmentVoiceSaleText } from './multi-item-segmenter.js'
import type { AttributeName, VoiceSaleAttributes, VoiceSaleParseResult } from './parser.types.js'

function resolved<F extends AttributeName>(result: VoiceSaleParseResult, field: F,
  expected: VoiceSaleAttributes[F], source?: 'explicit' | 'inferred' | 'mixed') {
  const attribute = result.attributes[field]
  assert.equal(attribute.status, 'resolved', `${field}: ${JSON.stringify(result.ambiguities)}`)
  assert.equal(attribute.value, expected)
  assert.deepEqual(attribute.candidates, [expected])
  if (source) assert.equal(attribute.source, source)
}

describe('Lebanese orange T-shirt vocabulary regression', () => {
  for (const text of ['t chirt orange kt3ten', 'tchirt orange kt3ten', 'تي شيرت برتقالي قطعتين',
    'تي شيرت برتقالية قطعتين', 'T-shirt Orange two pieces', 'بدي t chirt بُرْتُقَالِيّ KT٣TEN']) {
    test(`explicit type/color/quantity without invented size: ${text}`, () => {
      const result = parseVoiceSaleText(text)
      resolved(result, 'productType', 'T_SHIRT', 'explicit')
      resolved(result, 'color', 'ORANGE', 'explicit')
      resolved(result, 'quantity', 2, 'explicit')
      assert.equal(result.attributes.size.status, 'missing')
      assert.equal(result.attributes.size.value, null)
      assert.ok(result.missingInformation.includes('size'))
      assert.deepEqual(result.unrecognizedTokens, [])
      assert.deepEqual(result.productNameResidualTokens, [])
      assert.deepEqual(result.ambiguities, [])
    })
  }
  for (const size of ['XL', 'XXL', 'XXXL'] as const) {
    test(`${size} remains distinct with the new quantity alias`, () => {
      const result = parseVoiceSaleText(`t chirt orange ${size} kt3ten`)
      resolved(result, 'size', size, 'explicit')
      resolved(result, 'quantity', 2, 'explicit')
    })
  }
  test('size 32 and explicit quantities 2/32 remain separate', () => {
    const two = parseVoiceSaleText('t chirt orange size ٣٢ kt3ten')
    resolved(two, 'size', '32', 'explicit')
    resolved(two, 'quantity', 2, 'explicit')
    const thirtyTwo = parseVoiceSaleText('t chirt orange size 32 32 pieces')
    resolved(thirtyTwo, 'size', '32', 'explicit')
    resolved(thirtyTwo, 'quantity', 32, 'explicit')
    const ambiguous = parseVoiceSaleText('t chirt orange 32 kt3ten')
    assert.equal(ambiguous.attributes.size.value, null)
    resolved(ambiguous, 'quantity', 2, 'explicit')
    assert.ok(ambiguous.ambiguities.some(row => row.kind === 'unresolved_number'))
  })
})

describe('explicit garment and Polo catalog-evidence separation', () => {
  const tshirtRequests: readonly [string, 'REQ_WANT' | 'REQ_GIVE'][] = [
    ['بدي تيشيرت polo', 'REQ_WANT'],
    ['بدي تي شيرت polo', 'REQ_WANT'],
    ['بدي polo تيشيرت', 'REQ_WANT'],
    ['بدي t chirt polo', 'REQ_WANT'],
    ['badi t shirt polo', 'REQ_WANT'],
    ['bdi t-shirt polo', 'REQ_WANT'],
    ['بدي tshirt polo', 'REQ_WANT'],
    ['عطيني تيشيرت polo', 'REQ_GIVE'],
    ['اعطيني تيشيرت polo', 'REQ_GIVE'],
  ]
  for (const [input, intent] of tshirtRequests) test(`keeps type and model evidence separate: ${input}`, () => {
    const parsed = parseVoiceSaleText(input)
    assert.equal(parsed.originalText, input)
    resolved(parsed, 'productType', 'T_SHIRT', 'explicit')
    assert.equal(parsed.requestIntents?.[0]?.canonicalIntent, intent)
    assert.deepEqual(parsed.productNameResidualTokens.map(row => row.token), ['polo'])
    assert.ok(parsed.productNameResidualTokens.every(row => !['بدي', 'bdi', 'badi', 'عطيني', 'اعطيني',
      'تي', 'شيرت', 'تيشيرت', 't', 'shirt', 'chirt', 'tshirt'].includes(row.token)))
  })

  test('keeps color, size and quantity independent from Polo evidence', () => {
    const colored = parseVoiceSaleText('بدي تيشيرت polo أسود')
    resolved(colored, 'productType', 'T_SHIRT'); resolved(colored, 'color', 'BLACK')
    assert.deepEqual(colored.productNameResidualTokens.map(row => row.token), ['polo'])
    const complete = parseVoiceSaleText('بدي تيشيرت polo أسود L قطعتين')
    resolved(complete, 'productType', 'T_SHIRT'); resolved(complete, 'color', 'BLACK')
    resolved(complete, 'size', 'L'); resolved(complete, 'quantity', 2)
    assert.deepEqual(complete.productNameResidualTokens.map(row => row.token), ['polo'])
  })

  test('uses an explicit collar marker instead of inventing model evidence', () => {
    const parsed = parseVoiceSaleText('بدي تيشيرت قبّة polo')
    resolved(parsed, 'productType', 'T_SHIRT')
    assert.equal(parsed.sourceCollarType?.status, 'resolved')
    assert.equal(parsed.sourceCollarType?.value, 'COLLAR_POLO')
    assert.deepEqual(parsed.productNameResidualTokens, [])
  })

  test('keeps Pants explicit while preserving Polo as model evidence', () => {
    const parsed = parseVoiceSaleText('بدي بنطلون polo')
    resolved(parsed, 'productType', 'PANTS')
    assert.deepEqual(parsed.productNameResidualTokens.map(row => row.token), ['polo'])
    assert.equal(parsed.sourceCollarType?.status, 'missing')
  })

  test('does not force bare Polo into T-Shirt', () => {
    const parsed = parseVoiceSaleText('بدي polo فقط')
    assert.notEqual(parsed.attributes.productType.value, 'T_SHIRT')
    assert.ok(['ambiguous', 'missing'].includes(parsed.attributes.productType.status))
  })

  test('splits a safe Arabic/Latin STT boundary and preserves the raw transcript', () => {
    const input = 'بدي تيشيرتpolo'
    const parsed = parseVoiceSaleText(input)
    assert.equal(parsed.originalText, input)
    assert.equal(parsed.normalizedText, 'بدي تيشيرت polo')
    resolved(parsed, 'productType', 'T_SHIRT')
    assert.deepEqual(parsed.productNameResidualTokens.map(row => row.token), ['polo'])
  })

  test('keeps linen catalog evidence separate and resolves an explicit numeric size marker', () => {
    const input = 'بدي بنطلون كتان لون أزرق قياس 32'
    const parsed = parseVoiceSaleText(input)
    assert.equal(parsed.originalText, input)
    resolved(parsed, 'productType', 'PANTS')
    resolved(parsed, 'material', 'LINEN')
    resolved(parsed, 'color', 'BLUE')
    resolved(parsed, 'size', '32')
    assert.deepEqual(parsed.attributes.material.evidence.map(row => row.span.text), ['كتان'])
    assert.ok(!parsed.productNameResidualTokens.some(row => row.token === 'قياس'))
    assert.deepEqual(parsed.productNameResidualTokens, [])
  })
})

describe('deterministic multi-item utterance segmentation', () => {
  test('separates the reported Arabic conjunction request without leaking colors', () => {
    const result = segmentVoiceSaleText('bdi polo زرقاء و بنطلون اسود')
    assert.equal(result.status, 'segmented')
    assert.deepEqual(result.reasons, ['CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE'])
    assert.deepEqual(result.segments.map(segment => segment.text), ['polo زرقاء', 'بنطلون اسود'])
    const [polo, pants] = result.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
    assert.equal(polo.attributes.productType.status, 'ambiguous')
    assert.deepEqual(polo.attributes.productType.candidates, ['POLO_SHIRT'])
    resolved(polo, 'color', 'BLUE'); resolved(pants, 'productType', 'PANTS'); resolved(pants, 'color', 'BLACK')
    assert.equal(polo.attributes.size.status, 'missing'); assert.equal(polo.attributes.quantity.status, 'missing')
    assert.equal(pants.attributes.size.status, 'missing'); assert.equal(pants.attributes.quantity.status, 'missing')
    assert.ok(polo.ambiguities.some(row => row.kind === 'lexical_ambiguity'))
  })
  test('supports attached Arabic waw, Arabizi w, English and, and three independently described products', () => {
    for (const [text, expectedTypes, expectedColors] of [
      ['بدي تي شيرت أسود وبنطلون أبيض', ['T_SHIRT', 'PANTS'], ['BLACK', 'WHITE']],
      ['بدي قميص أزرق و جينز أسود', ['SHIRT', null], ['BLUE', 'BLACK']],
      ['bdi tshirt black w pantalon white', ['T_SHIRT', 'PANTS'], ['BLACK', 'WHITE']],
      ['I want shirt blue and pants black', ['SHIRT', 'PANTS'], ['BLUE', 'BLACK']],
      ['بدي فستان أحمر وقميص أبيض وبنطلون أسود', ['DRESS', 'SHIRT', 'PANTS'], ['RED', 'WHITE', 'BLACK']],
    ] as const) {
      const segmented = segmentVoiceSaleText(text)
      assert.equal(segmented.status, 'segmented', text)
      const parsed = segmented.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
      assert.deepEqual(parsed.map(row => row.attributes.productType.value), expectedTypes, text)
      assert.deepEqual(parsed.map(row => row.attributes.color.value), expectedColors, text)
    }
  })
  test('keeps sizes and quantities owned by their clauses, with conservative bare-number context', () => {
    const sized = segmentVoiceSaleText('بدي تيشيرت قياس L وبنطلون قياس 38')
    assert.equal(sized.status, 'segmented')
    const sizes = sized.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
    assert.deepEqual(sizes.map(row => row.attributes.size.value), ['L', '38'])
    assert.ok(sizes.every(row => row.attributes.quantity.status === 'missing'))

    const counted = segmentVoiceSaleText('بدي قطعتين تيشيرت و3 بناطيل')
    assert.equal(counted.status, 'segmented')
    const quantities = counted.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
    assert.deepEqual(quantities.map(row => row.attributes.quantity.value), [2, 3])
    assert.ok(quantities.every(row => row.attributes.size.status === 'missing'))
    assert.equal(parseVoiceSaleText('38 بنطلون').attributes.quantity.status, 'missing')
    assert.ok(parseVoiceSaleText('38 بنطلون').ambiguities.some(row => row.kind === 'unresolved_number'))
  })
  test('does not split color, alternative, material, fit, unclear, or brand-name conjunctions', () => {
    for (const text of ['بدي تي شيرت أسود وأبيض', 'بدي تي شيرت أزرق أو أسود', 'بدي قميص قطن وبوليستر',
      'بدي بنطلون واسع وطويل', 'T-shirt and pants black', 'Acme And Sons shirt black', 'H&M shirt black']) {
      assert.equal(segmentVoiceSaleText(text).status, 'single', text)
    }
    assert.notEqual(segmentVoiceSaleText('بدي تيشيرت اسود و مش بنطلون ابيض').status, 'segmented')
    assert.notEqual(segmentVoiceSaleText('بدي تيشيرت اسود و قصدي بنطلون ابيض').status, 'segmented')
  })
  test('separates the reported Lebanese request and keeps Polo as catalog-name evidence', () => {
    const result = segmentVoiceSaleText('بدي t shirt zara لونه اسود بدي بنطلون polo يا كبير')
    assert.equal(result.status, 'segmented')
    assert.deepEqual(result.segments.map(segment => segment.text), ['t shirt zara لونه اسود', 'بنطلون polo'])
    const [shirt, pants] = result.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
    resolved(shirt, 'productType', 'T_SHIRT'); resolved(shirt, 'color', 'BLACK')
    assert.deepEqual(shirt.productNameResidualTokens.map(token => token.token), ['zara'])
    resolved(pants, 'productType', 'PANTS')
    assert.deepEqual(pants.productNameResidualTokens.map(token => token.token), ['polo'])
    assert.equal(pants.attributes.size.status, 'missing')
    assert.ok(result.removedConversationalExpressions.includes('يا كبير'))
  })
  test('supports three explicit requests while isolating quantities and colors', () => {
    const result = segmentVoiceSaleText('bdi Zara T-shirt black two pieces bdi Polo pants blue three pieces bdi dress red one piece')
    assert.equal(result.status, 'segmented'); assert.equal(result.segments.length, 3)
    const parsed = result.segments.map(segment => parseVoiceSaleText(segment.parseText, segment.parserOptions))
    assert.deepEqual(parsed.map(row => row.attributes.quantity.value), [2, 3, 1])
    assert.deepEqual(parsed.map(row => row.attributes.color.value), ['BLACK', 'BLUE', 'RED'])
    assert.deepEqual(parsed.map(row => row.attributes.productType.value), ['T_SHIRT', 'PANTS', 'DRESS'])
  })
  test('keeps single items backward compatible and refuses unclear conjunction scope', () => {
    assert.equal(segmentVoiceSaleText('بدي Zara T-shirt اسود').status, 'single')
    assert.equal(segmentVoiceSaleText('T-shirt and pants black').status, 'single')
  })
  test('does not remove genuine size language and fails closed for negation or correction scope', () => {
    const genuine = segmentVoiceSaleText('بدي تي شيرت قياس كبير بدي بنطلون قياس xl')
    assert.equal(genuine.status, 'segmented')
    assert.match(genuine.segments[0].parseText, /قياس كبير/u)
    assert.equal(segmentVoiceSaleText('بدي ما بدي تي شيرت بدي بنطلون').status, 'ambiguous')
    assert.equal(segmentVoiceSaleText('بدي تي شيرت قصدي بدي بنطلون').status, 'ambiguous')
  })
})

describe('active Product Types parsing', () => {
  for (const [text, ids] of [
    ['بودي', ['BABY_ONESIE', 'BODYSUIT']], ['كولون', ['LEGGINGS', 'TIGHTS']],
    ['كيلوت', ['MEN_BRIEFS', 'PANTIES']], ['robe', ['DRESS', 'ROBE_HOME']],
  ] as const) test(`source ambiguity stays visible: ${text}`, () => {
    const result = parseVoiceSaleText(text)
    assert.equal(result.status, 'needs_clarification')
    assert.equal(result.attributes.productType.value, null)
    assert.deepEqual(result.productTypeCandidates![0].result.candidates.map(candidate => candidate.sourceTypeId), ids)
    assert.equal(result.sourceProductType?.status, 'ambiguous')
    assert.equal(result.productTypeCandidates![0].requiresCatalogEvidence, false)
  })
  for (const text of ['قميص تي شيرت', 'tee-shirt', 'بودي بيبي', 'baby onesie', 'two piece set']) {
    test(`whole source phrase overrides shorter lexical fragments: ${text}`, () => {
      const result = parseVoiceSaleText(text)
      assert.equal(result.status, 'incomplete')
      assert.equal(result.productTypeCandidates!.length, 1)
      assert.equal(result.productTypeCandidates![0].startToken, 0)
      assert.equal(result.productTypeCandidates![0].endToken, result.normalizedText.split(' ').length)
      assert.equal(result.sourceProductType?.status, 'resolved')
      assert.equal(result.attributes.quantity.value, null)
      assert.equal(result.attributes.size.value, null)
      assert.deepEqual(result.productNameResidualTokens, [])
    })
  }
  test('a French product alias is active, and unseen brand words remain residual', () => {
    const result = parseVoiceSaleText('chemise Cedar Moon black XL two pieces')
    assert.equal(result.attributes.productType.status, 'resolved')
    assert.deepEqual(result.attributes.productType.candidates, ['SHIRT'])
    assert.deepEqual(result.productNameResidualTokens.map(token => token.token), ['cedar', 'moon'])
    resolved(result, 'size', 'XL', 'explicit')
    resolved(result, 'quantity', 2, 'explicit')
  })
  test('recognizes the Lebanese Arabic STT spelling of chemise as a Shirt', () => {
    const result = parseVoiceSaleText('بدي شيميز لونه أسود وقياسه إكس لارج')
    resolved(result, 'productType', 'SHIRT', 'explicit')
    resolved(result, 'color', 'BLACK', 'explicit')
    resolved(result, 'size', 'XL', 'explicit')
    assert.equal(result.attributes.quantity.value, null)
    assert.deepEqual(result.productNameResidualTokens, [])
  })
  for (const size of ['XL', 'XXL', 'XXXL'] as const) test(`new product phrases keep explicit size ${size}`, () => {
    const result = parseVoiceSaleText(`chemise black ${size} two pieces`)
    resolved(result, 'size', size, 'explicit')
    resolved(result, 'quantity', 2, 'explicit')
  })
  test('size 32 remains separate from bare or explicit quantity 32', () => {
    const result = parseVoiceSaleText('chemise black size ٣٢ 32 pieces')
    resolved(result, 'size', '32', 'explicit')
    resolved(result, 'quantity', 32, 'explicit')
    const ambiguous = parseVoiceSaleText('chemise black 32')
    assert.equal(ambiguous.attributes.size.value, null)
    assert.equal(ambiguous.attributes.quantity.value, null)
    assert.ok(ambiguous.ambiguities.some(issue => issue.kind === 'unresolved_number'))
  })
  test('a new Pants alias keeps the existing adjacent Pants/Jeans compound safety semantics', () => {
    const result = parseVoiceSaleText('pantalon jeans size 32 two pieces')
    assert.equal(result.status, 'needs_clarification')
    assert.deepEqual(result.attributes.productType.candidates, ['PANTS', 'JEANS'])
    resolved(result, 'size', '32', 'explicit')
    resolved(result, 'quantity', 2, 'explicit')
  })
  test('negated seed vocabulary does not create affirmative candidate evidence', () => {
    const result = parseVoiceSaleText('not baby onesie black XL two pieces')
    assert.deepEqual(result.productTypeCandidates, [])
    assert.equal(result.attributes.productType.value, null)
  })
  for (const text of ['baby onesie and scarf', 'baby onesie scarf', 'chemise and chemise', 'chemise jeans']) {
    test(`staged source IDs still reject multiple item descriptions: ${text}`, () => {
      assert.equal(parseVoiceSaleText(text).status, 'unsupported_multiple_items')
    })
  }
})

describe('required Phase 1B examples', () => {
  test('A: Lebanese Arabic mixed request', () => {
    const text = 'بدي T-shirt بيضا قياس XL قطعتين'
    const result = parseVoiceSaleText(text)
    assert.equal(result.status, 'parsed')
    assert.equal(result.originalText, text)
    assert.equal(result.normalizedText, 'بدي t shirt بيضا قياس xl قطعتين')
    resolved(result, 'productType', 'T_SHIRT', 'explicit')
    resolved(result, 'color', 'WHITE', 'explicit')
    resolved(result, 'size', 'XL', 'explicit')
    resolved(result, 'quantity', 2, 'explicit')
    assert.deepEqual(result.productNameResidualTokens, [])
    assert.equal(result.attributes.material.status, 'missing')
  })
  test('B: Pants/Jeans ambiguity, velvet, navy and numeric size', () => {
    const result = parseVoiceSaleText('بدي بنطلون jeans مخمل كحلي قياس 32')
    assert.equal(result.status, 'needs_clarification')
    assert.equal(result.attributes.productType.status, 'ambiguous')
    assert.equal(result.attributes.productType.value, null)
    assert.deepEqual(result.attributes.productType.candidates, ['PANTS', 'JEANS'])
    resolved(result, 'material', 'VELVET')
    resolved(result, 'color', 'NAVY_BLUE')
    resolved(result, 'size', '32')
    assert.equal(result.attributes.quantity.status, 'missing')
    assert.equal(result.attributes.quantity.value, null)
    assert.ok(result.missingInformation.includes('quantity'))
    assert.ok(result.unresolvedInformation.includes('productType'))
    assert.ok(!result.ambiguities.some(issue => issue.kind === 'multiple_items'))
  })
  test('C: ambiguous Kenza, explicit Polo collar and no invented size', () => {
    const result = parseVoiceSaleText('بدي كنزة قبّة Polo سودا')
    assert.equal(result.status, 'needs_clarification')
    assert.deepEqual(result.attributes.productType.candidates, ['SWEATER', 'TOP'])
    resolved(result, 'neckline', 'POLO_COLLAR', 'explicit')
    resolved(result, 'color', 'BLACK')
    assert.equal(result.attributes.size.value, null)
    assert.equal(result.attributes.quantity.value, null)
    assert.equal(result.attributes.size.status, 'missing')
  })
  test('D: English and Arabizi with a quantity-word/unit phrase', () => {
    const result = parseVoiceSaleText('T-shirt sawda XL two pieces')
    assert.equal(result.status, 'parsed')
    resolved(result, 'productType', 'T_SHIRT')
    resolved(result, 'color', 'BLACK')
    resolved(result, 'size', 'XL')
    resolved(result, 'quantity', 2)
    assert.deepEqual(result.unrecognizedTokens, [])
  })
})

describe('supported language and attribute structures', () => {
  for (const [input, field, expected] of [
    ['تي شيرت', 'productType', 'T_SHIRT'], ['Tchirt', 'productType', 'T_SHIRT'],
    ['بنطلون جينز', 'productType', 'JEANS'], ['بنطلون', 'productType', 'PANTS'],
    ['بودي', 'productType', 'BODYSUIT'], ['Sweater', 'productType', 'SWEATER'],
    ['فستان', 'productType', 'DRESS'], ['Leggings', 'productType', 'LEGGINGS'],
    ['Tights', 'productType', 'TIGHTS'], ['كيلوت', 'productType', 'UNDERWEAR'],
    ['سوتيان', 'productType', 'BRA'], ['هودي', 'productType', 'HOODIE'],
    ['جاكيت', 'productType', 'JACKET'], ['قميص', 'productType', 'SHIRT'],
    ['بلوزة', 'productType', 'TOP'], ['Polo Shirt', 'productType', 'POLO_SHIRT'],
    ['أسود', 'color', 'BLACK'], ['Bayda', 'color', 'WHITE'], ['Ka7le', 'color', 'NAVY_BLUE'],
    ['زيتية', 'color', 'OLIVE_GREEN'], ['Khadra', 'color', 'GREEN'], ['7amra', 'color', 'RED'],
    ['زرقا', 'color', 'BLUE'], ['رصاصي', 'color', 'GREY'], ['بيج', 'color', 'BEIGE'],
    ['بني', 'color', 'BROWN'], ['زهري', 'color', 'PINK'], ['أصفر', 'color', 'YELLOW'],
    ['XS', 'size', 'XS'], ['S', 'size', 'S'], ['M', 'size', 'M'], ['L', 'size', 'L'],
    ['XL', 'size', 'XL'], ['XXL', 'size', 'XXL'], ['XXXL', 'size', 'XXXL'],
    ['size 28', 'size', '28'], ['size 30', 'size', '30'], ['size 32', 'size', '32'],
    ['size 34', 'size', '34'], ['size 36', 'size', '36'], ['size 38', 'size', '38'], ['size 40', 'size', '40'],
    ['مخمل', 'material', 'VELVET'], ['2oton', 'material', 'COTTON'], ['Denim', 'material', 'DENIM'],
    ['صوف', 'material', 'WOOL'], ['كتان', 'material', 'LINEN'], ['جلد', 'material', 'LEATHER'],
    ['قبّة Polo', 'neckline', 'POLO_COLLAR'], ['قبّة مبرومة', 'neckline', 'CREW_NECK'],
    ['قبّة V', 'neckline', 'V_NECK'], ['3al jesem', 'fit', 'SLIM_FIT'],
    ['عادي', 'fit', 'REGULAR_FIT'], ['أوفر سايز', 'fit', 'OVERSIZED'], ['واسع', 'fit', 'LOOSE_FIT'],
    ['سادة', 'pattern', 'PLAIN'], ['مخطط', 'pattern', 'STRIPED'],
    ['مربعات', 'pattern', 'CHECKERED'], ['Wavy Pattern', 'pattern', 'WAVY'],
    ['واحد', 'quantity', 1], ['قطعتين', 'quantity', 2], ['تلاتة', 'quantity', 3],
    ['أربع قطع', 'quantity', 4], ['5amse', 'quantity', 5], ['ستة', 'quantity', 6],
    ['سبعة', 'quantity', 7], ['تمانية', 'quantity', 8], ['تسعة', 'quantity', 9],
    ['عشرة', 'quantity', 10], ['Tna3sh', 'quantity', 12], ['عشرين', 'quantity', 20],
    ['24 pieces', 'quantity', 24], ['ثلاثين', 'quantity', 30], ['32 pieces', 'quantity', 32],
    ['خمسين', 'quantity', 50], ['مية', 'quantity', 100],
  ] as const) {
    test(`${input}: ${field} retains ${expected}`, () => {
      const result = parseVoiceSaleText(input)
      if (['بودي', 'كيلوت', 'بلوزة'].includes(input)) {
        // The new seed exposes additional meanings; preserve the old canonical candidate, not a forced value.
        assert.equal(result.attributes.productType.status, 'ambiguous')
        assert.equal(result.attributes.productType.value, null)
        assert.ok(result.attributes.productType.candidates.includes(expected as 'BODYSUIT' | 'UNDERWEAR' | 'TOP'))
        assert.ok(result.productTypeCandidates!.some(hit => hit.result.candidates.length > 1))
      } else if (field === 'fit' && input === 'واسع') {
        assert.equal(result.attributes.fit.status, 'ambiguous')
        assert.equal(result.attributes.fit.value, null)
        assert.ok(result.attributes.fit.candidates.includes('LOOSE_FIT'))
        assert.ok(result.sourceFitCuts!.leg_cut.candidates.includes('LEG_WIDE'))
      } else if (field === 'quantity' && !/pieces|قطع/u.test(input)) {
        // Quantities v2 retains the alias but requires order evidence for bare number words.
        assert.equal(result.attributes.quantity.value, null)
        assert.ok(result.quantityIntent?.evidence.some(row => row.orderUnits === expected))
        resolved(parseVoiceSaleText(`quantity ${input}`), field, expected)
      } else resolved(result, field, expected)
    })
  }
  for (const sentence of [
    'Bdi Tchirt Ka7le size XXL Tnen pieces law sama7et',
    'Tchirt two pieces navy blue XXL',
    'XXL navy blue two pieces Tchirt',
    'Tchirt T-shirt navy blue navy blue XXL XXL two two pieces',
  ]) {
    test(`order/repetition/Arabizi: ${sentence}`, () => {
      const result = parseVoiceSaleText(sentence)
      assert.equal(result.status, 'parsed')
      resolved(result, 'productType', 'T_SHIRT')
      resolved(result, 'color', 'NAVY_BLUE')
      resolved(result, 'size', 'XXL')
      resolved(result, 'quantity', 2)
      assert.deepEqual(result.unrecognizedTokens, [])
    })
  }
  test('extracts all eight attribute domains without overlapping evidence', () => {
    const result = parseVoiceSaleText('بدي قميص Zara سودا XL قطعتين قطن قبّة مبرومة ضيق سادة')
    // The legacy CREW_NECK value remains compatible; the supplied v2 source
    // explicitly declares ribbed/rolled/crew alternatives for this same phrase.
    assert.equal(result.status, 'needs_clarification')
    assert.equal(result.sourceNecklineShape?.status, 'ambiguous')
    assert.deepEqual(result.necklineCandidates?.flatMap(row => row.result.modifiers), ['TRIM_ROLLED'])
    resolved(result, 'productType', 'SHIRT')
    resolved(result, 'color', 'BLACK')
    resolved(result, 'size', 'XL')
    resolved(result, 'quantity', 2)
    resolved(result, 'material', 'COTTON')
    resolved(result, 'neckline', 'CREW_NECK')
    assert.equal(result.attributes.fit.status, 'ambiguous')
    assert.ok(result.attributes.fit.candidates.includes('SLIM_FIT'))
    assert.deepEqual(result.sourceFitCuts!.fit.candidates, ['FIT_SLIM', 'FIT_SKINNY', 'FIT_FITTED'])
    resolved(result, 'pattern', 'PLAIN')
    assert.deepEqual(result.productNameResidualTokens.map(row => row.token), ['zara'])
    const spans = Object.values(result.attributes).flatMap(field => field.evidence.map(evidence => evidence.span))
      .sort((a, b) => a.startToken - b.startToken)
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i - 1].endToken <= spans[i].startToken)
  })
})

describe('numeric context and quantities', () => {
  for (const input of ['size 32', 'قياس ٣٢', 'مقاس ۳۲', '2iyas ٣۲']) {
    test(`explicit numeric size: ${input}`, () => {
      const result = parseVoiceSaleText(input)
      resolved(result, 'size', '32', 'explicit')
      assert.equal(result.attributes.quantity.status, 'missing')
    })
  }
  for (const input of ['32 pieces', '٣٢ قطعة', '۳۲ pieces', 'quantity 32', 'عدد ٣٢', 'Quantity 32 pieces', 'quantity two pieces', 'two قطعة']) {
    test(`explicit quantity: ${input}`, () => {
      const result = parseVoiceSaleText(input)
      resolved(result, 'quantity', input.startsWith('quantity two') || input.startsWith('two') ? 2 : 32, 'explicit')
      assert.equal(result.attributes.size.status, 'missing')
      assert.deepEqual(result.unrecognizedTokens, [])
    })
  }
  for (const number of ['2', '٢', '۲', '32', '٣٢', '۳۲', '999']) {
    test(`bare ${number} is unresolved, never a quantity or size`, () => {
      const result = parseVoiceSaleText(number)
      assert.equal(result.status, 'needs_clarification')
      assert.equal(result.attributes.quantity.value, null)
      assert.equal(result.attributes.size.value, null)
      assert.ok(result.ambiguities.some(issue => issue.kind === 'unresolved_number'))
      assert.equal(result.unrecognizedTokens.length, 1)
      assert.deepEqual(result.productNameResidualTokens, [])
    })
  }
  for (const input of ['-2 pieces', '−٢ قطعة', '+2 pieces', '1.5 pieces', '1,5 pieces', '١٫٥ قطعة', 'size 32-34', 'size 32–34',
    '－２ pieces', '１．５ pieces', 'size 32—34']) {
    test(`does not extract numbers after punctuation loss: ${input}`, () => {
      const result = parseVoiceSaleText(input)
      assert.equal(result.status, 'needs_clarification')
      assert.equal(result.attributes.quantity.value, null)
      assert.equal(result.attributes.size.value, null)
      assert.ok(result.ambiguities.some(issue => issue.kind === 'unresolved_number'))
    })
  }
  for (const input of ['size two', 'color XL', 'quantity 0', 'quantity 1000001', 'size']) {
    test(`unsupported marker value does not leak into another attribute: ${input}`, () => {
      const result = parseVoiceSaleText(input)
      assert.equal(result.status, 'needs_clarification')
      assert.equal(result.attributes.quantity.value, null)
      assert.equal(result.attributes.size.value, null)
      assert.ok(result.ambiguities.some(issue => issue.kind === 'unsupported_value'))
    })
  }
  test('Quantities v2 supports explicit counts beyond the old 17-value vocabulary', () => {
    resolved(parseVoiceSaleText('quantity 999'), 'quantity', 999)
  })
  // Sizes v2 intentionally makes these formerly unsupported source expressions available.
  for (const input of ['one size', 'one-size', 'قياس واحد']) test(`new one-size language concept is not quantity one: ${input}`, () => {
    const result = parseVoiceSaleText(input)
    assert.equal(result.sourceSizeId?.value, 'SPECIAL_ONE_SIZE')
    assert.equal(result.attributes.size.value, null)
    assert.equal(result.attributes.quantity.value, null)
  })
  test('size 42 is recognized without inventing a legacy ID or region', () => {
    const result = parseVoiceSaleText('size 42')
    assert.equal(result.sourceSizeId?.value, null)
    assert.ok(result.sourceSizeId?.candidates.includes('APPAREL_EU_42'))
    assert.equal(result.attributes.size.value, null)
    assert.equal(result.attributes.quantity.value, null)
  })
  test('missing quantity has no default or inferred one', () => {
    const result = parseVoiceSaleText('Tshirt sawda XL')
    assert.equal(result.status, 'incomplete')
    assert.equal(result.attributes.quantity.status, 'missing')
    assert.equal(result.attributes.quantity.value, null)
    assert.equal(result.attributes.quantity.source, null)
    assert.deepEqual(result.attributes.quantity.evidence, [])
  })
  test('a unit-qualified one followed by size remains a valid quantity', () => {
    const result = parseVoiceSaleText('Tshirt black one piece size XL')
    assert.equal(result.status, 'parsed')
    resolved(result, 'quantity', 1)
    resolved(result, 'size', 'XL')
  })
})

describe('contextual ambiguity and inference', () => {
  for (const [input, affected] of [
    ['Body', ['productType']], ['كنزة', ['productType']], ['كولون', ['productType']],
    ['Polo', ['productType', 'neckline']], ['جينز', ['productType', 'material']], ['مموج', ['pattern']],
  ] as const) {
    test(`preserves unqualified ${input}`, () => {
      const result = parseVoiceSaleText(input)
      assert.equal(result.status, 'needs_clarification')
      for (const field of affected) {
        assert.equal(result.attributes[field].status, 'ambiguous')
        assert.equal(result.attributes[field].value, null)
      }
      assert.ok(result.ambiguities.some(issue => issue.kind === 'lexical_ambiguity'))
    })
  }
  test('explicit domain markers disambiguate only supported dictionary meanings', () => {
    const result = parseVoiceSaleText('product Body collar Polo pattern مموج fabric جينز')
    assert.equal(result.attributes.productType.status, 'ambiguous')
    assert.ok(result.attributes.productType.candidates.includes('BODYSUIT'))
    resolved(result, 'neckline', 'POLO_COLLAR', 'inferred')
    resolved(result, 'pattern', 'WAVY', 'inferred')
    resolved(result, 'material', 'DENIM', 'explicit')
    assert.equal(result.ambiguities.length, 1)
    assert.equal(result.ambiguities[0].span.text, 'body')
    assert.deepEqual(result.unrecognizedTokens, [])
  })
  test('a marker cannot select between several plausible clothing candidates', () => {
    const result = parseVoiceSaleText('product كنزة')
    assert.equal(result.attributes.productType.status, 'ambiguous')
    assert.deepEqual(result.attributes.productType.candidates, ['SWEATER', 'TOP'])
    assert.equal(result.status, 'needs_clarification')
  })
  test('qualified Kenza/Wool alias splits evidence without losing the explicit material', () => {
    const result = parseVoiceSaleText('كنزة صوف سودا XL قطعة')
    resolved(result, 'productType', 'SWEATER', 'inferred')
    resolved(result, 'material', 'WOOL', 'explicit')
    assert.equal(result.status, 'parsed')
    assert.equal(result.attributes.productType.evidence[0].span.endToken,
      result.attributes.material.evidence[0].span.startToken)
  })
  test('does not resolve jeans cross-domain ambiguity from dictionary order or another material', () => {
    const result = parseVoiceSaleText('جينز مخمل')
    assert.equal(result.attributes.productType.value, null)
    assert.equal(result.attributes.material.value, null)
    assert.deepEqual(result.attributes.material.candidates, ['DENIM', 'VELVET'])
  })
  for (const input of ['soda', 'color soda']) {
    test(`uncertain transcription is not corrected automatically: ${input}`, () => {
      const result = parseVoiceSaleText(input)
      assert.equal(result.status, 'needs_clarification')
      assert.ok(result.ambiguities.some(issue => issue.kind === 'uncertain_transcription'))
      assert.equal(result.attributes.color.value, null)
      assert.equal(result.attributes.productType.value, null)
      assert.equal(result.unrecognizedTokens.length, 1)
      if (input === 'color soda') assert.deepEqual(result.productNameResidualTokens, [])
      else assert.equal(result.productNameResidualTokens.length, 1)
    })
  }
  test('a supplied, user-authorized seed spelling is active without fuzzy correction', () => {
    const result = parseVoiceSaleText('جينس')
    resolved(result, 'productType', 'JEANS')
    assert.equal(result.sourceProductType?.value, 'JEANS')
    assert.deepEqual(result.ambiguities, [])
  })
})

describe('conflicts and unsupported multi-item requests', () => {
  for (const [input, field, candidates] of [
    ['Tshirt black white XL two pieces', 'color', ['BLACK', 'WHITE']],
    ['Tshirt black XL XXL two pieces', 'size', ['XL', 'XXL']],
    ['Tshirt black XL one two pieces', 'quantity', [1, 2]],
    ['cotton velvet', 'material', ['COTTON', 'VELVET']],
    ['slim fit loose fit', 'fit', ['SLIM_FIT', 'LOOSE_FIT']],
    ['plain striped', 'pattern', ['PLAIN', 'STRIPED']],
    ['crew neck V neck', 'neckline', ['CREW_NECK', 'V_NECK']],
  ] as const) {
    test(`conflicting ${field} retains all values`, () => {
      const result = parseVoiceSaleText(input)
      assert.equal(result.status, 'needs_clarification')
      assert.equal(result.attributes[field].status, 'conflict')
      assert.equal(result.attributes[field].value, null)
      assert.deepEqual(result.attributes[field].candidates, candidates)
      assert.ok(result.ambiguities.some(issue => issue.kind === 'conflicting_attribute'))
    })
  }
  for (const input of [
    'Tshirt and pants', 'Tshirt pants', 'قميص و فستان', 'تي شيرت وبنطلون', 'pants jeans Tshirt',
    'Tshirt black XL two pieces and pants navy size 32 one piece',
    'Tshirt and Tshirt', 'Tshirt black Tshirt white',
    'Tshirt black XL two pieces and white M one piece', 'كنزة و كولون',
  ]) {
    test(`multiple item status: ${input}`, () => {
      const result = parseVoiceSaleText(input)
      assert.equal(result.status, 'unsupported_multiple_items')
      assert.ok(result.ambiguities.some(issue => issue.kind === 'multiple_items'))
    })
  }
  test('single color conflict with a conjunction does not fabricate multiple items', () => {
    assert.equal(parseVoiceSaleText('Tshirt black and white XL two pieces').status, 'needs_clarification')
  })
  for (const input of ['Tshirt or pants', 'not Tshirt and pants']) {
    test(`non-affirmative multiple products still receive the explicit unsupported status: ${input}`, () => {
      const result = parseVoiceSaleText(input)
      assert.equal(result.status, 'unsupported_multiple_items')
      assert.ok(Object.values(result.attributes).every(attribute => attribute.value === null))
    })
  }
  for (const input of ['not black Tshirt', 'مش سودا', 'بلا مخطط', 'black or white', 'إلغاء Tshirt']) {
    test(`unsupported non-affirmative structure: ${input}`, () => {
      const result = parseVoiceSaleText(input)
      assert.equal(result.status, 'needs_clarification')
      assert.equal(result.attributes.color.value, null)
      assert.equal(result.attributes.productType.value, null)
      assert.ok(result.ambiguities.some(issue => issue.kind === 'unsupported_structure'))
    })
  }
})

describe('unknown words, malformed inputs, and deterministic safety', () => {
  test('keeps unknown name/brand tokens, strips only supported conversational expressions', () => {
    const result = parseVoiceSaleText('بدي T-shirt Cedar Collection سودا XL قطعتين لو سمحت')
    assert.deepEqual(result.productNameResidualTokens.map(row => row.token), ['cedar', 'collection'])
    assert.deepEqual(result.unrecognizedTokens.map(row => row.token), ['cedar', 'collection'])
    assert.deepEqual(result.conversationalTokens.map(row => row.token), ['بدي', 'لو', 'سمحت'])
    assert.equal(result.status, 'parsed')
    assert.ok(!('productId' in result) && !('variantId' in result))
  })
  test('unknown terms do not invent product type or catalog identities', () => {
    const result = parseVoiceSaleText('Astral Garment')
    assert.equal(result.status, 'incomplete')
    assert.equal(result.attributes.productType.status, 'missing')
    assert.deepEqual(result.productNameResidualTokens.map(row => row.token), ['astral', 'garment'])
  })
  test('object prototype names are ordinary residual words, never grammar markers', () => {
    const result = parseVoiceSaleText('constructor prototype __proto__')
    assert.equal(result.status, 'incomplete')
    assert.deepEqual(result.ambiguities, [])
    assert.deepEqual(result.productNameResidualTokens.map(row => row.token), ['constructor', 'prototype', 'proto'])
  })
  for (const input of ['XXLXL', 'XXXLarge', 'AXL', 'blackish', 'Tshirty']) {
    test(`never extracts a clothing alias by substring: ${input}`, () => {
      const result = parseVoiceSaleText(input)
      assert.ok(Object.values(result.attributes).every(attribute => attribute.status === 'missing'))
      assert.equal(result.productNameResidualTokens.length, 1)
    })
  }
  for (const input of ['', '  \t\n ', '!!!', null, undefined, 32, {}, [], 'x'.repeat(MAX_VOICE_SALE_TEXT_LENGTH + 1),
    'Tshirt\u0000black', '\uD800', '\uDC00']) {
    test(`rejects malformed input ${typeof input}/${typeof input === 'string' ? input.length : '-'}`, () => {
      const result = parseVoiceSaleText(input as unknown as string)
      assert.equal(result.status, 'invalid_input')
      assert.ok(Object.values(result.attributes).every(attribute => attribute.value === null))
      assert.ok(result.ambiguities.some(issue => issue.kind === 'invalid_input'))
    })
  }
  test('mixed presentation forms, case, diacritics and full-width sizes normalize consistently', () => {
    const result = parseVoiceSaleText('  بَدّي T-SHIRT سُـودَا ＸＸＸＬ ٢ pieces ')
    assert.equal(result.status, 'parsed')
    resolved(result, 'productType', 'T_SHIRT')
    resolved(result, 'color', 'BLACK')
    resolved(result, 'size', 'XXXL')
    resolved(result, 'quantity', 2)
  })
  test('repeated parsing is deterministic and independent of earlier calls', () => {
    const sentence = 'Tshirt Zara black XL 2 pieces'
    const first = parseVoiceSaleText(sentence)
    parseVoiceSaleText('جينز Polo كنزة')
    assert.deepEqual(parseVoiceSaleText(sentence), first)
    assert.ok(Object.isFrozen(first))
    assert.ok(Object.isFrozen(first.attributes))
    assert.ok(Object.isFrozen(first.attributes.color.candidates))
  })
})
