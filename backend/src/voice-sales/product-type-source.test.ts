import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { productTypeSource, productTypeSourceResource, productTypeSourceAmbiguities, productTypes, normalizeText } from './index.js'
import { validateProductTypeResources } from './product-type-source.js'
import { parseVoiceSaleText } from './parser.js'

describe('Product Types integration resource integrity', () => {
  test('all three original resources retain their supplied bytes', () => {
    for (const [name, expected] of [
      ['seed', 'd089cceacff4fce0c23413053a6091317525d8523254a4ca1489fd9220b3da29'],
      ['ambiguous', 'a207568631b209ea1f393e62febe79977da42ca0df5ac6cf267c0d0d5e939930'],
      ['smoke', '7fc04637d74cd051a4403068b601a9c1c70d8f35feb29a9125f21534c1cd79bd'],
    ]) assert.equal(createHash('sha256').update(readFileSync(new URL(`../../resources/voice-sales/product-types.${name}.json`, import.meta.url))).digest('hex'), expected)
  })
  test('independently expected totals and policies remain intact', () => {
    assert.equal(productTypeSource.coverage.concepts, 343)
    assert.equal(productTypeSource.coverage.aliases, 2909)
    assert.equal(productTypeSource.coverage.sourceCollisionKeys, 55)
    assert.equal(productTypeSourceAmbiguities.ambiguousAliases.length, 55)
    assert.equal(new Set(productTypeSourceResource.productTypes.map(type => type.id)).size, 343)
    assert.equal(productTypeSourceResource.productTypes.flatMap(type => type.aliases).filter(alias => alias.matchPolicy === 'exact_candidate').length, 2799)
    assert.equal(productTypeSourceResource.productTypes.flatMap(type => type.aliases).filter(alias => alias.matchPolicy === 'require_context').length, 110)
    assert.ok(productTypeSourceResource.productTypes.flatMap(type => type.aliases).every(alias => alias.reviewStatus === 'seed_review'))
    assert.equal(productTypeSource.coverage.mappedConcepts, 14)
    assert.equal(productTypeSource.coverage.stagedConcepts, 329)
    assert.equal(productTypes.coverage.canonicalValues, 15)
    assert.equal(productTypes.coverage.trustedAliases, 51)
  })
  test('every original alias record is retained, including blocked and normalized duplicates', () => {
    for (const concept of productTypeSourceResource.productTypes) for (const alias of concept.aliases) {
      const result = productTypeSource.lookup(alias.text)
      const candidate = result.candidates.find(row => row.sourceTypeId === concept.id)
      assert.ok(candidate)
      assert.ok(candidate?.aliases.includes(alias), `${concept.id}: ${alias.text}`)
      assert.equal(result.alias, normalizeText(alias.text))
      assert.ok(Object.isFrozen(candidate))
      assert.ok(Object.isFrozen(candidate.aliases))
    }
    assert.ok(Object.isFrozen(productTypeSourceResource.productTypes[0].aliases[0]))
    assert.throws(() => { (productTypeSourceResource.productTypes as unknown as unknown[]).push({}) }, TypeError)
  })
  test('runtime normalization merges one same-type pair without discarding raw spellings', () => {
    assert.equal(productTypeSource.coverage.changedKeys, 516)
    assert.equal(productTypeSource.coverage.normalizedDuplicatePairs, 1)
    assert.equal(productTypeSource.coverage.runtimeKeys, 2854)
    assert.equal(productTypeSource.coverage.rawRuntimeCollisionKeys, 54)
    assert.equal(productTypeSource.coverage.preservedSourceAmbiguities, 55)
    assert.equal(productTypeSource.coverage.runtimeCollisions.length, 56)
    const leather = productTypeSource.lookup('جاكيت جلد').candidates.find(row => row.sourceTypeId === 'LEATHER_JACKET')!
    assert.deepEqual(leather.aliases.map(alias => alias.text), ['جاكيت جلد', 'جاکيت جلد'])
  })
  for (const mutate of [
    (seed: any) => { seed.productTypes[0].id = 'INVENTED' },
    (seed: any) => { seed.productTypes[0].aliases[0].reviewStatus = 'verified' },
    (seed: any) => { seed.productTypes[0].aliases[0].matchPolicy = 'fuzzy' },
    (seed: any) => { seed.productTypes[0].aliases[0].text = '!!' },
    (seed: any) => { seed.integratePolicy.databaseWrites = true },
    (seed: any) => { seed.productTypes.push(seed.productTypes[0]) },
  ]) test(`malformed resource fails closed: ${mutate.toString()}`, () => {
    const seed: unknown = structuredClone(productTypeSourceResource)
    mutate(seed)
    assert.throws(() => validateProductTypeResources(seed, productTypeSourceAmbiguities), /Invalid packaged/)
  })
  test('invalid ambiguity ID fails closed', () => {
    const ambiguity = structuredClone(productTypeSourceAmbiguities) as any
    ambiguity.ambiguousAliases[0].candidateTypeIds[0] = 'INVENTED'
    assert.throws(() => validateProductTypeResources(productTypeSourceResource, ambiguity), /Invalid packaged/)
  })
})

describe('source collision and cross-domain safety', () => {
  for (const ambiguity of productTypeSourceAmbiguities.ambiguousAliases) {
    test(`all declared candidates survive: ${ambiguity.sourceNormalized}`, () => {
      const aliases = productTypeSourceResource.productTypes.flatMap(concept => concept.aliases)
        .filter(alias => alias.sourceNormalized === ambiguity.sourceNormalized)
      assert.ok(aliases.length)
      for (const alias of aliases) {
        const hit = productTypeSource.lookup(alias.text)
        assert.equal(hit.status, 'ambiguous')
        assert.deepEqual(hit.candidates.map(row => row.sourceTypeId), [...ambiguity.candidateTypeIds].sort((a, b) => a.localeCompare(b, 'en')))
        assert.ok(hit.context.includes(ambiguity))
      }
    })
  }
  for (const alias of ['بدي', 'bdi', 'baddi']) test(`expression overlap ${alias} is retained but blocked`, () => {
    assert.equal(productTypeSource.lookup(alias).status, 'blocked')
    assert.deepEqual(productTypeSource.matchTokens(alias), [])
    assert.equal(parseVoiceSaleText(`${alias} Tchirt black XL two pieces`).attributes.productType.value, 'T_SHIRT')
  })
  test('other cross-domain overlaps stay visible', () => {
    assert.deepEqual(productTypeSource.lookup('Polo').crossDomainOverlaps, ['necklines'])
    assert.deepEqual(productTypeSource.lookup('جينز').crossDomainOverlaps, ['materials'])
    assert.equal(productTypeSource.coverage.crossDomainOverlaps.length, 6)
  })
  test('more precise source IDs are not coerced into a broad existing ID', () => {
    assert.equal(productTypeSource.lookup('baby onesie').candidates[0].canonicalType, null)
    assert.equal(productTypeSource.lookup('robe').candidates.find(row => row.sourceTypeId === 'ROBE_HOME')?.canonicalType, null)
    assert.equal(productTypeSource.lookup('tchirt').candidates[0].canonicalType, 'T_SHIRT')
  })
})

describe('exact source phrase matching and supplied smoke cases', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../resources/voice-sales/product-types.smoke.json', import.meta.url), 'utf8')) as {
    cases: { text: string; expectCandidateTypeIds?: string[]; mustStayAmbiguous?: boolean }[]
  }
  for (const example of fixture.cases.filter(row => row.expectCandidateTypeIds)) test(example.text, () => {
    const hits = productTypeSource.matchTokens(example.text)
    const ids = [...new Set(hits.flatMap(hit => hit.result.candidates.map(row => row.sourceTypeId)))].sort()
    assert.deepEqual(ids, [...example.expectCandidateTypeIds!].sort())
    if (example.mustStayAmbiguous) assert.ok(hits.some(hit => hit.result.status === 'ambiguous'))
  })
  test('whole-token boundaries, French spelling and longest phrases', () => {
    assert.equal(productTypeSource.lookup('CHEMISE').candidates[0].sourceTypeId, 'SHIRT')
    assert.equal(productTypeSource.lookup('chemisesx').status, 'unknown')
    assert.deepEqual(productTypeSource.matchTokens('xtchirt robeish baby onesiex'), [])
    const phrase = productTypeSource.matchTokens('بودي بيبي')[0]
    assert.equal(phrase.endToken, 2)
    assert.deepEqual(phrase.result.candidates.map(row => row.sourceTypeId), ['BABY_ONESIE'])
    assert.equal(productTypeSource.lookup('men').status, 'unknown')
    assert.equal(productTypeSource.lookup('women').status, 'unknown')
  })
  test('the old orange sentence remains a prior fix, never attributed to this seed', () => {
    assert.deepEqual(productTypeSource.matchTokens('t chirt orange kt3ten'), [])
    const attributes = parseVoiceSaleText('t chirt orange kt3ten').attributes
    assert.equal(attributes.productType.value, 'T_SHIRT')
    assert.equal(attributes.color.value, 'ORANGE')
    assert.equal(attributes.quantity.value, 2)
    assert.equal(attributes.size.value, null)
  })
})
