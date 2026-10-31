import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  colors, createDictionary, dictionaries, DictionaryAliasError, expressions, fits,
  getDictionaryCoverage, lookupVocabulary, matchVocabularyTokens, materials,
  necklines, patterns, productTypes, quantities, sizes,
} from './index.js'
import type { DictionaryDomain, DomainValues } from './index.js'

type Cases = { [D in DictionaryDomain]: readonly (readonly [string, DomainValues[D]])[] }
// Independently specified canonical examples: every supported canonical value is exercised.
const cases: Cases = {
  colors: [
    ['Sawda', 'BLACK'], ['سودا', 'BLACK'], ['أسود', 'BLACK'], ['اسود', 'BLACK'],
    ['Bayda', 'WHITE'], ['أبيض', 'WHITE'], ['Kahle', 'NAVY_BLUE'], ['كحلية', 'NAVY_BLUE'],
    ['Zayte', 'OLIVE_GREEN'], ['زيتية', 'OLIVE_GREEN'], ['Khadra', 'GREEN'], ['أخضر', 'GREEN'],
    ['Hamra', 'RED'], ['حمرا', 'RED'], ['أزرق', 'BLUE'], ['رمادي', 'GREY'],
    ['بيج', 'BEIGE'], ['بني', 'BROWN'], ['زهري', 'PINK'], ['أصفر', 'YELLOW'],
    ['Ka7le', 'NAVY_BLUE'], ['7amra', 'RED'], ['A5dar', 'GREEN'],
    ['Orange', 'ORANGE'], ['برتقالي', 'ORANGE'], ['برتقالية', 'ORANGE'],
  ],
  productTypes: [
    ['T-shirt', 'T_SHIRT'], ['تي شيرت', 'T_SHIRT'], ['Tshirt', 'T_SHIRT'], ['Tchirt', 'T_SHIRT'],
    ['t chirt', 'T_SHIRT'],
    ['Jeans', 'JEANS'], ['جينز', 'JEANS'], ['بنطلون جينز', 'JEANS'],
    ['بنطلون', 'PANTS'], ['Bodysuit', 'BODYSUIT'], ['بودي', 'BODYSUIT'],
    ['Sweater', 'SWEATER'], ['فستان', 'DRESS'], ['Leggings', 'LEGGINGS'],
    ['Tights', 'TIGHTS'], ['كيلوت', 'UNDERWEAR'], ['سوتيان', 'BRA'],
    ['هودي', 'HOODIE'], ['جاكيت', 'JACKET'], ['قميص', 'SHIRT'],
    ['2amis', 'SHIRT'], ['Top', 'TOP'], ['Polo Shirt', 'POLO_SHIRT'],
  ],
  sizes: [
    ['XS', 'XS'], ['S', 'S'], ['M', 'M'], ['L', 'L'], ['XL', 'XL'], ['XXL', 'XXL'], ['XXXL', 'XXXL'],
    ['Extra Large', 'XL'], ['إكس لارج', 'XL'], ['اكس لارج', 'XL'],
    ['Double XL', 'XXL'], ['دبل إكس لارج', 'XXL'], ['3XL', 'XXXL'],
    ['size 28', '28'], ['size 30', '30'], ['size 32', '32'], ['size 34', '34'],
    ['size 36', '36'], ['size 38', '38'], ['size 40', '40'], ['مقاس ٣٢', '32'],
  ],
  materials: [
    ['Velvet', 'VELVET'], ['مخمل', 'VELVET'], ['قطن', 'COTTON'], ['2oton', 'COTTON'],
    ['Denim', 'DENIM'], ['جينز', 'DENIM'], ['صوف', 'WOOL'], ['كتان', 'LINEN'], ['جلد', 'LEATHER'],
  ],
  necklines: [
    ['Polo Collar', 'POLO_COLLAR'], ['قبّة Polo', 'POLO_COLLAR'],
    ['Crew Neck', 'CREW_NECK'], ['قبّة مبرومة', 'CREW_NECK'],
    ['V-Neck', 'V_NECK'], ['قبّة V', 'V_NECK'], ['2abbet Polo', 'POLO_COLLAR'],
  ],
  fits: [
    ['Slim Fit', 'SLIM_FIT'], ['عالجسم', 'SLIM_FIT'], ['ضيق', 'SLIM_FIT'],
    ['عادي', 'REGULAR_FIT'], ['أوفر سايز', 'OVERSIZED'], ['واسع', 'LOOSE_FIT'], ['3al jesem', 'SLIM_FIT'],
  ],
  patterns: [
    ['Plain', 'PLAIN'], ['سادة', 'PLAIN'], ['مخطط', 'STRIPED'],
    ['مربعات', 'CHECKERED'], ['Wavy Pattern', 'WAVY'], ['Sede', 'PLAIN'],
  ],
  quantities: [
    ['One', 1], ['واحد', 1], ['قطعة', 1], ['Two', 2], ['اتنين', 2], ['قطعتين', 2],
    ['Three', 3], ['تلاتة', 3], ['ثلاث قطع', 3], ['أربعة', 4], ['خمسة', 5], ['ستة', 6],
    ['سبعة', 7], ['تمانية', 8], ['تسعة', 9], ['عشرة', 10], ['Tna3sh', 12], ['عشرين', 20],
    ['24 pieces', 24], ['Thirty', 30], ['32 pieces', 32], ['خمسين', 50], ['مية', 100],
    ['2 pieces', 2], ['٢ قطع', 2], ['٣٢ قطعة', 32], ['٣۲ pieces', 32], ['Wa7ad', 1],
    ['kt3ten', 2],
  ],
  expressions: [
    ['Sell', 'SALE'], ['بيّع', 'SALE'], ['I want', 'WANT'], ['بدي', 'WANT'],
    ['Size', 'SIZE_MARKER'], ['Color', 'COLOR_MARKER'], ['Quantity', 'QUANTITY_MARKER'],
    ['لو سمحت', 'PLEASE'], ['أكيد', 'CONFIRM'], ['إلغاء', 'CANCEL'], ['Bi3', 'SALE'],
  ],
}

describe('Lebanese orange T-shirt vocabulary regression', () => {
  test('the exact reproduction uses three whole lexical spans, longest phrase first', () => {
    const spans = matchVocabularyTokens('t chirt orange kt3ten')
    assert.deepEqual(spans.map(row => [row.phrase, row.startToken, row.endToken]), [
      ['t chirt', 0, 2], ['orange', 2, 3], ['kt3ten', 3, 4],
    ])
    assert.deepEqual(spans.map(row => row.result.hits.map(hit => hit.domain)), [['productTypes'], ['colors'], ['quantities']])
  })
  test('case, whitespace, Arabic diacritics and attached Arabizi digits share normalization', () => {
    assert.equal(productTypes.lookup('  T   CHIRT ').status, 'matched')
    assert.deepEqual(colors.lookup('بُرْتُقَالِيّ'), colors.lookup('برتقالي'))
    assert.deepEqual(colors.lookup('ORANGE'), colors.lookup('orange'))
    assert.deepEqual(quantities.lookup('KT٣TEN'), quantities.lookup('kt3ten'))
  })
  test('new aliases do not permit substring matching or numeric quantity guessing', () => {
    for (const alias of ['orangeish', 'darkorange', 'orange juice']) assert.equal(colors.lookup(alias).status, 'unknown')
    for (const alias of ['kt3tenx', 'xkt3ten', '3', '32']) assert.equal(quantities.lookup(alias).status, 'unknown')
    assert.equal(productTypes.lookup('t chirted').status, 'unknown')
    assert.deepEqual(matchVocabularyTokens('t chirted orangeish kt3tenx'), [])
  })
})

for (const domain of Object.keys(cases) as DictionaryDomain[]) {
  describe(`dictionary domain: ${domain}`, () => {
    for (const [alias, expected] of cases[domain]) {
      test(`${alias} resolves to ${expected}`, () => {
        const result = dictionaries[domain].lookup(alias)
        assert.equal(result.status, 'matched')
        if (result.status === 'matched') assert.equal(result.value, expected)
        assert.equal(result.domain, domain)
      })
    }
    test('has independently tested examples for every canonical value', () => {
      assert.equal(new Set(cases[domain].map(([, value]) => value)).size,
        dictionaries[domain].coverage.canonicalValues)
    })
    test('does not guess unknown terminology', () => {
      assert.equal(dictionaries[domain].lookup('unknown clothing xyz').status, 'unknown')
      assert.equal(dictionaries[domain].lookup('').status, 'unknown')
    })
  })
}

describe('lexical ambiguity and quantity safety', () => {
  for (const [dictionary, alias, candidates] of [
    [productTypes, 'Body', ['BODYSUIT']],
    [productTypes, 'كنزة', ['SWEATER', 'TOP']],
    [productTypes, 'كولون', ['LEGGINGS', 'TIGHTS']],
    [productTypes, 'Polo', ['POLO_SHIRT']],
    [necklines, 'Polo', ['POLO_COLLAR']],
    [patterns, 'مموج', ['WAVY']],
    [patterns, 'Wavy', ['WAVY']],
    [sizes, '32', ['32']],
  ] as const) {
    test(`${dictionary.domain}: ${alias} requires context`, () => {
      const result = dictionary.lookup(alias)
      assert.equal(result.status, 'ambiguous')
      assert.ok(!('value' in result), 'ambiguous results must not expose a selected value')
      if (result.status === 'ambiguous') {
        assert.deepEqual(result.candidates, candidates)
        assert.ok(result.reason)
      }
    })
  }
  test('retains Jeans/Denim and product/collar alternatives across domains', () => {
    for (const [alias, domains] of [
      ['جينز', ['productTypes', 'materials']], ['Polo', ['productTypes', 'necklines']],
    ] as const) {
      const result = lookupVocabulary(alias)
      assert.equal(result.status, 'ambiguous')
      assert.deepEqual(result.hits.map(hit => hit.domain), domains)
    }
  })
  test('never interprets unqualified numeric values as quantity', () => {
    for (const number of ['1', '2', '32', '٣٢', '۳۲', '999']) {
      assert.equal(quantities.lookup(number).status, 'unknown')
      assert.deepEqual(quantities.matchTokens(number), [])
    }
    assert.deepEqual(quantities.matchTokens('size 32'), [])
    assert.equal(sizes.lookup('32 pieces').status, 'unknown')
    assert.equal(lookupVocabulary('32').status, 'ambiguous')
    assert.equal(lookupVocabulary('999').status, 'unknown')
    assert.deepEqual(matchVocabularyTokens('size 32 and 32 pieces').map(span => span.result.hits.map(hit => hit.domain)),
      [['sizes'], ['quantities']])
  })
  test('possible transcription mistakes remain untrusted suggestions', () => {
    for (const [dictionary, alias] of [[colors, 'soda'], [productTypes, 'جينس']] as const) {
      const result = dictionary.lookup(alias)
      assert.equal(result.status, 'suggestion')
      assert.ok(!('value' in result))
      assert.equal(dictionary.matchTokens(alias)[0].result.status, 'suggestion')
      assert.equal(lookupVocabulary(alias).status, 'suggestion')
    }
  })
})

describe('exact and longest-first matching', () => {
  test('case-insensitive exact lookup and no substring fallback', () => {
    assert.deepEqual(colors.lookup('  sAwDa '), colors.lookup('Sawda'))
    for (const input of ['darkblack', 'blackish', 'black white']) assert.equal(colors.lookup(input).status, 'unknown')
    for (const input of ['XXXLarge', 'XXLXL', 'AXL', 'XL2']) assert.equal(sizes.lookup(input).status, 'unknown')
    const result = sizes.matchTokens('XL/XXL XXXL AXL XXXLarge')
    assert.deepEqual(result.map(span => span.result.status === 'matched' ? span.result.value : null), ['XL', 'XXL', 'XXXL'])
  })
  test('longest phrases win with documented half-open token offsets', () => {
    const result = productTypes.matchTokens('بدي بنطلون جينز و تي شيرت')
    assert.deepEqual(result.map(span => [span.startToken, span.endToken, span.phrase,
      span.result.status === 'matched' ? span.result.value : null]),
    [[1, 3, 'بنطلون جينز', 'JEANS'], [4, 6, 'تي شيرت', 'T_SHIRT']])
    assert.deepEqual(colors.matchTokens('navy blue blue').map(span => span.phrase), ['navy blue', 'blue'])
    assert.deepEqual(sizes.matchTokens('Double XL XL').map(span => span.phrase), ['double xl', 'xl'])
    assert.deepEqual(quantities.matchTokens('one hundred one').map(span =>
      span.result.status === 'matched' ? span.result.value : null), [100, 1])
  })
  test('mixed Arabic/English phrases retain qualified collar and numeric size', () => {
    const spans = matchVocabularyTokens('بدي تي شيرت سودا قبّة Polo size ٣٢ لو سمحت')
    assert.deepEqual(spans.map(span => span.phrase), ['بدي', 'تي شيرت', 'سودا', 'قبة polo', 'size 32', 'لو سمحت'])
    assert.ok(spans.every(span => span.result.status === 'matched'))
  })
  test('preserves lexical ambiguity inside sentences', () => {
    const spans = matchVocabularyTokens('Body كنزة كولون جينز مموج 32')
    assert.equal(spans.length, 6)
    assert.ok(spans.every(span => span.result.status === 'ambiguous'))
  })
  test('unknown terminology is not synthesized into a product', () => {
    assert.equal(lookupVocabulary('space garment xyz').status, 'unknown')
    assert.deepEqual(matchVocabularyTokens('space garment xyz'), [])
  })
})

describe('dictionary integrity and extension', () => {
  test('rejects normalized duplicates even when canonical values agree', () => {
    assert.throws(() => createDictionary({ domain: 'colors', entries: [
      { value: 'BLACK', aliases: ['أسود', 'اسود'] },
    ] }), (error: unknown) => error instanceof DictionaryAliasError && error.kind === 'duplicate')
  })
  test('rejects conflicting aliases instead of choosing first or last', () => {
    assert.throws(() => createDictionary({ domain: 'colors', entries: [
      { value: 'BLACK', aliases: ['Same'] }, { value: 'WHITE', aliases: [' SAME '] },
    ] }), (error: unknown) => error instanceof DictionaryAliasError && error.kind === 'conflict')
  })
  test('trusted, contextual and suggestion alias namespaces cannot collide', () => {
    for (const category of ['contextual', 'suggestions'] as const) {
      assert.throws(() => createDictionary({ domain: 'colors',
        entries: [{ value: 'BLACK', aliases: ['Black'] }],
        [category]: [{ aliases: ['BLACK'], candidates: ['BLACK'], reason: 'context' }],
      }), DictionaryAliasError)
    }
  })
  test('rejects incomplete definitions and undeclared candidates', () => {
    assert.throws(() => createDictionary({ domain: 'colors', entries: [{ value: 'BLACK', aliases: ['---'] }] }), /Empty normalized alias/)
    assert.throws(() => createDictionary({ domain: 'colors', entries: [{ value: 'BLACK', aliases: [] }] }), /Empty aliases/)
    assert.throws(() => createDictionary({ domain: 'colors', entries: [
      { value: 'BLACK', aliases: ['black'] }, { value: 'BLACK', aliases: ['sawda'] },
    ] }), /Duplicate canonical value/)
    assert.throws(() => createDictionary({ domain: 'colors', entries: [{ value: 'BLACK', aliases: ['black'] }],
      contextual: [{ aliases: ['maybe'], candidates: ['WHITE'], reason: 'context' }],
    }), /Invalid ambiguous candidates/)
  })
  test('cross-domain collisions remain legal and visible', () => {
    assert.equal(productTypes.lookup('جينز').status, 'matched')
    assert.equal(materials.lookup('جينز').status, 'matched')
    assert.equal(lookupVocabulary('جينز').status, 'ambiguous')
  })
  test('lookup results and coverage cannot mutate the shared dictionary', () => {
    assert.ok(Object.isFrozen(productTypes.lookup('Body')))
    const result = productTypes.lookup('Body')
    if (result.status === 'ambiguous') assert.ok(Object.isFrozen(result.candidates))
    assert.ok(Object.isFrozen(dictionaries))
    assert.ok(Object.isFrozen(getDictionaryCoverage()))
    assert.ok(getDictionaryCoverage().every(row => Object.isFrozen(row)))
  })
  test('registered metadata is copied rather than held by reference', () => {
    const candidates: ('BLACK' | 'WHITE')[] = ['BLACK']
    const dictionary = createDictionary({ domain: 'colors', entries: [{ value: 'BLACK', aliases: ['black'] }],
      contextual: [{ aliases: ['maybe'], candidates, reason: 'context' }],
    })
    candidates.push('WHITE')
    const result = dictionary.lookup('maybe')
    if (result.status === 'ambiguous') assert.deepEqual(result.candidates, ['BLACK'])
    else assert.fail('Expected ambiguity')
  })
})
