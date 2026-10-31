import { useEffect, useMemo, useRef, useState } from 'react'
import { getProduct } from '../products/product-flow.js'
import { addCartSelection, cartTotals, cartUnits, decrementCatalogStock, money, plural, productStock, reconcileMockCart,
  restoreMockCartLine, setMockCartQuantity, setMockLinePrice, stockBadge, UNCATEGORIZED_ID } from './mock-sales-model.js'
import { analyzeCart, checkoutFailure, effectiveDiscount, hasBlockingIssue, prepareCheckout, startOfLocalDayIso, summarizeSales } from './pos-checkout.js'
import { createCheckoutGuard, loadSaleHistory, submitSale } from './sale-flow.js'
import { DEFAULT_PAYMENT, paymentFromPayload } from './payment.js'
import { loadSettings } from '../settings/settings-flow.js'
import { browserMockSalesStorage } from './mock-sales-storage.js'
import { loadSalesCatalog, mapCatalogProduct, searchLoadedCatalogByVoice, voiceCatalogSelection } from './sales-catalog.js'
import { requestTextMatch } from '../voice-sales/text-matching-flow.js'
import { CartSheet, ProductPickerSheet, SalesHistorySheet } from './MockSalesSheets.jsx'
import { SaleCompletedSheet } from './SaleReceipt.jsx'
import './mock-sales.css'
import { useI18n } from '../../i18n/I18nContext.js'

const SALES_VOICE_SEARCH_LANGUAGE = 'ar-LB'
const RESTORED_CHECKOUT_MESSAGE = 'A sale was still being confirmed when this page closed. It may have gone through. Press Try again: it will not create a duplicate.'
const IDLE_CHECKOUT = Object.freeze({ phase: 'idle', locked: false, message: '', issues: [] })

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
}

function MicIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" /></svg>
}

function GarmentIcon({ type }) {
  if (type === 'pants' || type === 'shorts') return <svg viewBox="0 0 52 52" aria-hidden="true"><path d="M17 9h18l2 34-10-1-1-18-1 18-10 1 2-34Z" /></svg>
  if (type === 'hoodie') return <svg viewBox="0 0 52 52" aria-hidden="true"><path d="M19 12c1-5 13-5 14 0l7 6-5 8-3-3v20H20V23l-3 3-5-8 7-6Zm2 1c2 3 8 3 10 0" /></svg>
  if (type === 'shirt') return <svg viewBox="0 0 52 52" aria-hidden="true"><path d="m19 10 7 4 7-4 8 7-5 8-3-3v21H19V22l-3 3-5-8 8-7Zm3 3 4 5 4-5M26 18v25" /></svg>
  return <svg viewBox="0 0 52 52" aria-hidden="true"><path d="m18 11 8 4 8-4 8 8-6 7-3-3v20H19V23l-3 3-6-7 8-8Z" /></svg>
}

function productPrice(product, currency) {
  if (!Number.isSafeInteger(product.priceCents)) return 'Price missing'
  return product.priceMaxCents !== product.priceCents
    ? `From ${money(product.priceCents, currency)}`
    : money(product.priceCents, currency)
}

// Today's sales come from the server (the same sales the Dashboard and Reports count).
async function fetchTodaySales(supabase) {
  const from = startOfLocalDayIso()
  const sales = []
  let cursor = null
  let truncated = false
  for (let page = 0; page < 5; page += 1) {
    const result = await loadSaleHistory({ supabase, limit: 100, cursor, from })
    if (!result.ok) return { kind: 'error', message: result.message, requiresLogin: result.requiresLogin === true }
    sales.push(...result.sales)
    cursor = result.nextCursor
    if (!cursor) break
    truncated = page === 4
  }
  return { kind: 'ready', sales, truncated }
}

function applyTodaySales(setToday, result) {
  if (result.requiresLogin) { window.location.replace('/login'); return }
  setToday(current => result.kind === 'error' ? { ...current, kind: 'error', message: result.message } : result)
}

export function ProductRow({ product, availableStock, currency, onOpen }) {
  const { t } = useI18n()
  const badge = stockBadge(availableStock, t)
  return <article className={`mock-pos-product${availableStock === 0 ? ' is-out' : ''}`}>
    <button type="button" className="mock-pos-product-main" disabled={availableStock === 0} onClick={onOpen}>
      <span className="mock-pos-product-art" style={{ '--garment': product.colors[0]?.hex || '#829182' }}>
        {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : <GarmentIcon type={product.icon} />}
      </span>
      <span className="mock-pos-product-copy">
        <span className="mock-pos-product-line"><strong>{product.name}</strong><b>{productPrice(product, currency)}</b></span>
        <span className="mock-pos-product-line"><small>{plural(product.colors.length, 'color', t)}</small><small className={`mock-pos-stock ${badge.tone}`}>{t(badge.text)}</small></span>
      </span>
    </button>
  </article>
}

export function MockSalesScreen({ supabase, role = 'OWNER', currency = 'USD', storageScope = '', storeName = '' }) {
  const { t } = useI18n()
  const storage = useMemo(() => browserMockSalesStorage(), [])
  const [salesState, setSalesState] = useState({ categories: [], products: [] })
  const [catalog, setCatalog] = useState({ kind: 'loading', complete: true })
  const [catalogVersion, setCatalogVersion] = useState(0)
  const [initialCart] = useState(() => storage.loadCart(storageScope))
  const [restoredCheckout] = useState(() => {
    const record = storage.loadCheckout(storageScope)
    return record && initialCart.length ? record : null
  })
  const [cart, setCart] = useState(initialCart)
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [sheet, setSheet] = useState(null)
  const [discount, setDiscount] = useState(restoredCheckout?.summary.discountPercent ?? 0)
  const [payment, setPayment] = useState(() => restoredCheckout ? paymentFromPayload(restoredCheckout.payload) : DEFAULT_PAYMENT)
  // Lebanese pounds per dollar, set by the owner; null hides the pound amounts.
  const [rate, setRate] = useState(null)
  const [checkout, setCheckout] = useState(() => restoredCheckout ? { ...IDLE_CHECKOUT, locked: true, message: RESTORED_CHECKOUT_MESSAGE } : IDLE_CHECKOUT)
  const [completed, setCompleted] = useState(null)
  const [today, setToday] = useState({ kind: 'loading', sales: [], truncated: false })
  const operationRef = useRef(restoredCheckout ? { operation: { key: restoredCheckout.key, payload: restoredCheckout.payload, signature: restoredCheckout.signature }, summary: restoredCheckout.summary } : null)
  const checkoutGuard = useRef(createCheckoutGuard())
  const submitting = useRef(false)
  const [toast, setToast] = useState('')
  const [undo, setUndo] = useState(null)
  const cartRef = useRef(cart)
  useEffect(() => { cartRef.current = cart }, [cart])
  const [voiceMessage, setVoiceMessage] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceCatalogFilter, setVoiceCatalogFilter] = useState(null)
  const recognition = useRef(null)
  const voiceSearchRevision = useRef(0)

  useEffect(() => { storage.saveCart(storageScope, cart) }, [cart, storage, storageScope])
  useEffect(() => {
    let active = true
    void loadSettings({ supabase }).then(result => { if (active && result.ok) setRate(result.lbpPerUsd) })
    return () => { active = false }
  }, [supabase])
  useEffect(() => {
    const controller = new AbortController()
    void loadSalesCatalog({ supabase, signal: controller.signal }).then(result => {
      if (controller.signal.aborted || result.aborted) return
      if (!result.ok) {
        if (result.requiresLogin) window.location.replace('/login')
        else if (result.requiresAccountReview) window.location.replace('/pending-approval')
        else setCatalog({ kind: 'error', message: result.message, complete: true })
        return
      }
      setSalesState(current => ({ ...current, categories: result.categories, products: result.products }))
      // A sale that may already be on the server keeps its cart untouched so its retry stays identical.
      const reconciled = operationRef.current ? { changed: false } : reconcileMockCart(cartRef.current, result.products)
      if (reconciled.changed) { setCart(reconciled.cart); setToast(t('Your saved cart was updated to match current prices and stock.')) }
      setCatalog({ kind: 'ready', complete: result.complete, total: result.total, refreshing: false })
    })
    return () => controller.abort()
  }, [catalogVersion, supabase, t])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (!undo) return undefined
    const timer = window.setTimeout(() => setUndo(null), 6000)
    return () => window.clearTimeout(timer)
  }, [undo])

  const todaySummary = today.kind === 'ready' ? summarizeSales(today.sales, currency) : null
  const activeDiscount = effectiveDiscount(role, discount)
  const busy = checkout.phase === 'submitting'
  const uncategorizedVisible = salesState.products.some(product => product.categoryId === UNCATEGORIZED_ID)
  const visibleCategories = uncategorizedVisible
    ? [...salesState.categories, { id: UNCATEGORIZED_ID, name: 'Uncategorized' }] : salesState.categories
  const reservedByProduct = productId => cart.filter(line => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0)
  const productAvailable = product => Math.max(0, productStock(product) - reservedByProduct(product.id))
  const products = salesState.products.filter(product => {
    const needle = query.trim().toLocaleLowerCase()
    const voiceFilterCurrent = voiceCatalogFilter?.query === query
    const matchesVoiceProduct = voiceFilterCurrent && voiceCatalogFilter.productIds.length > 0
      ? voiceCatalogFilter.productIds.includes(product.id) : null
    const matchesVoiceCategory = voiceFilterCurrent && voiceCatalogFilter.productIds.length === 0
      && voiceCatalogFilter.categoryIds.length > 0 ? voiceCatalogFilter.categoryIds.includes(product.categoryId) : null
    const voiceMatch = matchesVoiceProduct ?? matchesVoiceCategory
    const matchesSearch = !needle || (voiceMatch
      ?? (product.name.toLocaleLowerCase().includes(needle) || product.skus.some(sku => sku.toLocaleLowerCase().includes(needle))))
    const matchesCategory = categoryId === 'all' || product.categoryId === categoryId
    return matchesSearch && matchesCategory
  })
  const totals = cartTotals(cart, activeDiscount)

  async function searchVoiceCatalog(transcript) {
    const revision = ++voiceSearchRevision.current
    setQuery(transcript)
    setVoiceCatalogFilter(null)
    setVoiceMessage(t('Searching your catalog…'))
    const response = await requestTextMatch({ supabase, text: transcript })
    if (revision !== voiceSearchRevision.current) return
    const localProductIds = searchLoadedCatalogByVoice(transcript, salesState.products)
    if (!response.ok) {
      if (localProductIds.length) {
        setVoiceCatalogFilter({ query: transcript, productIds: localProductIds, categoryIds: [] })
        setVoiceMessage(`${localProductIds.length} matching ${localProductIds.length === 1 ? 'product' : 'products'} found locally. Engine: ${response.message}`)
        return
      }
      setVoiceMessage(response.message || t('Voice catalog search is unavailable. Try typing the product name.'))
      return
    }
    const engineSelection = voiceCatalogSelection(response.result)
    const selection = localProductIds.length
      ? { productIds: localProductIds, categoryIds: engineSelection.categoryIds }
      : engineSelection
    setVoiceCatalogFilter({ query: transcript, ...selection })
    const matchedProducts = selection.productIds.length
      ? salesState.products.filter(product => selection.productIds.includes(product.id)).length
      : salesState.products.filter(product => selection.categoryIds.includes(product.categoryId)).length
    setVoiceMessage(matchedProducts
      ? `${matchedProducts} matching ${matchedProducts === 1 ? 'product' : 'products'} found.`
      : t('No matching product was found in this store catalog.'))
  }

  function startVoiceSearch() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) { setVoiceMessage(t('Voice search is not supported in this browser. Type a product name or SKU instead.')); return }
    recognition.current?.abort()
    const instance = new Recognition()
    recognition.current = instance
    instance.lang = SALES_VOICE_SEARCH_LANGUAGE
    instance.interimResults = false
    instance.maxAlternatives = 1
    instance.onstart = () => { setListening(true); setVoiceMessage(t('Listening in Lebanese Arabic…')) }
    instance.onresult = event => { void searchVoiceCatalog(event.results[0][0].transcript) }
    instance.onerror = () => setVoiceMessage(t('Voice search could not hear that. Try again or type the product name.'))
    instance.onend = () => setListening(false)
    instance.start()
  }

  function addToCart(product, color, size, quantity) {
    if (busy || checkout.locked) return { ok: false, message: t('Finish or cancel the sale being confirmed before adding more items.') }
    const result = addCartSelection(cart, product, color, size, quantity)
    if (result.ok) { setCart(result.cart); setToast(t('{name} added to cart.', { name: product.name })) }
    return result
  }

  function removeCartLine(key) {
    const index = cart.findIndex(line => line.key === key)
    if (index < 0) return
    const line = cart[index]
    setCart(current => current.filter(row => row.key !== key))
    setToast('')
    setUndo({ message: t('{productName} removed from cart.', { productName: line.productName }), restore: () => setCart(current => restoreMockCartLine(current, line, index)) })
  }

  function clearCart() {
    const previous = cart
    setCart([]); setSheet(null); setToast('')
    setUndo({ message: t('Cart cleared.'), restore: () => setCart(current => current.length ? current : previous) })
  }

  function reloadToday() { void fetchTodaySales(supabase).then(result => applyTodaySales(setToday, result)) }

  useEffect(() => {
    let active = true
    void fetchTodaySales(supabase).then(result => { if (active) applyTodaySales(setToday, result) })
    return () => { active = false }
  }, [supabase])

  // Loads fresh stock and prices for only the products involved in a sale.
  async function fetchFreshProducts(productIds) {
    const results = await Promise.all(productIds.map(productId => getProduct({ supabase, productId })))
    const fetched = new Set()
    const products = []
    const removed = []
    results.forEach((result, index) => {
      if (!result.ok) return
      fetched.add(productIds[index])
      if (result.product.isActive) products.push(mapCatalogProduct(result.product))
      else removed.push(productIds[index])
    })
    setSalesState(current => ({ ...current,
      products: current.products.filter(product => !removed.includes(product.id)).map(product => products.find(fresh => fresh.id === product.id) || product) }))
    return { fetched, products, failed: fetched.size < productIds.length }
  }

  async function refreshCartFromServer(prices) {
    const lines = cartRef.current
    const fresh = await fetchFreshProducts([...new Set(lines.map(line => line.productId))])
    const analysis = analyzeCart(lines.filter(line => fresh.fetched.has(line.productId)), fresh.products, { prices })
    const updated = new Map(analysis.cart.map(line => [line.key, line]))
    setCart(current => current.map(line => updated.get(line.key) || line))
    setCheckout(current => ({ ...current, issues: analysis.issues,
      message: fresh.failed ? t('{message} Some stock could not be refreshed.', { message: current.message }) : current.message }))
  }

  function finishSale(result, summary, soldLines) {
    storage.saveCheckout(storageScope, null)
    operationRef.current = null
    // A replayed sale is already counted in the stock that was loaded; a new one is applied now and confirmed by the refresh below.
    if (!result.idempotentReplay) setSalesState(current => ({ ...current, products: decrementCatalogStock(current.products, soldLines) }))
    setCart([]); setDiscount(0); setPayment(DEFAULT_PAYMENT); setUndo(null); setToast('')
    setCheckout(IDLE_CHECKOUT)
    setCompleted({ sale: result.sale, summary, replay: result.idempotentReplay })
    setSheet('receipt')
    void fetchFreshProducts([...new Set(soldLines.map(line => line.productId))])
    reloadToday()
  }

  async function completeSale() {
    if (submitting.current) return
    const retrying = checkout.locked && operationRef.current
    const prepared = retrying
      ? { ok: true, operation: operationRef.current.operation, summary: operationRef.current.summary }
      : prepareCheckout({ cart, role, discountPercent: discount, payment, current: operationRef.current?.operation ?? null })
    if (!prepared.ok) { setCheckout(current => ({ ...current, message: prepared.message })); return }
    operationRef.current = { operation: prepared.operation, summary: prepared.summary }
    // Saved before sending: if the page closes mid-request, the same Idempotency-Key is reused.
    storage.saveCheckout(storageScope, { ...prepared.operation, summary: prepared.summary })
    const soldLines = cart
    submitting.current = true
    setCheckout(current => ({ ...current, phase: 'submitting', message: '', issues: [] }))
    let result
    try {
      const guarded = await checkoutGuard.current.run(() => submitSale({ supabase, operation: prepared.operation }))
      result = guarded.skipped ? null : guarded.value
    } catch {
      result = { ok: false, retryable: true, code: 'NETWORK_ERROR' }
    } finally {
      submitting.current = false
    }
    if (!result) return
    if (result.ok) { finishSale(result, prepared.summary, soldLines); return }
    const failure = checkoutFailure(result)
    if (failure.uncertain) { setCheckout({ phase: 'idle', locked: true, message: failure.message, issues: [] }); return }
    storage.saveCheckout(storageScope, null)
    if (failure.requiresLogin) { window.location.replace('/login'); return }
    setCheckout({ phase: 'idle', locked: false, message: failure.message, issues: [] })
    if (failure.refresh) await refreshCartFromServer(failure.refresh === 'prices')
  }

  function discardCheckout() {
    storage.saveCheckout(storageScope, null)
    operationRef.current = null
    setCheckout(IDLE_CHECKOUT)
  }

  const selectedProduct = sheet && typeof sheet === 'object'
    ? salesState.products.find(product => product.id === sheet.productId) : null
  return <section className="mock-pos-page" aria-label={t('Sales point of sale')}>
    <div className="mock-pos-shell">
      <header className="mock-pos-header"><h1>{t('Sell')}</h1>
        <button type="button" className="mock-pos-today" aria-label={t('Today\'s sales: open the list')} onClick={() => setSheet('history')}>
          {role === 'OWNER' ? <><span>{t('Sales today')}</span><strong>{todaySummary ? todaySummary.total : '—'}</strong><span aria-hidden="true">·</span></> : <span>{t('Today')}</span>}
          <strong>{todaySummary ? todaySummary.count : '—'}</strong><span>{todaySummary?.count === 1 ? 'receipt' : 'receipts'}</span><ChevronIcon />
        </button>
      </header>

      <div className="mock-pos-search"><SearchIcon /><label className="sr-only" htmlFor="mock-pos-search">{t('Search products')}</label>
        <input id="mock-pos-search" type="search" value={query} placeholder={t('Search products')} onChange={event => {
          voiceSearchRevision.current += 1
          setVoiceCatalogFilter(null)
          setQuery(event.target.value)
        }} />
        <button type="button" className={listening ? 'is-listening' : ''} aria-label={t('Search with voice')} onClick={startVoiceSearch}><MicIcon /></button>
      </div>
      {voiceMessage && <p className="mock-pos-voice-message" role="status">{voiceMessage}</p>}

      <nav className="mock-pos-chips" aria-label={t('Product categories')}><button type="button" aria-pressed={categoryId === 'all'} onClick={() => setCategoryId('all')}>{t('All')}</button>
        {visibleCategories.map(category => <button key={category.id} type="button" aria-pressed={categoryId === category.id}
          onClick={() => setCategoryId(category.id)}>{category.name}</button>)}
      </nav>

      <main className="mock-pos-products" aria-live="polite" aria-busy={catalog.kind === 'loading' || catalog.refreshing === true}>
        <div className="mock-pos-list-heading"><h2>{t('Products')}</h2><span>{catalog.kind === 'ready' ? plural(products.length, 'product', t) : t('Live catalog')}</span></div>
        {catalog.kind === 'loading' && <div className="mock-pos-catalog-state" role="status"><span className="mock-pos-spinner" />{t('Loading real products…')}</div>}
        {catalog.kind === 'error' && <div className="mock-pos-catalog-state is-error" role="alert"><strong>{t('Products could not load')}</strong><p>{t(catalog.message)}</p>
          <button type="button" onClick={() => { setCatalog({ kind: 'loading', complete: true }); setCatalogVersion(version => version + 1) }}>{t('Try again')}</button></div>}
        {catalog.kind === 'ready' && !catalog.complete && <p className="mock-pos-catalog-note">{t('Showing the first {length} of {total} products. Search coverage is limited.', { length: salesState.products.length, total: catalog.total })}</p>}
        {catalog.kind === 'ready' && products.length ? products.map(product => <ProductRow key={product.id} product={product} currency={currency}
          availableStock={productAvailable(product)} onOpen={() => setSheet({ type: 'product', productId: product.id })} />)
          : catalog.kind === 'ready' && <div className="mock-pos-empty"><strong>{t('No products found')}</strong><p>{t('Try another name, SKU, or category.')}</p></div>}
      </main>

      {cart.length ? <footer className="mock-pos-sticky"><button type="button" className="mock-pos-primary" onClick={() => setSheet('cart')}>
        <span>{t('View cart ·')} {plural(cartUnits(cart), 'item', t)}</span><strong>{money(totals.totalCents, currency)}</strong>
      </button></footer> : <div className="mock-pos-end-space" aria-hidden="true" />}
    </div>

    {sheet === 'cart' && <CartSheet cart={cart} currency={currency} discount={activeDiscount} canDiscount={role === 'OWNER'} onPrice={(key, cents) => setCart(current => setMockLinePrice(current, key, cents))}
      payment={payment} onPayment={setPayment} rate={currency === 'USD' ? rate : null}
      busy={busy} locked={checkout.locked} message={checkout.message} issues={checkout.issues} blocked={hasBlockingIssue(cart)}
      onQuantity={(key, quantity) => setCart(current => setMockCartQuantity(current, key, quantity))}
      onRemove={removeCartLine} onClear={clearCart} onComplete={completeSale} onDiscard={discardCheckout}
      onHistory={() => setSheet('history')} onClose={() => { if (!busy) setSheet(null) }} />}
    {sheet === 'history' && <SalesHistorySheet state={today} role={role} currency={currency} onRetry={reloadToday} onClose={() => setSheet(null)} />}
    {sheet === 'receipt' && completed && <SaleCompletedSheet completed={completed} storeName={storeName} onNewSale={() => { setSheet(null); setCompleted(null) }} />}
    {sheet?.type === 'product' && selectedProduct && <ProductPickerSheet key={selectedProduct.id} product={selectedProduct} cart={cart} currency={currency}
      onAdd={addToCart} onClose={() => setSheet(null)} />}
    {undo ? <div className="mock-pos-toast has-action" role="status"><span>{t(undo.message)}</span>
      <button type="button" onClick={() => { undo.restore(); setUndo(null) }}>{t('Undo')}</button></div>
      : toast && <div className="mock-pos-toast" role="status">{toast}</div>}
  </section>
}
