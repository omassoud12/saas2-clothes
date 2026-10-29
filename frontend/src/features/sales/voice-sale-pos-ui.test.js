import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
let vite
let VoiceSaleDialog
let VoiceControls
let ReviewCard
let SalesPage

before(async () => {
  const authFixture = { name: 'voice-pos-auth-fixture', enforce: 'pre',
    resolveId(id) { if (id.endsWith('/lib/supabase.js')) return '\0voice-pos-auth' },
    load(id) { if (id === '\0voice-pos-auth') return 'export const supabase = null' },
  }
  vite = await createServer({ root, configFile: false, plugins: [authFixture, react()], logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null } })
  const voiceModule = await vite.ssrLoadModule('/src/features/sales/VoiceSaleDialog.jsx')
  VoiceSaleDialog = voiceModule.VoiceSaleDialog
  VoiceControls = voiceModule.VoiceControls
  ReviewCard = voiceModule.ReviewCard
  SalesPage = (await vite.ssrLoadModule('/src/pages/app/SalesPage.jsx')).SalesPage
})
after(async () => { await vite?.close() })

describe('production POS voice UI', () => {
  test('renders the responsive Sales redesign with a real-catalog loading state', () => {
    for (const role of ['OWNER', 'WAREHOUSE']) {
      const html = renderToStaticMarkup(createElement(SalesPage, { profile: {
        user: { id: 'user', role, isActive: true, name: 'Employee' },
        account: { id: 'account', status: 'ACTIVE', baseCurrency: 'USD', name: 'Store' },
      } }))
      assert.match(html, /Sales today/u)
      assert.match(html, /Search products/u)
      assert.match(html, />All</u)
      assert.match(html, /Loading real products/u)
      assert.doesNotMatch(html, /Classic tee|Ribbed top|Straight jeans/u)
      assert.match(html, /Cart is empty/u)
      assert.doesNotMatch(html, /Voice sale/u)
      assert.doesNotMatch(html, /Complete sale/u)
    }
  })

  test('starts with typed input, optional microphone controls, and transcript confirmation before matching', () => {
    const html = renderToStaticMarkup(createElement(VoiceSaleDialog, { supabase: null, onClose() {}, onAdd() {} }))
    assert.match(html, /Review every item before adding it to the current cart/u)
    assert.match(html, /Request text/u)
    assert.match(html, /Confirm text/u)
    assert.match(html, /Match catalog/u)
    assert.doesNotMatch(html, /Use transcript/iu)
    assert.match(html, /Typed matching is ready/u)
    assert.doesNotMatch(html, /Add confirmed items to cart/u)
    assert.doesNotMatch(html, /Complete sale/u)
  })

  test('shows recording, processing, ready and error states without a manual transcript-copy action', () => {
    const controller = { start() {}, stop() {}, cancel() {}, retry() {} }
    const state = patch => ({ supported: true, elapsedMs: 1_200, canRetry: false, error: null, ...patch })
    assert.match(renderToStaticMarkup(createElement(VoiceControls, { controller, voice: state({ phase: 'recording' }) })), /Recording/u)
    const processing = renderToStaticMarkup(createElement(VoiceControls, { controller, voice: state({ phase: 'transcribing' }) }))
    assert.match(processing, /Uploading audio securely/u)
    assert.match(processing, /Transcribing/u)
    const ready = renderToStaticMarkup(createElement(VoiceControls, { controller, voice: state({ phase: 'review' }) }))
    assert.match(ready, /Transcript ready/u)
    assert.doesNotMatch(ready, /Use transcript/iu)
    const failed = renderToStaticMarkup(createElement(VoiceControls, { controller, voice: state({
      phase: 'error', error: { message: 'No speech was detected.' },
    }) }))
    assert.match(failed, /No speech was detected/u)
  })

  test('projects product type and model evidence into separate POS fields', () => {
    const missing = { status: 'missing', value: null, candidates: [], source: null, evidence: [] }
    const item = { index: 0, text: 'بدي تي شيرت polo', status: 'INCOMPLETE', reason: 'MISSING_OR_UNVERIFIED_CONSTRAINTS',
      parser: { attributes: { productType: { status: 'resolved', value: 'T_SHIRT', candidates: ['T_SHIRT'], source: 'explicit', evidence: [] },
        color: missing, size: missing, quantity: missing }, productNameResidualTokens: [{ token: 'polo', index: 3 }] },
      missingFields: ['color', 'size', 'quantity'], ambiguities: [], candidates: [], discovery: null,
      defaultVariantId: null, canSelect: false }
    const html = renderToStaticMarkup(createElement(ReviewCard, { item, decision: {}, onDecision() {} }))
    assert.match(html, /Product type<\/dt><dd>T_SHIRT<\/dd>/u)
    assert.match(html, /Brand \/ model evidence<\/dt><dd>polo<\/dd>/u)
    assert.doesNotMatch(html, /Brand \/ model evidence<\/dt><dd>[^<]*(?:بدي|تي شيرت)/u)
  })

  test('shows linen catalog evidence and explicit numeric size without leaking the size marker', () => {
    const missing = { status: 'missing', value: null, candidates: [], source: null, evidence: [] }
    const item = { index: 0, text: 'بدي بنطلون كتان لون أزرق قياس 32', status: 'INCOMPLETE', reason: 'MISSING_QUANTITY',
      parser: { attributes: {
        productType: { status: 'resolved', value: 'PANTS', candidates: ['PANTS'], source: 'explicit', evidence: [] },
        material: { status: 'resolved', value: 'LINEN', candidates: ['LINEN'], source: 'explicit',
          evidence: [{ span: { startToken: 2, endToken: 3, text: 'كتان' }, source: 'explicit', rule: 'dictionary_alias' }] },
        color: { status: 'resolved', value: 'BLUE', candidates: ['BLUE'], source: 'explicit', evidence: [] },
        size: { status: 'resolved', value: '32', candidates: ['32'], source: 'explicit', evidence: [] }, quantity: missing },
      productNameResidualTokens: [] }, missingFields: ['quantity'], ambiguities: [], candidates: [], discovery: null,
      defaultVariantId: null, canSelect: false }
    const html = renderToStaticMarkup(createElement(ReviewCard, { item, decision: {}, onDecision() {} }))
    assert.match(html, /Product type<\/dt><dd>PANTS<\/dd>/u)
    assert.match(html, /Brand \/ model evidence<\/dt><dd>كتان<\/dd>/u)
    assert.match(html, /Size<\/dt><dd>32<\/dd>/u)
    assert.doesNotMatch(html, /Brand \/ model evidence<\/dt><dd>قياس/u)
  })

  test('shows the actual catalog category separately from the linguistic product type', () => {
    const missing = { status: 'missing', value: null, candidates: [], source: null, evidence: [] }
    const item = { index: 0, text: 'بدي تيشيرت polo', status: 'INCOMPLETE', reason: 'MISSING_QUANTITY',
      parser: { attributes: { productType: { status: 'resolved', value: 'T_SHIRT', candidates: ['T_SHIRT'], source: 'explicit', evidence: [] },
        color: missing, size: missing, quantity: missing }, productNameResidualTokens: [{ token: 'polo', index: 2 }] },
      missingFields: ['quantity'], ambiguities: [], candidates: [], discovery: { exactVerified: [], strongCandidates: [], alternatives: [],
        requiresClarification: true, categoryResolution: { status: 'RESOLVED', coverageComplete: true,
          candidates: [{ categoryId: 'category-1', categoryName: 't-chirt', evidence: ['PRODUCT_TYPE_BRIDGE'], productCount: 2 }] } },
      defaultVariantId: null, canSelect: false }
    const html = renderToStaticMarkup(createElement(ReviewCard, { item, decision: {}, onDecision() {} }))
    assert.match(html, /Product type<\/dt><dd>T_SHIRT<\/dd>/u)
    assert.match(html, /Catalog category<\/dt><dd>t-chirt<\/dd>/u)
  })
})
