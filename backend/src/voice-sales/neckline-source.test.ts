import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { activeNecklines, necklineSourceResource as seed, necklineSourceCollisions, normalizeText } from './index.js'
import { validateNecklineResources } from './neckline-source.js'
import { parseVoiceSaleText } from './parser.js'
import { matchParsedCatalog } from './catalog-matcher.js'
import type { CatalogVariant } from './match.types.js'

const ids = (p: ReturnType<typeof parseVoiceSaleText>) => p.necklineCandidates?.flatMap(m => [...m.result.shapes, ...m.result.collars, ...m.result.modifiers]) ?? []
const row = (productName: string, changes: Partial<CatalogVariant> = {}): CatalogVariant => ({ productId: 'product', variantId: 'variant', sku: 'TEST-SKU',
  productName, categoryName: 'Clothing', color: 'Black', size: 'XL', sellingPrice: '12.50', availableStock: 40, currency: 'USD', ...changes })
const match = (text: string, variants: CatalogVariant[], truncated = false) => matchParsedCatalog(parseVoiceSaleText(text), { variants, scannedVariants: variants.length, truncated })

describe('Necklines immutable source concepts and exhaustive alias evaluation', () => {
  for (const concept of seed.styles) test(`style ${concept.style_id}`, () => {
    assert.ok(seed.style_aliases.some(r => r.style_id === concept.style_id))
    assert.ok(Object.isFrozen(concept))
    const group = concept.group === 'neckline_shape' ? 'shapes' : 'collars'
    for (const alias of seed.style_aliases.filter(r => r.style_id === concept.style_id && !r.alias.includes('|'))) {
      assert.ok(activeNecklines.lookup(alias.alias)[group].includes(concept.style_id as never))
    }
  })
  for (const [i, alias] of seed.style_aliases.entries()) test(`style alias ${i}: ${alias.alias}`, () => {
    const audit = activeNecklines.audit.find(r => r.domain === 'style' && r.sourceIndex === i)!
    assert.equal(audit.normalized, normalizeText(alias.alias))
    assert.equal(audit.sourceNormalized, alias.normalized_key)
    assert.equal(audit.id, alias.style_id)
    const texts = alias.alias.includes('|') ? alias.alias.split('|') : [alias.alias]
    if (alias.alias.includes('|')) assert.equal(audit.disposition, 'blocked')
    for (const text of texts) {
      const hit = activeNecklines.lookup(text)
      assert.ok([...hit.shapes, ...hit.collars].includes(alias.style_id))
      // Explicit role exercises the existing parser, not an independent standalone engine.
      const parsed = parseVoiceSaleText(`Blouse neckline ${text} black XL two pieces`)
      assert.ok(ids(parsed).includes(alias.style_id), text)
      assert.equal(parsed.attributes.quantity.value, 2)
      assert.equal(parsed.attributes.size.value, 'XL')
    }
  })
  for (const modifier of seed.modifiers) test(`modifier ${modifier.modifier_id}`, () => {
    assert.ok(Object.isFrozen(modifier))
    assert.ok(seed.modifier_aliases.some(a => a.modifier_id === modifier.modifier_id))
  })
  for (const [i, alias] of seed.modifier_aliases.entries()) test(`modifier alias ${i}: ${alias.alias}`, () => {
    const audit = activeNecklines.audit.find(r => r.domain === 'modifier' && r.sourceIndex === i)!
    assert.equal(audit.disposition, 'conditional')
    assert.equal(audit.normalized, normalizeText(alias.alias))
    assert.ok(activeNecklines.lookup(alias.alias).modifiers.includes(alias.modifier_id))
    const p = parseVoiceSaleText(`Blouse neckline ${alias.alias} black XL two pieces`)
    assert.ok(ids(p).includes(alias.modifier_id))
    assert.equal(p.attributes.quantity.value, 2)
  })
  for (const ambiguity of seed.ambiguities) test(`declared ambiguity ${ambiguity.phrase}`, () => {
    const hit = activeNecklines.lookup(ambiguity.phrase)
    assert.equal(hit.status, 'context_required')
    for (const id of ambiguity.candidates.split('|')) assert.ok([...hit.shapes, ...hit.collars, ...hit.modifiers, ...hit.externalRoles].includes(id as never))
    assert.ok(Object.isFrozen(hit))
  })
  test('every record is partitioned and invalid identities/counts/groups are rejected', () => {
    assert.equal(activeNecklines.audit.length, 1041)
    const c = activeNecklines.coverage
    assert.equal(c.styleActive + c.styleConditional + c.styleBlocked, 807)
    assert.equal(c.modifierActive + c.modifierConditional + c.modifierBlocked, 234)
    for (const mutate of [(s: any) => s.styles.pop(), (s: any) => s.styles[0].style_id = 'INVENTED',
      (s: any) => s.style_aliases[0].group = 'collar_type', (s: any) => s.modifier_aliases[0].modifier_id = 'NECK_V',
      (s: any) => s.ambiguities[0].candidates = 'INVENTED']) {
      const copy = structuredClone(seed); mutate(copy)
      assert.throws(() => validateNecklineResources(copy, necklineSourceCollisions), /Invalid packaged/)
    }
  })
})

const smoke = JSON.parse(readFileSync(new URL('../../resources/voice-sales/necklines.smoke.json', import.meta.url), 'utf8'))
describe('Original fixtures and review scenarios use actual project contracts', () => {
  for (const fixture of seed.test_cases) test(fixture.input_text, () => {
    const p = parseVoiceSaleText(fixture.input_text), candidates = ids(p)
    assert.ok(fixture.expected_style_id === 'NONE' ? !candidates.length : candidates.includes(fixture.expected_style_id as never))
    if (fixture.expect_review && fixture.expected_style_id !== 'NONE') assert.equal(p.sourceCollarType?.value, null)
    // Broader source ambiguities take precedence over contradictory source expect_review:false flags.
    if (['NECK_ROUND', 'NECK_HIGH', 'NECK_TURTLE', 'COLLAR_POLO', 'COLLAR_RIBBED'].includes(fixture.expected_style_id)) {
      assert.ok(p.unresolvedInformation.includes('neckline'))
    }
    assert.equal(p.attributes.quantity.value, null)
  })
  for (const scenario of smoke.integration_review_scenarios) test(`review: ${scenario.input}`, () => {
    const p = parseVoiceSaleText(scenario.input)
    assert.equal(match(scenario.input, []).status, 'NOT_FOUND')
    assert.equal(p.attributes.quantity.value, scenario.input.startsWith('two pieces ') || scenario.input.endsWith('قطعتين') ? 2 : null)
    assert.ok(p.necklineCandidates?.every(m => m.startToken < m.endToken))
    if (scenario.input === 'قبة مش عالية') assert.deepEqual(p.necklineCandidates, [])
    if (scenario.expected_style_or_status_for_review === 'AMBIGUOUS') {
      assert.ok(p.necklineCandidates?.some(m => m.result.status === 'context_required'))
    }
  })
})

describe('Neckline boundaries, contradictions, numeric safeguards and name constraints', () => {
  for (const size of ['XL', 'XXL', 'XXXL']) test(`mixed language ${size}`, () => {
    const p = parseVoiceSaleText(`بدي تي شيرت قبة V سودا ${size} قطعتين`)
    assert.equal(p.sourceNecklineShape?.value, 'NECK_V')
    assert.equal(p.attributes.color.value, 'BLACK'); assert.equal(p.attributes.quantity.value, 2)
    assert.equal(p.attributes.size.value, size)
  })
  test('Polo stays product/collar dependent, explicit collar preserves product type', () => {
    assert.equal(parseVoiceSaleText('polo').sourceCollarType?.status, 'ambiguous')
    const p = parseVoiceSaleText('Shirt polo collar black XL two pieces')
    assert.equal(p.sourceProductType?.value, 'SHIRT'); assert.equal(p.sourceCollarType?.value, 'COLLAR_POLO')
    assert.equal(p.productTypeCandidates?.length, 1)
    assert.ok(activeNecklines.lookup('polo').crossDomains.includes('sourceProductTypes'))
  })
  test('normalizer preserves ة, French accents and whole-token boundaries', () => {
    assert.equal(normalizeText('قبّة'), 'قبة')
    assert.notEqual(normalizeText('قبة'), normalizeText('قبه'))
    assert.notEqual(normalizeText('roulé'), normalizeText('roule'))
    assert.equal(activeNecklines.lookup('XXLcrewneck').status, 'unknown')
    assert.deepEqual(activeNecklines.matchTokens('vneckish'), [])
    assert.equal(activeNecklines.lookup('POLO COLLAR').status, activeNecklines.lookup('polo collar').status)
  })
  for (const text of ['Shirt v neck crew neck', 'Shirt neckline deep shallow']) test(`conflict: ${text}`, () => {
    assert.ok(parseVoiceSaleText(text).ambiguities.some(i => i.kind === 'conflicting_attribute'))
  })
  for (const text of ['not Shirt v neck', 'Shirt قبة مش عالية']) test(`negative: ${text}`, () => {
    const p = parseVoiceSaleText(text); assert.deepEqual(p.necklineCandidates, []); assert.equal(p.attributes.quantity.value, null)
  })
  test('collarless is qualified evidence, not dropped negation', () => {
    const p = parseVoiceSaleText('Shirt بدون قبة black XL two pieces')
    assert.ok(ids(p).includes('COLLAR_NO')); assert.ok(ids(p).includes('NECK_ROUND'))
    assert.equal(p.sourceCollarType?.value, null); assert.equal(p.attributes.quantity.value, 2)
  })
  test('a connected ambiguous roll cannot be ignored as an identical literal catalog word', () => {
    const text = 'Shirt قبة V ورول black XL two pieces'
    const p = parseVoiceSaleText(text)
    assert.ok(p.necklineCandidates?.some(m => m.text === 'ورول' && m.constrainsCatalog))
    assert.notEqual(match(text, [row('Shirt V neck ورول')]).status, 'MATCHED')
  })
  test('full fit/material descriptors retain their own role next to a neckline', () => {
    const p = parseVoiceSaleText('Shirt crew neck loose fit black XL two pieces')
    assert.equal(p.attributes.fit.value, 'LOOSE_FIT')
    assert.ok(p.necklineCandidates?.filter(m => m.text === 'loose').every(m => !m.constrainsCatalog))
    assert.equal(parseVoiceSaleText('Shirt v neck size 32 two pieces').attributes.quantity.value, 2)
  })
  test('size 32, quantity 32, two-piece set and numeric neckline metadata remain separate', () => {
    assert.equal(parseVoiceSaleText('Shirt v neck size 32 two pieces').attributes.size.value, '32')
    assert.equal(parseVoiceSaleText('Shirt v neck XL 32 pieces').attributes.quantity.value, 32)
    assert.equal(parseVoiceSaleText('two-piece set v neck XL').attributes.quantity.value, null)
    assert.equal(parseVoiceSaleText('Shirt neckline 1/4 zip XL two pieces').attributes.quantity.value, 2)
  })
  test('unknown model terms are never removed by matching descriptors', () => {
    assert.equal(match('Shirt Cedar v neck black XL two pieces', [row('Shirt Cedar v neck')]).status, 'MATCHED')
    assert.equal(match('Shirt UnknownBrand v neck black XL two pieces', [row('Shirt Cedar v neck')]).status, 'NOT_FOUND')
    assert.equal(match('Shirt model high black XL two pieces', [row('Shirt AnotherBrand')]).status, 'NOT_FOUND')
  })
})

describe('Actual catalog-name proof, never invented columns or arbitrary selections', () => {
  const text = 'Shirt mandarin collar black XL two pieces'
  test('qualified aliases match independent actual name', () => {
    const r = match(text, [row('Shirt col Claudine'), row('Shirt Mandarin collar', { variantId: 'mandarin' })])
    assert.equal(r.status, 'MATCHED'); assert.equal(r.match?.variantId, 'mandarin')
    assert.ok(r.match?.evidence.some(e => e.requested === 'COLLAR_MANDARIN' && e.source === 'product_name'))
  })
  test('missing property and category alone cannot prove a style', () => {
    assert.equal(match(text, [row('Shirt')]).status, 'INCOMPLETE')
    assert.equal(match(text, [row('Shirt', { categoryName: 'Mandarin collar' })]).status, 'INCOMPLETE')
  })
  test('same ambiguous label in both sentence and catalog remains unresolved', () => {
    const r = match('Shirt قبة عالية black XL two pieces', [row('Shirt قبة عالية')])
    assert.equal(r.status, 'INCOMPLETE'); assert.ok(r.missingFields.includes('neckline'))
  })
  test('one unambiguous actual descriptor can resolve an ambiguous spoken shape', () => {
    const r = match('Shirt قبة عالية black XL two pieces', [row('Shirt funnel neck')])
    assert.equal(r.status, 'MATCHED'); assert.ok(r.match?.evidence.some(e => e.requested === 'NECK_FUNNEL'))
  })
  test('two independent meanings remain ambiguous despite different price and stock', () => {
    assert.equal(match('Shirt قبة عالية black XL two pieces', [row('Shirt funnel neck', { availableStock: 0 }),
      row('Shirt high neckline', { variantId: 'other', sellingPrice: '99.00' })]).status, 'AMBIGUOUS')
  })
  test('explicit modifier requires independent same-domain evidence', () => {
    assert.equal(match('Blouse neckline deep black XL two pieces', [row('Blouse neckline deep')]).status, 'MATCHED')
    assert.equal(match('Blouse neckline deep black XL two pieces', [row('Blouse')]).status, 'INCOMPLETE')
  })
  for (const cue of ['collar', 'encolure', '2abbe']) test(`modifier role marker is consistent in the real label: ${cue}`, () => {
    assert.equal(match('Blouse neckline deep black XL two pieces', [row(`Blouse ${cue} deep`)]).status, 'MATCHED')
  })
  test('empty/duplicate/null price/stock/truncated catalog remain protected', () => {
    assert.equal(match(text, []).status, 'NOT_FOUND')
    assert.equal(match(text, [row('Shirt mandarin collar'), row('Shirt mandarin collar', { variantId: 'another' })]).status, 'AMBIGUOUS')
    assert.equal(match(text, [row('Shirt mandarin collar', { sellingPrice: null })]).status, 'INCOMPLETE')
    assert.equal(match(text, [row('Shirt mandarin collar', { availableStock: 0 })]).status, 'INSUFFICIENT_STOCK')
    assert.equal(match(text, [row('Shirt mandarin collar')], true).status, 'INCOMPLETE')
  })
})
