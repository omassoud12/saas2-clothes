import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { apiRequest } from '../../lib/api-client.js'
import { getAppNavigation, resolveAppRoute } from '../../app/app-navigation.js'
import { ROUTES } from '../../app/routes.js'
import { canUseMatchingLab, createTextMatchingController, normalizeMatchResult, requestTextMatch, validateMatchText } from './text-matching-flow.js'
import { activeProfile, jsonResponse, matchFixture, sessionClient } from './testing/match-fixtures.js'
import { fitCutIdsByAxis } from './fit-cut-concepts.js'

const multiFixture = () => {
  const aggregate = matchFixture('INCOMPLETE')
  aggregate.reason = 'MULTIPLE_ITEMS_REQUIRE_INDEPENDENT_CONFIRMATION'
  aggregate.items = [matchFixture('MATCHED'), matchFixture('INSUFFICIENT_STOCK')].map((result, index) => ({
    index, segment: { text: index ? 'بنطلون polo' : 't shirt zara لونه اسود',
      removedConversationalExpressions: index ? ['يا كبير'] : ['لونه'], private: 'PRIVATE' }, result,
  }))
  aggregate.segmentation = { status: 'segmented', normalizedText: 'multi item sentence',
    reason: 'REPEATED_EXPLICIT_REQUEST_MARKERS', removedConversationalExpressions: ['لونه', 'يا كبير'], private: 'PRIVATE' }
  aggregate.catalog.candidateCount = 2
  return aggregate
}

describe('multi-item response projection', () => {
  test('projects bounded independent results and strips extra fields', () => {
    const projected = normalizeMatchResult(multiFixture())
    assert.equal(projected.ok, true); assert.equal(projected.result.items.length, 2)
    assert.equal(projected.result.items[0].result.status, 'MATCHED')
    assert.equal(projected.result.items[1].result.status, 'INSUFFICIENT_STOCK')
    assert.deepEqual(projected.result.segmentation.removedConversationalExpressions, ['لونه', 'يا كبير'])
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|private/u)
  })
  test('rejects malformed indexes, unbounded items and nested multi-item payloads', () => {
    const badIndex = multiFixture(); badIndex.items[1].index = 4
    assert.equal(normalizeMatchResult(badIndex).ok, false)
    const tooMany = multiFixture(); tooMany.items = Array.from({ length: 9 }, (_, index) => ({ ...tooMany.items[0], index }))
    assert.equal(normalizeMatchResult(tooMany).ok, false)
    const nested = multiFixture(); nested.items[0].result.items = multiFixture().items; nested.items[0].result.segmentation = multiFixture().segmentation
    assert.equal(normalizeMatchResult(nested).ok, false)
  })
  test('accepts the bounded conjunction segmentation reason', () => {
    const raw = multiFixture()
    raw.segmentation.reason = 'CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE'
    raw.items[0].segment.text = 'polo زرقاء'
    raw.items[1].segment.text = 'بنطلون اسود'
    const projected = normalizeMatchResult(raw)
    assert.equal(projected.ok, true)
    assert.equal(projected.result.segmentation.reason, 'CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE')
    assert.deepEqual(projected.result.items.map(item => item.segment.text), ['polo زرقاء', 'بنطلون اسود'])
  })
})

describe('Patterns & Prints response allowlist and compatibility',()=>{
  const cue=()=>({text:'leopard print',startToken:1,endToken:3,role:'descriptor',polarity:'affirmative',constrainsCatalog:true,modifierTarget:null,
    result:{status:'matched',patterns:['ANIMAL_LEOPARD'],modifiers:[],records:['PRIVATE'],crossDomains:['PRIVATE']}})
  test('optional evidence preserves IDs but strips internal diagnostics',()=>{
    const raw=matchFixture('INCOMPLETE');raw.parser.patternCandidates=[cue()]
    const result=normalizeMatchResult(raw);assert.equal(result.ok,true);assert.deepEqual(result.result.parser.patternCandidates[0].patterns,['ANIMAL_LEOPARD']);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|records|crossDomains/u)
    assert.equal(normalizeMatchResult(matchFixture('MATCHED')).ok,true)
  })
  test('invalid IDs, roles, polarity and targets fail closed',()=>{
    for(const mutate of [r=>r.result.patterns=['INVENTED'],r=>r.result.patterns=Array(170).fill('ANIMAL_LEOPARD'),r=>r.result.modifiers=['UNKNOWN'],r=>r.role='sale',r=>r.polarity='negated',r=>r.modifierTarget={startToken:4,endToken:1,text:'bad'}]){
      const raw=matchFixture('INCOMPLETE'),row=cue();mutate(row);raw.parser.patternCandidates=[row];assert.equal(normalizeMatchResult(raw).ok,false)
    }
  })
  test('negative evidence cannot accompany a claimed complete match',()=>{const raw=matchFixture('MATCHED'),row=cue();row.polarity='negated';row.constrainsCatalog=false;raw.parser.patternCandidates=[row];assert.equal(normalizeMatchResult(raw).ok,false)})
})

describe('Fits & Cuts allowlist, axes and compatibility', () => {
  const cue = () => ({text: 'wide leg', startToken: 1, endToken: 3, role: 'descriptor', polarity: 'affirmative',
    constrainsCatalog: true, modifierTarget: null, result: {status: 'context_required', styles: ['LEG_WIDE'], modifiers: [],
      records: ['PRIVATE'], crossDomains: ['PRIVATE']}})
  test('new evidence retains identity, role and polarity while private resource fields are dropped', () => {
    const raw = matchFixture('INCOMPLETE'); raw.parser.fitCutCandidates = [cue()]
    const result = normalizeMatchResult(raw)
    assert.equal(result.ok, true)
    assert.deepEqual(result.result.parser.fitCutCandidates[0].styles, ['LEG_WIDE'])
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|records|crossDomains/u)
    assert.equal(normalizeMatchResult(matchFixture('MATCHED')).ok, true)
  })
  test('malformed IDs, role, polarity, targets and contradictory authority fail closed', () => {
    for (const mutate of [r => r.result.styles = ['FIT_UNKNOWN'], r => r.result.styles = Array(145).fill('LEG_WIDE'),
      r => r.role = 'command', r => r.polarity = 'uncertain', r => r.modifierTarget = {startToken: 2, endToken: 1, text: 'bad'},
      r => r.polarity = 'negated', r => r.result.modifiers = ['MOD_CHECKOUT']]) {
      const raw = matchFixture('INCOMPLETE'); raw.parser.fitCutCandidates = [cue()]; mutate(raw.parser.fitCutCandidates[0])
      assert.equal(normalizeMatchResult(raw).ok, false)
    }
  })
  test('axis-specific allowlists cannot mix sizes, leg geometry or fit IDs', () => {
    const raw=matchFixture('INCOMPLETE')
    raw.parser.sourceFitCuts=Object.fromEntries(Object.keys(fitCutIdsByAxis).map(axis=>[axis,{status:'missing',value:null,candidates:[],source:null,evidence:[]}]))
    raw.parser.sourceFitCuts.leg_cut={status:'resolved',value:'LEG_WIDE',candidates:['LEG_WIDE'],source:'explicit',evidence:[]}
    assert.equal(normalizeMatchResult(raw).result.parser.sourceFitCuts.leg_cut.value,'LEG_WIDE')
    for (const id of ['XL','FIT_LOOSE','LEG_UNKNOWN']) {
      raw.parser.sourceFitCuts.leg_cut.value=id;raw.parser.sourceFitCuts.leg_cut.candidates=[id]
      assert.equal(normalizeMatchResult(raw).ok,false)
    }
  })
  test('negated style evidence cannot carry a confirmed match', () => {
    const raw=matchFixture('MATCHED');const row=cue();row.polarity='negated';row.constrainsCatalog=false
    raw.parser.fitCutCandidates=[row]
    assert.equal(normalizeMatchResult(raw).ok,false)
  })
})

describe('Common expression advisory projection and sale safety', () => {
  const cue = () => ({ span: { text: 'غيرلي اللون', startToken: 0, endToken: 2 },
    candidates: ['CHANGE_COLOR', 'PREF_OTHER_COLOR'], categories: ['ORDER_CHANGE', 'PREFERENCE'],
    status: 'context_required', role: 'intent', polarity: 'uncertain', recognitionOnly: true,
    authorizesAction: false, provenance: 'seed_unvalidated', privateCost: 'PRIVATE', records: ['PRIVATE'] })
  const withIntents = (status = 'INCOMPLETE') => {
    const raw = matchFixture(status)
    raw.parser.commonExpressionMatches = [cue()]
    raw.parser.commonExpressionSafety = { salePreviewAllowed: false, reason: 'INTENT_REQUIRES_CONTEXT',
      recognitionOnly: true, authorizesAction: false, secret: 'PRIVATE' }
    return raw
  }
  test('preserves IDs, ambiguity, token spans and seed status but drops resource/private fields', () => {
    const result = normalizeMatchResult(withIntents())
    assert.equal(result.ok, true)
    assert.deepEqual(result.result.parser.commonExpressionMatches[0].candidates, ['CHANGE_COLOR', 'PREF_OTHER_COLOR'])
    assert.equal(result.result.parser.commonExpressionSafety.salePreviewAllowed, false)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|privateCost|secret|records/u)
  })
  test('malformed IDs/spans/categories, claimed authority and unbounded candidates fail closed', () => {
    for (const mutate of [r => r.authorizesAction = true, r => r.recognitionOnly = false,
      r => r.candidates = Array(142).fill('CHANGE_COLOR'), r => r.candidates = ['<bad>'],
      r => r.categories = ['UNSUPPORTED'], r => r.span.endToken = 0, r => r.provenance = 'verified']) {
      const raw = withIntents(); mutate(raw.parser.commonExpressionMatches[0])
      assert.equal(normalizeMatchResult(raw).ok, false)
    }
  })
  test('non-sale/uncertain intentions cannot carry a confirmed match and old responses remain compatible', () => {
    assert.equal(normalizeMatchResult(withIntents('MATCHED')).ok, false)
    assert.equal(normalizeMatchResult(matchFixture('MATCHED')).ok, true)
    const inconsistent = withIntents(); inconsistent.parser.commonExpressionSafety.salePreviewAllowed = true
    assert.equal(normalizeMatchResult(inconsistent).ok, false)
    inconsistent.parser.commonExpressionSafety.reason = 'AFFIRMATIVE_OR_ATTRIBUTE_TEXT'
    assert.equal(normalizeMatchResult(inconsistent).ok, false)
  })
})

describe('Neckline shape, collar and modifier additive projection', () => {
  const candidate = () => ({ text: 'قبة عالية', startToken: 1, endToken: 3, constrainsCatalog: true, domainExplicit: true,
    result: { status: 'context_required', shapes: ['NECK_HIGH', 'NECK_MOCK'], collars: [], modifiers: ['HEIGHT_HIGH'],
      externalRoles: [], records: [{ privateCost: 'PRIVATE' }], ambiguities: [{ internal: 'PRIVATE' }] } })
  test('separate typed concepts and bounded alternatives survive; raw resource/private data is excluded', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceNecklineShape = { status: 'ambiguous', value: null, candidates: ['NECK_HIGH', 'NECK_MOCK'], source: null, evidence: [] }
    raw.parser.sourceCollarType = { status: 'missing', value: null, candidates: [], source: null, evidence: [] }
    raw.parser.necklineCandidates = [candidate()]
    const projected = normalizeMatchResult(raw)
    assert.equal(projected.ok, true)
    assert.deepEqual(projected.result.parser.necklineCandidates[0].shapes, ['NECK_HIGH', 'NECK_MOCK'])
    assert.deepEqual(projected.result.parser.necklineCandidates[0].modifiers, ['HEIGHT_HIGH'])
    assert.equal(projected.result.parser.sourceNecklineShape.value, null)
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|records|privateCost/u)
  })
  test('invalid IDs, booleans, unbounded alternatives and malformed typed attributes fail closed', () => {
    for (const mutation of [r => r.result.collars = ['<bad>'], r => r.constrainsCatalog = 'yes',
      r => r.result.shapes = Array(46).fill('NECK_HIGH'), r => r.result.externalRoles = null]) {
      const raw = matchFixture('INCOMPLETE'); raw.parser.necklineCandidates = [candidate()]
      mutation(raw.parser.necklineCandidates[0]); assert.equal(normalizeMatchResult(raw).ok, false)
    }
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceCollarType = { status: 'resolved', value: 'COLLAR_POLO', candidates: [], source: 'explicit', evidence: [] }
    assert.equal(normalizeMatchResult(raw).ok, false)
  })
  test('old API payloads stay accepted without optional collar fields', () => assert.equal(normalizeMatchResult(matchFixture('INCOMPLETE')).ok, true))
})

describe('Material evidence additive projection', () => {
  const material = () => ({ text: 'coton', startToken: 1, endToken: 2, constrainsCatalog: true, domainExplicit: true,
    result: { status: 'matched', fabrics: ['COTTON'], modifiers: [], records: [{ privateCost: 'PRIVATE' }], ambiguities: ['PRIVATE'] } })
  test('source IDs and safe descriptor summaries survive; resource rows/private fields are omitted', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceMaterial = { status: 'resolved', value: 'COTTON', candidates: ['COTTON'], source: 'explicit', evidence: [] }
    raw.parser.materialCandidates = [material()]
    raw.parser.materialComposition = [{ span: { text: '95', startToken: 2, endToken: 3 }, percentage: 95,
      candidates: ['COTTON'], status: 'requested', catalogVerified: false, privateCost: 'PRIVATE' }]
    const projected = normalizeMatchResult(raw)
    assert.equal(projected.ok, true)
    assert.equal(projected.result.parser.sourceMaterial.value, 'COTTON')
    assert.deepEqual(projected.result.parser.materialCandidates[0].fabrics, ['COTTON'])
    assert.equal(projected.result.parser.materialComposition[0].catalogVerified, false)
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|records|privateCost/u)
  })
  test('malformed fabric fields, invalid percentages and forged verification fail closed', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.materialCandidates = [material()]
    assert.equal(normalizeMatchResult(raw).ok, true)
    raw.parser.materialCandidates[0].result.fabrics = ['<invalid>']
    assert.equal(normalizeMatchResult(raw).ok, false)
    raw.parser.materialCandidates = [material()]
    for (const percentage of [-1, 101, '95']) {
      raw.parser.materialComposition = [{ span: { text: '95', startToken: 2, endToken: 3 }, percentage,
        candidates: ['COTTON'], status: 'requested', catalogVerified: false }]
      assert.equal(normalizeMatchResult(raw).ok, false)
    }
    raw.parser.materialComposition[0].percentage = 95
    raw.parser.materialComposition[0].catalogVerified = true
    assert.equal(normalizeMatchResult(raw).ok, false)
  })
  test('composition requires independent metadata; a forced MATCHED response is rejected', () => {
    const raw = matchFixture()
    raw.parser.materialComposition = [{ span: { text: '95', startToken: 2, endToken: 3 }, percentage: 95,
      candidates: ['COTTON'], status: 'requested', catalogVerified: false }]
    assert.equal(normalizeMatchResult(raw).ok, false)
    delete raw.parser.materialComposition
    assert.equal(normalizeMatchResult(raw).ok, true)
  })
})

describe('Quantity intent additive projection', () => {
  test('legacy responses remain compatible; advisory units are projected without private/source metadata', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.attributes.quantity = { status: 'missing', value: null, candidates: [], source: null, evidence: [] }
    raw.parser.quantityIntent = { status: 'context_required', intent: 'needs_review', orderUnits: 2, unitId: 'PAIR',
      unitCandidates: ['PAIR'], resolvedPieces: null, needsCatalogMetadata: true, exactness: 'unresolved',
      reasons: ['Catalog mapping required'], privateCost: 'PRIVATE', evidence: ['PRIVATE'], sourceRecords: ['PRIVATE'] }
    const projected = normalizeMatchResult(raw)
    assert.equal(projected.ok, true)
    assert.equal(projected.result.parser.quantityIntent.orderUnits, 2)
    assert.equal(projected.result.parser.quantityIntent.unitId, 'PAIR')
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|privateCost|sourceRecords/u)
    delete raw.parser.quantityIntent
    assert.equal(normalizeMatchResult(raw).ok, true)
  })
  test('unresolved conversion, invalid units and contradictory resolved counts fail closed', () => {
    const raw = matchFixture()
    raw.parser.quantityIntent = { status: 'resolved', intent: 'order', orderUnits: 2, unitId: 'PIECE',
      unitCandidates: ['PIECE'], resolvedPieces: 2, needsCatalogMetadata: false, exactness: 'exact', reasons: [] }
    assert.equal(normalizeMatchResult(raw).ok, true)
    raw.parser.quantityIntent.unitId = 'PAIR'
    raw.parser.quantityIntent.unitCandidates = ['PAIR']
    assert.equal(normalizeMatchResult(raw).ok, false)
    raw.parser.quantityIntent.status = 'context_required'
    raw.parser.quantityIntent.resolvedPieces = null
    assert.equal(normalizeMatchResult(raw).ok, false)
    raw.status = 'INCOMPLETE'; raw.match = null
    raw.parser.attributes.quantity = { status: 'missing', value: null, candidates: [], source: null, evidence: [] }
    assert.equal(normalizeMatchResult(raw).ok, true)
    raw.parser.quantityIntent.unitId = 'MADE_UP'
    assert.equal(normalizeMatchResult(raw).ok, false)
  })
})

describe('Sizes source response compatibility', () => {
  test('additive size evidence is projected; source alias rows and private metadata are stripped', () => {
    const raw = matchFixture()
    raw.parser.sourceSizeId = { status: 'resolved', value: 'JEANS_W32_L30', candidates: ['JEANS_W32_L30'], source: 'explicit', evidence: [], internal: 'PRIVATE' }
    raw.parser.sourceSizeCandidates = [{ records: 'PRIVATE' }]
    const result = normalizeMatchResult(raw)
    assert.equal(result.ok, true)
    assert.equal(result.result.parser.sourceSizeId.value, 'JEANS_W32_L30')
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|sourceSizeCandidates/u)
    delete raw.parser.sourceSizeId
    assert.equal(normalizeMatchResult(raw).ok, true)
  })
  test('ambiguous standards remain alternatives; contradictory and malformed values fail closed', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceSizeId = { status: 'ambiguous', value: null, candidates: ['APPAREL_EU_38', 'SHOES_EU_38'], source: null, evidence: [] }
    assert.deepEqual(normalizeMatchResult(raw).result.parser.sourceSizeId.candidates, ['APPAREL_EU_38', 'SHOES_EU_38'])
    raw.parser.sourceSizeId.value = 'APPAREL_EU_38'
    assert.equal(normalizeMatchResult(raw).ok, false)
    raw.parser.sourceSizeId = { status: 'resolved', value: 38, candidates: [38], source: 'explicit', evidence: [] }
    assert.equal(normalizeMatchResult(raw).ok, false)
    raw.parser.sourceSizeId = { status: 'resolved', value: 'ALPHA_XL', candidates: ['ALPHA_2XL'], source: 'explicit', evidence: [] }
    assert.equal(normalizeMatchResult(raw).ok, false)
  })
})

describe('Colors source response compatibility', () => {
  test('precise color is additive; raw alias records and private metadata are stripped', () => {
    const raw = matchFixture()
    raw.parser.sourceColorId = { status: 'resolved', value: 'DUSTY_ROSE', candidates: ['DUSTY_ROSE'], source: 'explicit', evidence: [], extra: 'PRIVATE' }
    raw.parser.colorCandidates = [{ records: 'PRIVATE' }]
    const result = normalizeMatchResult(raw)
    assert.equal(result.ok, true)
    assert.equal(result.result.parser.sourceColorId.value, 'DUSTY_ROSE')
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|colorCandidates/u)
  })
  test('ambiguous colors stay alternatives and contradictory source values fail closed', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceColorId = { status: 'ambiguous', value: null, candidates: ['CREAM', 'OFF_WHITE'], source: null, evidence: [] }
    assert.deepEqual(normalizeMatchResult(raw).result.parser.sourceColorId.candidates, ['CREAM', 'OFF_WHITE'])
    raw.parser.sourceColorId.value = 'CREAM'
    assert.equal(normalizeMatchResult(raw).ok, false)
    raw.parser.sourceColorId = { status: 'resolved', value: 'DUSTY_ROSE', candidates: ['BLACK'], source: 'explicit', evidence: [] }
    assert.equal(normalizeMatchResult(raw).ok, false)
  })
})

describe('Product Types seed response compatibility', () => {
  test('active source identity is additive and projected without private metadata', () => {
    const raw = matchFixture()
    raw.parser.sourceProductType = { status: 'resolved', value: 'CARGO_PANTS', candidates: ['CARGO_PANTS'],
      source: 'explicit', evidence: [], internalExtra: 'PRIVATE_SOURCE' }
    const result = normalizeMatchResult(raw)
    assert.equal(result.ok, true)
    assert.equal(result.result.parser.sourceProductType.value, 'CARGO_PANTS')
    assert.ok(!JSON.stringify(result).includes('PRIVATE_SOURCE'))
  })
  test('active source alternatives stay ambiguous; malformed additive fields are rejected', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceProductType = { status: 'ambiguous', value: null, candidates: ['BABY_ONESIE', 'BODYSUIT'],
      source: null, evidence: [] }
    assert.deepEqual(normalizeMatchResult(raw).result.parser.sourceProductType.candidates, ['BABY_ONESIE', 'BODYSUIT'])
    raw.parser.sourceProductType.value = 'BABY_ONESIE'
    assert.equal(normalizeMatchResult(raw).ok, false)
    raw.parser.sourceProductType = { status: 'resolved', value: 32, candidates: [32], source: 'explicit', evidence: [] }
    assert.equal(normalizeMatchResult(raw).ok, false)
    raw.parser.sourceProductType = { status: 'resolved', value: 'CARGO_PANTS', candidates: ['BLOUSE'], source: 'explicit', evidence: [] }
    assert.equal(normalizeMatchResult(raw).ok, false)
  })
  test('the existing Lab shows source-review ambiguity without exposing unallowlisted metadata', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.status = 'needs_clarification'
    raw.parser.attributes.productType = { status: 'ambiguous', value: null, candidates: ['SHIRT'], source: null, evidence: [] }
    raw.parser.unresolvedInformation = ['productType']
    raw.parser.ambiguities = [{ kind: 'lexical_ambiguity', message: 'Unverified Product Types seed: SHIRT; requires literal catalog-name evidence.',
      span: { text: 'chemise', startToken: 0, endToken: 1 }, fields: ['productType'], alternatives: [{ field: 'productType', value: 'SHIRT' }] }]
    raw.parser.productTypeCandidates = [{ internalExtra: 'PRIVATE', result: { candidates: [{ sourceTypeId: 'SHIRT', reviewStatus: 'seed_review' }] } }]
    const normalized = normalizeMatchResult(raw)
    assert.equal(normalized.ok, true)
    assert.equal(normalized.result.parser.attributes.productType.value, null)
    assert.ok(normalized.result.parser.ambiguities[0].message.includes('SHIRT'))
    assert.ok(!JSON.stringify(normalized).includes('PRIVATE'))
    assert.equal('productTypeCandidates' in normalized.result.parser, false)
  })
})

describe('development-only matching route', () => {
  for (const role of ['OWNER', 'WAREHOUSE']) {
    test(`${role}: development route is authorized but absent from normal navigation`, () => {
      assert.equal(resolveAppRoute(ROUTES.textMatchingLab, role, true).route.key, 'textMatchingLab')
      assert.equal(resolveAppRoute(ROUTES.textMatchingLab, role, false).route, null)
      assert.equal(resolveAppRoute(ROUTES.textMatchingLab, role).route, null)
      assert.ok(getAppNavigation(role).every(row => row.path !== ROUTES.textMatchingLab))
      assert.equal(canUseMatchingLab(activeProfile(role)), true)
    })
  }
  for (const role of ['SUPER_ADMIN', 'UNKNOWN', undefined]) {
    test(`unauthorized role ${role} cannot resolve lab`, () => {
      assert.equal(resolveAppRoute(ROUTES.textMatchingLab, role, true).route, null)
      assert.equal(canUseMatchingLab(activeProfile(role)), false)
    })
  }
  test('inactive, pending and missing profiles fail closed', () => {
    for (const status of ['PENDING', 'SUSPENDED', 'REJECTED']) {
      const profile = activeProfile('OWNER'); profile.account.status = status
      assert.equal(canUseMatchingLab(profile), false)
    }
    const inactive = activeProfile('WAREHOUSE'); inactive.user.isActive = false
    assert.equal(canUseMatchingLab(inactive), false)
    assert.equal(canUseMatchingLab(null), false)
    assert.equal(canUseMatchingLab({ user: { role: 'OWNER' } }), false)
  })
})

describe('text-only authenticated API integration', () => {
  for (const sentence of ['بدي تي شيرت سودا قياس XL قطعتين', 'Tshirt black XL two pieces',
    'Bdi Tchirt Sawda XL Tnen pieces', 'بدي T-shirt sawda XL 2 pieces', 'Cedar Moonwalk black XL two pieces']) {
    test(`sends unchanged raw text only: ${sentence}`, async () => {
      let calls = 0
      const result = await requestTextMatch({ supabase: sessionClient(), text: sentence, fetchImpl: async (url, options) => {
        calls++
        assert.equal(url, '/api/voice-sales/match')
        assert.equal(options.method, 'POST')
        assert.deepEqual(JSON.parse(options.body), { text: sentence })
        assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token')
        return jsonResponse(200, matchFixture())
      } })
      assert.equal(calls, 1)
      assert.equal(result.ok, true)
      assert.doesNotMatch(JSON.stringify(result), /synthetic-test-token|accountId/u)
    })
  }
  for (const status of ['MATCHED', 'AMBIGUOUS', 'INCOMPLETE', 'NOT_FOUND', 'INSUFFICIENT_STOCK', 'INVALID_INPUT']) {
    test(`preserves server status ${status} without browser matching`, async () => {
      const response = matchFixture(status)
      const result = await requestTextMatch({ supabase: sessionClient(), text: 'Tshirt and pants',
        fetchImpl: async () => jsonResponse(status === 'INVALID_INPUT' ? 422 : 200, response) })
      assert.equal(result.ok, true)
      assert.equal(result.result.status, status)
      assert.deepEqual(result.result.parser.ambiguities, response.parser.ambiguities)
    })
  }
  test('422 opt-in does not change the default transport error contract', async () => {
    const fetchImpl = async () => jsonResponse(422, matchFixture('INVALID_INPUT'))
    assert.equal((await apiRequest({ path: '/api/voice-sales/match', method: 'POST', fetchImpl })).ok, false)
    const accepted = await apiRequest({ path: '/api/voice-sales/match', method: 'POST', fetchImpl, acceptedStatuses: [422] })
    assert.equal(accepted.ok, true)
    assert.equal(accepted.data.status, 'INVALID_INPUT')
  })
  test('missing session never sends a request', async () => {
    let calls = 0
    const supabase = { auth: { async getSession() { return { data: { session: null }, error: null } } } }
    const result = await requestTextMatch({ supabase, text: 'Tshirt', fetchImpl: async () => { calls++ } })
    assert.equal(result.requiresLogin, true)
    assert.equal(calls, 0)
  })
  for (const status of [401, 403, 422, 429, 500, 503]) {
    test(`HTTP ${status} is safe and actionable`, async () => {
      const result = await requestTextMatch({ supabase: sessionClient(), text: 'Tshirt',
        fetchImpl: async () => jsonResponse(status, { error: { code: 'PRIVATE_CODE', message: 'PRIVATE_PROVIDER_DETAIL' } }, '12') })
      assert.equal(result.ok, false)
      assert.equal(result.status, status)
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE/u)
      if (status === 401) assert.equal(result.requiresLogin, true)
      if (status === 429) assert.equal(result.retryAfterSeconds, 12)
    })
  }
  test('reports allowlisted 403 causes without exposing arbitrary backend details', async () => {
    const role = await requestTextMatch({ supabase: sessionClient(), text: 'Tshirt',
      fetchImpl: async () => jsonResponse(403, { error: { code: 'ROLE_FORBIDDEN', message: 'PRIVATE_DETAIL' } }) })
    assert.equal(role.code, 'ROLE_FORBIDDEN')
    assert.match(role.message, /OWNER or WAREHOUSE/u)
    assert.doesNotMatch(JSON.stringify(role), /PRIVATE/u)

    const tenant = await requestTextMatch({ supabase: sessionClient(), text: 'Tshirt',
      fetchImpl: async () => jsonResponse(403, { error: { code: 'TENANT_ACCESS_REQUIRED', message: 'PRIVATE_DETAIL' } }) })
    assert.equal(tenant.code, 'TENANT_ACCESS_REQUIRED')
    assert.match(tenant.message, /active store/u)
  })
  test('network and invalid JSON errors are sanitized', async () => {
    for (const fetchImpl of [async () => { throw new Error('PRIVATE_CONNECTION') },
      async () => ({ ok: true, status: 200, async json() { throw new Error('PRIVATE_JSON') } })]) {
      const result = await requestTextMatch({ supabase: sessionClient(), text: 'Tshirt', fetchImpl })
      assert.equal(result.ok, false)
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE/u)
    }
  })
  for (const value of ['', '  ', 'x'.repeat(4097), 'Tshirt\u0000black', '\uD800', null, 32]) {
    test(`invalid local input makes zero requests: ${typeof value}/${value?.length}`, async () => {
      let calls = 0
      assert.equal(validateMatchText(value).ok, false)
      const result = await requestTextMatch({ supabase: sessionClient(), text: value, fetchImpl: async () => { calls++ } })
      assert.equal(result.ok, false)
      assert.equal(calls, 0)
    })
  }
  test('newlines and the exact length boundary are permitted without interpretation', () => {
    assert.equal(validateMatchText('a'.repeat(4096)).ok, true)
    assert.equal(validateMatchText('Tshirt\nblack\tXL').ok, true)
    assert.equal(validateMatchText('Tshirt 32').text, 'Tshirt 32')
  })
})

describe('matching contract projection and diagnostic scenarios', () => {
  test('projects bounded ranked discovery tiers and strips private catalog fields', () => {
    const raw = matchFixture('INCOMPLETE')
    const candidate = { ...raw.candidates[0], categoryId: '44444444-4444-4444-8444-444444444444',
      barcode: '5285001234567', imageUrl: 'https://images.example/signed.webp', tier: 'STRONG_CANDIDATE',
      matchedAttributes: ['productType', 'product_name', 'category'], unverifiedAttributes: ['size', 'quantity'],
      differences: [], imageKey: 'PRIVATE', lastPurchaseCost: 'PRIVATE' }
    raw.discovery = { exactVerified: [], strongCandidates: [candidate], alternatives: [], requiresClarification: true,
      categoryResolution: { status: 'RESOLVED', coverageComplete: true, candidates: [{
        categoryId: candidate.categoryId, categoryName: 't-chirt', evidence: ['PRODUCT_TYPE_BRIDGE'], productCount: 2,
      }] } }
    const normalized = normalizeMatchResult(raw)
    assert.equal(normalized.ok, true)
    assert.equal(normalized.result.discovery.strongCandidates[0].tier, 'STRONG_CANDIDATE')
    assert.equal(normalized.result.discovery.strongCandidates[0].categoryId, candidate.categoryId)
    assert.equal(normalized.result.discovery.strongCandidates[0].barcode, candidate.barcode)
    assert.equal(normalized.result.discovery.categoryResolution.candidates[0].categoryName, 't-chirt')
    assert.equal(normalized.result.discovery.strongCandidates[0].imageUrl, 'https://images.example/signed.webp')
    assert.doesNotMatch(JSON.stringify(normalized), /PRIVATE|imageKey|lastPurchaseCost/u)
    raw.discovery.strongCandidates[0].tier = 'ALTERNATIVE'
    assert.equal(normalizeMatchResult(raw).ok, false)
  })
  test('extra financial and credential fields are stripped at every presentation layer', () => {
    const raw = matchFixture()
    Object.assign(raw, { accessToken: 'PRIVATE', serviceRoleKey: 'PRIVATE', profit: '7.00' })
    Object.assign(raw.match, { lastPurchaseCost: 'PRIVATE', COGS: 'PRIVATE', margin: 'PRIVATE' })
    Object.assign(raw.parser, { accessToken: 'PRIVATE' })
    Object.assign(raw.parser.attributes.color, { databaseUrl: 'PRIVATE' })
    Object.assign(raw.match.evidence[0], { password: 'PRIVATE' })
    const result = normalizeMatchResult(raw)
    assert.equal(result.ok, true)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|lastPurchaseCost|COGS|margin|accessToken|databaseUrl|password/u)
  })
  test('Decimal precision is retained as a string', () => {
    const raw = matchFixture(); raw.match.sellingPrice = '9999999999999999.99'
    assert.equal(normalizeMatchResult(raw).result.match.sellingPrice, '9999999999999999.99')
  })
  test('empty catalog, coverage limit and unpriced/missing-size outcomes remain unconfirmed', () => {
    const empty = matchFixture('NOT_FOUND'); empty.suggestions = []; empty.catalog.scannedVariants = 0
    const limited = matchFixture('INCOMPLETE'); limited.reason = 'CATALOG_COVERAGE_LIMIT'; limited.catalog.truncated = true; limited.missingFields.push('catalog_coverage')
    const unpriced = matchFixture('INCOMPLETE'); unpriced.candidates[0].sellingPrice = null; unpriced.missingFields.push('selling_price')
    const noSize = matchFixture('INCOMPLETE'); noSize.missingFields.push('size')
    for (const raw of [empty, limited, unpriced, noSize]) {
      const normalized = normalizeMatchResult(raw)
      assert.equal(normalized.ok, true)
      assert.equal(normalized.result.match, null)
      assert.deepEqual(normalized.result.missingFields, raw.missingFields)
    }
  })
  test('unknown words and parser alternatives survive projection', () => {
    const raw = matchFixture('AMBIGUOUS')
    raw.parser.ambiguities = [{ kind: 'lexical_ambiguity', message: 'Context required', span: { text: 'Polo', startToken: 0, endToken: 1 }, fields: ['productType', 'neckline'], alternatives: [{ field: 'productType', value: 'POLO_SHIRT' }, { field: 'neckline', value: 'POLO_COLLAR' }] }]
    assert.deepEqual(normalizeMatchResult(raw).result.parser.ambiguities, raw.parser.ambiguities)
    assert.deepEqual(normalizeMatchResult(raw).result.parser.unrecognizedTokens, raw.parser.unrecognizedTokens)
  })
  test('request intent evidence is allowlisted and private fields are stripped', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.requestIntents = [{ canonicalIntent: 'REQ_WANT', matchedExpression: 'badi',
      sourceSpan: { text: 'badi', startToken: 0, endToken: 1 }, languageEvidence: 'arabizi',
      polarity: 'affirmative', certainty: 'exact', contextualUncertainty: null,
      recognitionOnly: true, authorizesAction: false, itemIndex: 0, private: 'PRIVATE' }]
    const normalized = normalizeMatchResult(raw)
    assert.equal(normalized.ok, true)
    assert.equal(normalized.result.parser.requestIntents[0].canonicalIntent, 'REQ_WANT')
    assert.equal(normalized.result.parser.requestIntents[0].matchedExpression, 'badi')
    assert.doesNotMatch(JSON.stringify(normalized), /PRIVATE/u)
    raw.parser.requestIntents[0].authorizesAction = true
    assert.equal(normalizeMatchResult(raw).ok, false)
  })
  for (const change of [raw => { raw.status = 'invented' }, raw => { raw.requiresConfirmation = false },
    raw => { raw.match = null }, raw => { raw.match.sellingPrice = 12.5 }, raw => { raw.parser.attributes.size.value = null },
    raw => { raw.catalog.truncated = true }, raw => { raw.match.availableStock = 0 }, raw => { raw.match.quantity = null },
    raw => { raw.reason = 'PRIVATE error data' }, raw => { raw.candidates = Array.from({ length: 21 }, () => raw.match) }]) {
    test('malformed or contradictory MATCHED contract is rejected', () => {
      const raw = matchFixture(); change(raw)
      assert.equal(normalizeMatchResult(raw).ok, false)
    })
  }
})

describe('manual lab request lifecycle', () => {
  test('records separate review confirmation for every detected item and resets it on edit', async () => {
    const controller = createTextMatchingController({ request: async () => normalizeMatchResult(multiFixture()) })
    controller.setText('multi item'); await controller.submit()
    assert.deepEqual(controller.getSnapshot().confirmedItems, [])
    assert.equal(controller.confirmItem(0), true); assert.equal(controller.confirmItem(1), true)
    assert.deepEqual(controller.getSnapshot().confirmedItems, [0, 1])
    assert.equal(controller.confirmItem(8), false)
    controller.setText('changed')
    assert.deepEqual(controller.getSnapshot().confirmedItems, [])
  })
  test('typing does not call API; duplicate submits are skipped', async () => {
    let calls = 0; let finish
    const controller = createTextMatchingController({ request: async () => { calls++; return new Promise(resolve => { finish = resolve }) } })
    controller.setText('Tshirt'); controller.setText('Tshirt black XL two pieces')
    assert.equal(calls, 0)
    const pending = controller.submit()
    assert.equal(controller.getSnapshot().pending, true)
    assert.equal((await controller.submit()).skipped, true)
    finish(normalizeMatchResult(matchFixture()))
    await pending
    assert.equal(calls, 1)
    assert.equal(controller.getSnapshot().pending, false)
    assert.equal(controller.getSnapshot().result.status, 'MATCHED')
  })
  for (const action of ['edit', 'reset', 'unmount']) {
    test(`${action} invalidates an older response`, async () => {
      let finish; let calls = 0
      const controller = createTextMatchingController({ request: async () => { calls++; return new Promise(resolve => { finish = resolve }) } })
      controller.setText('Tshirt'); const pending = controller.submit()
      if (action === 'edit') controller.setText('New model')
      if (action === 'reset') controller.reset()
      if (action === 'unmount') controller.invalidate()
      assert.equal((await controller.submit()).skipped, true)
      finish(normalizeMatchResult(matchFixture()))
      assert.equal((await pending).ignored, true)
      assert.equal(controller.getSnapshot().result, null)
      assert.equal(controller.getSnapshot().pending, false)
      assert.equal(calls, 1)
    })
  }
  test('reset clears diagnostics and text without a new request', async () => {
    let calls = 0
    const controller = createTextMatchingController({ request: async () => { calls++; return normalizeMatchResult(matchFixture()) } })
    controller.setText('Tshirt'); await controller.submit(); controller.reset()
    assert.equal(controller.getSnapshot().text, '')
    assert.equal(controller.getSnapshot().result, null)
    assert.equal(calls, 1)
  })
  test('429 cooldown survives reset and does not automatically retry', async () => {
    let clock = 0; let calls = 0
    const controller = createTextMatchingController({ now: () => clock, request: async () => { calls++; return { ok: false, status: 429, retryAfterSeconds: 12, message: 'Wait' } } })
    controller.setText('Tshirt'); await controller.submit(); controller.reset(); controller.setText('Tshirt')
    assert.equal((await controller.submit()).skipped, true)
    clock = 12000
    assert.equal(calls, 1)
    await controller.submit()
    assert.equal(calls, 2)
  })
  test('429 from a reset request still imposes its cooldown', async () => {
    let finish
    const controller = createTextMatchingController({ now: () => 0, request: async () => new Promise(resolve => { finish = resolve }) })
    controller.setText('Tshirt'); const pending = controller.submit(); controller.reset()
    finish({ ok: false, status: 429, retryAfterSeconds: 10 })
    await pending
    assert.equal(controller.getSnapshot().retryAt, 10000)
  })
  test('unexpected failures clear pending and hide exception messages', async () => {
    const controller = createTextMatchingController({ request: async () => { throw new Error('PRIVATE') } })
    controller.setText('Tshirt'); await controller.submit()
    assert.equal(controller.getSnapshot().pending, false)
    assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /PRIVATE/u)
  })
})
