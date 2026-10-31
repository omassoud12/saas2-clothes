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
let ProductRow
let CartSheet
let SaleCompletedSheet
let SalesHistorySheet

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
  ProductRow = (await vite.ssrLoadModule('/src/features/sales/MockSalesScreen.jsx')).ProductRow
  const sheets = await vite.ssrLoadModule('/src/features/sales/MockSalesSheets.jsx')
  ;({ CartSheet, SalesHistorySheet } = sheets)
  SaleCompletedSheet = (await vite.ssrLoadModule('/src/features/sales/SaleReceipt.jsx')).SaleCompletedSheet
})
after(async () => { await vite?.close() })

describe('production POS voice UI', () => {
  test('renders the responsive Sales redesign with a real-catalog loading state', () => {
    for (const role of ['OWNER', 'WAREHOUSE']) {
      const html = renderToStaticMarkup(createElement(SalesPage, { profile: {
        user: { id: 'user', role, isActive: true, name: 'Employee' },
        account: { id: 'account', status: 'ACTIVE', baseCurrency: 'USD', name: 'Store' },
      } }))
      // The store's daily revenue is OWNER-only (like the Dashboard); every role sees the receipt count.
      if (role === 'OWNER') assert.match(html, /Sales today/u)
      else assert.doesNotMatch(html, /Sales today/u)
      assert.match(html, /receipts/u)
      assert.match(html, /<h1>Sell<\/h1>/u)
      assert.doesNotMatch(html, /Sell products|mock-pos-logo|mock-pos-history-button|\+ Edit|Change category/u)
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

  const cartLine = { key: 'v1', variantId: 'v1', productId: 'p1', colorId: 'c1', productName: 'Linen shirt', colorName: 'Blue', size: 'M', priceCents: 2400, quantity: 2, stock: 5 }
  const cartProps = { cart: [cartLine], currency: 'USD', discount: 10, canDiscount: true, onDiscount() {}, onQuantity() {}, onRemove() {}, onClear() {}, onComplete() {}, onDiscard() {}, onHistory() {}, onClose() {} }

  test('the cart offers a plain Complete sale button with no payment method and shows the discount to owners only', () => {
    const owner = renderToStaticMarkup(createElement(CartSheet, cartProps))
    assert.match(owner, /Complete sale/u)
    assert.match(owner, /Discount/u)
    assert.doesNotMatch(owner, /Payment method|Cash|Card/u)
    assert.match(owner, /\$43\.20/u)
    // The total and the amount on the button stay in the sheet footer, outside the scrolling lines.
    const footer = owner.slice(owner.indexOf('mock-pos-sheet-footer'))
    assert.ok(footer.includes('Total'))
    assert.ok(footer.includes('Subtotal'))
    assert.ok(footer.includes('Discount (10%)'))
    assert.ok(footer.includes('Complete sale · $43.20'))
    assert.equal(owner.slice(0, owner.indexOf('mock-pos-sheet-footer')).includes('mock-pos-totals'), false)
    const noDiscount = renderToStaticMarkup(createElement(CartSheet, { ...cartProps, discount: 0 }))
    assert.ok(noDiscount.includes('Complete sale · $48'))
    assert.equal(noDiscount.includes('Discount ('), false, 'subtotal and discount rows only appear with a discount')
    assert.equal(renderToStaticMarkup(createElement(CartSheet, { ...cartProps, cart: [] })).includes('Complete sale · '), false)
    const warehouse = renderToStaticMarkup(createElement(CartSheet, { ...cartProps, canDiscount: false, discount: 0 }))
    assert.doesNotMatch(warehouse, /<h3>Discount<\/h3>/u)
  })

  test('while submitting, the button shows a loading state and every edit control is disabled', () => {
    const html = renderToStaticMarkup(createElement(CartSheet, { ...cartProps, busy: true }))
    assert.match(html, /Completing sale/u)
    assert.match(html, /aria-busy="true"/u)
    assert.doesNotMatch(html, /Clear cart/u)
    assert.match(html, /class="mock-pos-remove" disabled=""/u)
  })

  test('after an unconfirmed sale the cart is locked and offers Try again, history and cancel', () => {
    const html = renderToStaticMarkup(createElement(CartSheet, { ...cartProps, locked: true, message: 'We could not confirm the sale.' }))
    assert.match(html, /We could not confirm the sale/u)
    assert.match(html, />Try again</u)
    assert.match(html, /Check sales history/u)
    assert.match(html, /Cancel this sale/u)
    assert.doesNotMatch(html, /Complete sale/u)
    assert.match(html, /class="mock-pos-remove" disabled=""/u)
  })

  test('a stock failure marks the short item and blocks Complete sale without changing the cart', () => {
    const html = renderToStaticMarkup(createElement(CartSheet, { ...cartProps, message: 'Some items do not have enough stock.', blocked: true,
      cart: [{ ...cartLine, quantity: 3, stock: 2 }], issues: [{ key: 'v1', kind: 'short', available: 2, label: 'Linen shirt' }] }))
    assert.match(html, /Only 2 left/u)
    assert.match(html, /Some items do not have enough stock/u)
    assert.match(html, /mock-pos-primary"[^>]*disabled/u)
  })

  const receiptSale = { id: 'a1b2c3d4-0000-4000-8000-000000000000', currency: 'USD', subtotal: '43.20', totalAmount: '43.20', createdAt: '2026-10-14T10:30:00.000Z',
    items: [{ id: 'i1', productName: 'Linen shirt', color: 'Blue', size: 'M', quantity: 2, unitSoldPrice: '21.60', lineTotal: '43.20' }] }

  test('the completed sale is a full receipt with share, print and a main New sale button', () => {
    const summary = { discountPercent: 10, listSubtotalCents: 4800, totalCents: 4320 }
    const html = renderToStaticMarkup(createElement(SaleCompletedSheet, { completed: { sale: receiptSale, summary, replay: false }, storeName: 'Mini Store', onNewSale() {} }))
    for (const part of ['Sale completed', '#A1B2C3D4', 'Mini Store', 'Linen shirt', 'Blue · M', '2 × $21.60', 'Subtotal', '$48', 'Discount (10%)', '$4.80',
      '$43.20', 'Share on WhatsApp', 'Print / PDF', 'New sale', 'Thank you!', '<time']) {
      assert.ok(html.includes(part), part)
    }
    assert.doesNotMatch(html, /Payment|Cash|Card/u)
    assert.ok(html.indexOf('Print / PDF') < html.indexOf('New sale'), 'New sale is the last, main action')
    assert.match(html, /class="mock-pos-primary"[^>]*>New sale/u)
  })

  test('a receipt without a discount hides the subtotal and discount rows', () => {
    const summary = { discountPercent: 0, listSubtotalCents: 4320, totalCents: 4320 }
    const html = renderToStaticMarkup(createElement(SaleCompletedSheet, { completed: { sale: receiptSale, summary, replay: true }, onNewSale() {} }))
    assert.doesNotMatch(html, /Subtotal|Discount/u)
    assert.match(html, /Confirmed from the original attempt/u)
  })

  test('sales history reads server sales and hides amounts from non-owners', () => {
    const state = { kind: 'ready', truncated: false, sales: [{ id: 'a1b2c3d4-0000-4000-8000-000000000000', status: 'VOIDED', currency: 'USD', totalAmount: '43.20', totalUnits: 2, createdAt: '2026-10-14T10:30:00.000Z' }] }
    const owner = renderToStaticMarkup(createElement(SalesHistorySheet, { state, role: 'OWNER', currency: 'USD', onRetry() {}, onClose() {} }))
    assert.match(owner, /#A1B2C3D4/u)
    assert.match(owner, /Voided/u)
    assert.match(owner, /\$43\.20/u)
    const warehouse = renderToStaticMarkup(createElement(SalesHistorySheet, { state, role: 'WAREHOUSE', currency: 'USD', onRetry() {}, onClose() {} }))
    assert.doesNotMatch(warehouse, /43.20/u)
    assert.match(renderToStaticMarkup(createElement(SalesHistorySheet, { state: { kind: 'error', message: 'Sales are temporarily unavailable.', sales: [] }, role: 'OWNER', onRetry() {}, onClose() {} })), /Try again/u)
  })

  const product = (overrides = {}) => ({ id: 'p1', name: 'Chemis seda', imageUrl: null, icon: 'shirt', priceCents: 1500, priceMaxCents: 1500,
    colors: [{ id: 'c1', name: 'Black', hex: '#202522', sizes: [] }], ...overrides })
  const row = (available, overrides = {}) => renderToStaticMarkup(createElement(ProductRow, { product: product(overrides), availableStock: available, currency: 'USD', onOpen() {} }))

  test('a product row is compact: name, price, color count and a stock badge, with no edit button', () => {
    const html = row(10)
    assert.ok(html.includes('Chemis seda') && html.includes('$15') && html.includes('1 color<'))
    assert.equal(html.includes('1 colors'), false)
    assert.match(html, /mock-pos-stock is-ok">10 in stock/u)
    assert.doesNotMatch(html, /mock-pos-product-edit|Change category/u)
    assert.equal((html.match(/<button/g) || []).length, 1)
    assert.ok(row(3, { colors: [{ id: 'a', name: 'A', hex: '#111', sizes: [] }, { id: 'b', name: 'B', hex: '#222', sizes: [] }] }).includes('2 colors<'))
  })

  test('stock badges are distinct: low is a warning, out is red and disables the row, normal is neutral', () => {
    assert.match(row(3), /mock-pos-stock is-low">Low · 3 left/u)
    const out = row(0)
    assert.match(out, /mock-pos-stock is-out">Out of stock/u)
    assert.match(out, /mock-pos-product is-out/u)
    assert.match(out, /<button type="button" class="mock-pos-product-main" disabled=""/u)
    assert.doesNotMatch(row(10), /is-low|is-out/u)
  })

  test('product prices use the compact money format, with a range shown as From', () => {
    assert.ok(row(10, { priceCents: 1250, priceMaxCents: 1250 }).includes('$12.50'))
    assert.ok(row(10, { priceCents: 1200, priceMaxCents: 1800 }).includes('From $12'))
  })
})
