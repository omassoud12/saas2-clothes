import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build, createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { activeProfile, matchFixture } from './testing/match-fixtures.js'
import { normalizeMatchResult } from './text-matching-flow.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const envDir = fileURLToPath(new URL('./testing/no-environment', import.meta.url))
let vite
let View
let Page
before(async () => {
  const authFixture = { name: 'lab-test-auth-fixture', enforce: 'pre',
    resolveId(id) { if (id.endsWith('/lib/supabase.js')) return '\0lab-test-auth' },
    load(id) { if (id === '\0lab-test-auth') return 'export const supabase = null' },
  }
  vite = await createServer({ root, envDir, configFile: false, plugins: [authFixture, react()], logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null } })
  const module = await vite.ssrLoadModule('/src/pages/app/TextMatchingLabPage.jsx')
  View = module.TextMatchingLabView
  Page = module.TextMatchingLabPage
})
after(async () => { await vite?.close() })
const render = (patch = {}) => renderToStaticMarkup(createElement(View, {
  state: { text: '', pending: false, result: null, error: null, retryAt: 0, ...patch },
  onTextChange() {}, onSubmit() {}, onReset() {}, onExample() {},
}))
const voiceState = patch => ({ phase: 'idle', supported: true, elapsedMs: 0, transcriptText: '', confirmedText: '',
  languageCode: null, languageProbability: null, error: null, canRetry: false, ...patch })

describe('actual lab component rendering (SSR, synthetic data)', () => {
  test('renders one independent card and review control per detected item', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.reason = 'MULTIPLE_ITEMS_REQUIRE_INDEPENDENT_CONFIRMATION'
    raw.items = [matchFixture('MATCHED'), matchFixture('INSUFFICIENT_STOCK')].map((result, index) => ({ index,
      segment: { text: index ? 'Ø¨Ù†Ø·Ù„ÙˆÙ† polo' : 't shirt zara Ù„ÙˆÙ†Ù‡ Ø§Ø³ÙˆØ¯',
        removedConversationalExpressions: index ? ['ÙŠØ§ ÙƒØ¨ÙŠØ±'] : ['Ù„ÙˆÙ†Ù‡'] }, result }))
    raw.segmentation = { status: 'segmented', normalizedText: 'multi item sentence',
      reason: 'CONJUNCTION_WITH_INDEPENDENT_ITEM_EVIDENCE', removedConversationalExpressions: ['Ù„ÙˆÙ†Ù‡', 'ÙŠØ§ ÙƒØ¨ÙŠØ±'] }
    raw.catalog.candidateCount = 2
    const result = normalizeMatchResult(raw).result
    const html = render({ result, confirmedItems: [0] })
    assert.match(html, /2 items detected/u); assert.match(html, /Item 1/u); assert.match(html, /Item 2/u)
    assert.match(html, /t shirt zara Ù„ÙˆÙ†Ù‡ Ø§Ø³ÙˆØ¯/u); assert.match(html, /Ø¨Ù†Ø·Ù„ÙˆÙ† polo/u)
    assert.match(html, /Item 1 reviewed/u); assert.match(html, /Confirm item review/u)
    assert.match(html, /Conversational expressions ignored/u)
    assert.doesNotMatch(html, /Add to cart|Sell now|Checkout/u)
  })
  test('Lab displays excluded/desired pattern alternatives and modifiers without sale controls',()=>{
    const raw=matchFixture('INCOMPLETE');raw.parser.patternCandidates=[{text:'Ù…Ù†Ù‚Ø·',startToken:1,endToken:2,role:'descriptor',polarity:'negated',constrainsCatalog:false,modifierTarget:null,
      result:{status:'context_required',patterns:['DOT_GENERIC','ANIMAL_DALMATIAN'],modifiers:['SCALE_SMALL'],records:['PRIVATE']}}]
    const html=render({result:normalizeMatchResult(raw).result});assert.match(html,/Patterns &amp; prints|Patterns &amp;amp; prints/u);assert.match(html,/Excluded/u);assert.match(html,/ANIMAL_DALMATIAN/u);assert.match(html,/SCALE_SMALL/u);assert.doesNotMatch(html,/PRIVATE|Add to cart|Sell now|Checkout/u)
  })
  test('Lab displays fit axes, alternatives and negation without sale controls', () => {
    const raw=matchFixture('INCOMPLETE')
    raw.parser.fitCutCandidates=[{text:'Ø³ÙƒÙŠÙ†ÙŠ',startToken:1,endToken:2,role:'descriptor',polarity:'negated',constrainsCatalog:false,
      modifierTarget:null,result:{status:'context_required',styles:['FIT_SKINNY','FIT_SUPER_SKINNY'],modifiers:[]}}]
    const html=render({result:normalizeMatchResult(raw).result})
    assert.match(html,/Fits &amp; cuts/u)
    assert.match(html,/FIT_SKINNY.*FIT_SUPER_SKINNY/u)
    assert.match(html,/negated/u)
    assert.doesNotMatch(html,/Add to cart|Sell now|Checkout/u)
  })
  test('Lab shows read-only intent alternatives with no business-action controls', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.reason = 'COMMON_EXPRESSION_REQUIRES_CLARIFICATION'
    raw.parser.commonExpressionMatches = [{ span: { text: 'ØºÙŠØ±Ù„ÙŠ Ø§Ù„Ù„ÙˆÙ†', startToken: 0, endToken: 2 },
      candidates: ['CHANGE_COLOR', 'PREF_OTHER_COLOR'], categories: ['ORDER_CHANGE', 'PREFERENCE'],
      status: 'context_required', role: 'intent', polarity: 'uncertain', recognitionOnly: true,
      authorizesAction: false, provenance: 'seed_unvalidated', secret: 'PRIVATE' }]
    raw.parser.commonExpressionSafety = { salePreviewAllowed: false, reason: 'INTENT_REQUIRES_CONTEXT',
      recognitionOnly: true, authorizesAction: false }
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /Expression &amp; intent cues/u)
    assert.match(html, /CHANGE_COLOR \/ PREF_OTHER_COLOR/u)
    assert.match(html, /Recognition only/u); assert.match(html, /Catalog not queried/u)
    assert.doesNotMatch(html, /PRIVATE|<button[^>]*>.*(?:Checkout|Cancel order|Add to cart)/u)
  })
  test('Lab displays canonical request intent, expression and polarity without action controls', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.requestIntents = [{ canonicalIntent: 'REQ_WANT', matchedExpression: 'badi',
      sourceSpan: { text: 'badi', startToken: 0, endToken: 1 }, languageEvidence: 'arabizi',
      polarity: 'affirmative', certainty: 'exact', contextualUncertainty: null,
      recognitionOnly: true, authorizesAction: false }]
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /Request intent/u); assert.match(html, /REQ_WANT/u)
    assert.match(html, /Recognized expression/u); assert.match(html, /badi/u)
    assert.match(html, /Polarity/u); assert.match(html, /Affirmative/u)
    assert.doesNotMatch(html, /Add to cart|Sell now|Checkout/u)
  })
  test('Lab shows separate neckline/collar identities, modifier alternatives and unverified roles', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceNecklineShape = { status: 'ambiguous', value: null, candidates: ['NECK_HIGH', 'NECK_MOCK'], source: null, evidence: [] }
    raw.parser.sourceCollarType = { status: 'resolved', value: 'COLLAR_POLO', candidates: ['COLLAR_POLO'], source: 'explicit', evidence: [] }
    raw.parser.necklineCandidates = [{ text: 'polo', startToken: 1, endToken: 2, constrainsCatalog: false, domainExplicit: false,
      result: { status: 'context_required', shapes: [], collars: ['COLLAR_POLO'], modifiers: ['HEIGHT_HIGH'],
        externalRoles: ['PRODUCT_POLO_SHIRT'], records: ['PRIVATE'] } }]
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /Neckline shape/u); assert.match(html, /Collar type/u)
    assert.match(html, /NECK_HIGH \/ NECK_MOCK/u); assert.match(html, /HEIGHT_HIGH/u)
    assert.match(html, /PRODUCT_POLO_SHIRT/u); assert.match(html, /Role needs context/u)
    assert.match(html, /Product-name evidence is required/u); assert.doesNotMatch(html, /PRIVATE/u)
  })
  test('Lab keeps fabric alternatives, modifiers and unverified composition visible', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceMaterial = { status: 'ambiguous', value: null, candidates: ['VELVET', 'VELOUR'], source: null, evidence: [] }
    raw.parser.materialCandidates = [{ text: 'velours', startToken: 1, endToken: 2, domainExplicit: true, constrainsCatalog: true,
      result: { status: 'context_required', fabrics: ['VELVET', 'VELOUR'], modifiers: ['SOFT'], records: ['PRIVATE'] } }]
    raw.parser.materialComposition = [{ span: { text: '95', startToken: 2, endToken: 3 }, percentage: 95,
      candidates: ['COTTON'], status: 'requested', catalogVerified: false }]
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /Materials &amp; fabric descriptors/u)
    assert.match(html, /VELVET \/ VELOUR/u)
    assert.match(html, /SOFT/u)
    assert.match(html, /95%/u)
    assert.match(html, /Composition and certification are unverified/u)
    assert.doesNotMatch(html, /PRIVATE/u)
  })
  test('Lab distinguishes order pairs from unverified stock conversion', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.attributes.quantity = { status: 'missing', value: null, candidates: [], source: null, evidence: [] }
    raw.parser.quantityIntent = { status: 'context_required', intent: 'needs_review', orderUnits: 2, unitId: 'PAIR',
      unitCandidates: ['PAIR'], resolvedPieces: null, needsCatalogMetadata: true, exactness: 'unresolved', reasons: [] }
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /Quantity intent/u)
    assert.match(html, /Order units: 2/u)
    assert.match(html, /Unit: PAIR/u)
    assert.match(html, /Verified sellable units: Unresolved/u)
    assert.match(html, /requires verified catalog metadata/u)
  })
  test('Lab renders structured composite sizes and unresolved size standards', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceSizeId = { status: 'ambiguous', value: null, candidates: ['APPAREL_EU_38', 'SHOES_EU_38'], source: null, evidence: [] }
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /Size concept/u)
    assert.match(html, /APPAREL_EU_38 \/ SHOES_EU_38/u)
    raw.parser.sourceSizeId = { status: 'resolved', value: 'JEANS_W32_L30', candidates: ['JEANS_W32_L30'], source: 'explicit', evidence: [] }
    assert.match(render({ result: normalizeMatchResult(raw).result }), /JEANS_W32_L30/u)
  })
  test('Lab renders precise color evidence and unresolved shade alternatives', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceColorId = { status: 'ambiguous', value: null, candidates: ['CREAM', 'OFF_WHITE'], source: null, evidence: [] }
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /Color \/ shade concept/u)
    assert.match(html, /CREAM \/ OFF_WHITE/u)
    raw.parser.sourceColorId = { status: 'resolved', value: 'DUSTY_ROSE', candidates: ['DUSTY_ROSE'], source: 'explicit', evidence: [] }
    assert.match(render({ result: normalizeMatchResult(raw).result }), /DUSTY_ROSE/u)
  })
  test('all source concepts and ambiguous alternatives have a clean Lab display', () => {
    const raw = matchFixture('INCOMPLETE')
    raw.parser.sourceProductType = { status: 'ambiguous', value: null, candidates: ['BABY_ONESIE', 'BODYSUIT'], source: null, evidence: [] }
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /Clothing concept/u)
    assert.match(html, /BABY_ONESIE \/ BODYSUIT/u)
    raw.parser.sourceProductType = { status: 'resolved', value: 'CARGO_PANTS', candidates: ['CARGO_PANTS'], source: 'explicit', evidence: [] }
    assert.match(render({ result: normalizeMatchResult(raw).result }), /CARGO_PANTS/u)
  })
  test('page guard rejects unauthorized and suspended profiles before rendering the lab', () => {
    const suspended = activeProfile('OWNER'); suspended.account.status = 'SUSPENDED'
    for (const profile of [activeProfile('SUPER_ADMIN'), suspended, null]) {
      const html = renderToStaticMarkup(createElement(Page, { profile }))
      assert.equal(html.includes('Text Matching Lab'), false)
      assert.equal(html.includes('matching-sentence'), false)
    }
  })
  for (const role of ['OWNER', 'WAREHOUSE']) {
    test(`active ${role} page renders an idle lab without any auth or catalog request`, () => {
      const html = renderToStaticMarkup(createElement(Page, { profile: activeProfile(role) }))
      assert.match(html, /Ready for a manual test/u)
      assert.match(html, /Test Match/u)
    })
  }
  test('accessible manual form and reset appear without fetching a catalog', () => {
    const html = render()
    assert.match(html, /Voice Sale — Text Matching Lab/u)
    assert.match(html, /Development only/u)
    assert.match(html, /for="matching-sentence"/u)
    assert.match(html, /maxlength="4096"/iu)
    assert.match(html, /Test Match/u)
    assert.match(html, /Reset/u)
    assert.match(html, /dir="auto"/u)
    assert.doesNotMatch(html, /<h2[^>]*>Parser Result/u)
  })
  test('pending submission has spinner, announcement and disabled submit', () => {
    const html = render({ pending: true })
    assert.match(html, /aria-busy="true"/u)
    assert.match(html, /type="submit"[^>]*disabled/u)
    assert.match(html, /Testing match/u)
    assert.match(html, /aria-live="polite"/u)
  })
  test('voice transcript requires confirmation before the separate matching action appears', () => {
    const handlers = { onTextChange() {}, onSubmit() {}, onReset() {}, onExample() {}, onVoiceStart() {}, onVoiceStop() {},
      onVoiceCancel() {}, onVoiceRetry() {}, onVoiceEdit() {}, onVoiceConfirm() {}, onVoiceRun() {} }
    const review = renderToStaticMarkup(createElement(View, { ...handlers,
      state: { text: '', pending: false, result: null, error: null, retryAt: 0 },
      voice: voiceState({ phase: 'review', transcriptText: 'Ø¨Ø¯ÙŠ T-shirt black XL Ù‚Ø·Ø¹ØªÙŠÙ†' }),
    }))
    assert.match(review, /Editable transcript/u); assert.match(review, /Confirm transcript/u); assert.doesNotMatch(review, /Run catalog match/u)
    const confirmed = renderToStaticMarkup(createElement(View, { ...handlers,
      state: { text: 'Ø¨Ø¯ÙŠ T-shirt black XL Ù‚Ø·Ø¹ØªÙŠÙ†', pending: false, result: null, error: null, retryAt: 0 },
      voice: voiceState({ phase: 'confirmed', transcriptText: 'Ø¨Ø¯ÙŠ T-shirt black XL Ù‚Ø·Ø¹ØªÙŠÙ†', confirmedText: 'Ø¨Ø¯ÙŠ T-shirt black XL Ù‚Ø·Ø¹ØªÙŠÙ†' }),
    }))
    assert.match(confirmed, /Run catalog match/u); assert.match(confirmed, /Edit transcript/u); assert.match(confirmed, /disabled=""/u)
    assert.doesNotMatch(confirmed, /Add to cart|Sell now|Checkout/u)
  })
  for (const status of ['MATCHED', 'AMBIGUOUS', 'INCOMPLETE', 'NOT_FOUND', 'INSUFFICIENT_STOCK', 'INVALID_INPUT']) {
    test(`renders ${status} and full diagnostic sections`, () => {
      const result = normalizeMatchResult(matchFixture(status)).result
      const html = render({ result })
      for (const label of ['Parser Result', 'Catalog Matching Result', 'Matched Product Preview', 'Unknown words',
        'Parser ambiguities', 'Alternative candidates', 'Suggestions', 'Catalog coverage']) assert.ok(html.includes(label), label)
      assert.ok(html.includes(status))
      if (status === 'MATCHED') {
        for (const label of ['Tshirt Cedar', 'Black', 'XL', '12.50 USD', 'Available stock', 'Match evidence']) assert.ok(html.includes(label))
      }
      if (status === 'NOT_FOUND') assert.match(html, /Suggestion only — unconfirmed/u)
      if (status === 'INVALID_INPUT') assert.match(html, /Catalog not queried/u)
    })
  }
  test('coverage limit is displayed without a confirmed match', () => {
    const raw = matchFixture('INCOMPLETE'); raw.catalog.truncated = true; raw.missingFields.push('catalog_coverage')
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /Coverage limited/u)
    assert.match(html, /Uniqueness is unverified/u)
    assert.match(html, /No confirmed product selection/u)
  })
  test('errors are announced and expired-session recovery is shown', () => {
    const html = render({ error: { message: 'Sign in again.', requiresLogin: true } })
    assert.match(html, /role="alert"/u)
    assert.match(html, /href="\/login"/u)
  })
  test('untrusted catalog text is escaped and extra fields are never rendered', () => {
    const raw = matchFixture(); raw.match.productName = '<script>alert(1)</script>'; raw.match.lastPurchaseCost = 'PRIVATE_COST'
    const html = render({ result: normalizeMatchResult(raw).result })
    assert.match(html, /&lt;script&gt;/u)
    assert.doesNotMatch(html, /<script>|PRIVATE_COST/u)
    assert.doesNotMatch(html, /Add to cart|Sell now|Checkout|microphone/iu)
  })
})

test('production build removes the development lab and keeps voice endpoints out of the catalog-backed Sales screen', async () => {
  // createServer sets development NODE_ENV; explicitly simulate a production build.
  const previous = process.env.NODE_ENV
  let output
  try {
    process.env.NODE_ENV = 'production'
    output = await build({ root, envDir, mode: 'production', configFile: false, plugins: [react()], logLevel: 'silent',
      build: { write: false, minify: false } })
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
  const assets = (Array.isArray(output) ? output : [output]).flatMap(bundle => bundle.output)
  const content = assets.map(asset => asset.type === 'chunk' ? asset.code : String(asset.source)).join('\n')
  assert.equal(/Voice Sale . Text Matching Lab|matching-lab-candidate/u.test(content), false, 'Lab code must not ship in production')
  assert.doesNotMatch(content, /\/api\/voice-sales\/(?:match|transcribe)/u)
  assert.match(content, /Search products/u)
  assert.ok(assets.every(asset => !asset.fileName.includes('TextMatchingLab')))
})
