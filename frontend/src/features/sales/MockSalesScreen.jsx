import { useEffect, useMemo, useRef, useState } from 'react'
import { createCategory, deleteCategory as deleteRealCategory, renameCategory as renameRealCategory } from '../categories/category-flow.js'
import { updateProduct } from '../products/product-flow.js'
import { addCartSelection, cartTotals, cartUnits, completeMockSale, money, productStock,
  setMockCartQuantity, UNCATEGORIZED_ID } from './mock-sales-model.js'
import { browserMockSalesStorage } from './mock-sales-storage.js'
import { loadSalesCatalog, mapCatalogProduct, searchLoadedCatalogByVoice, voiceCatalogSelection } from './sales-catalog.js'
import { requestTextMatch } from '../voice-sales/text-matching-flow.js'
import { CartSheet, CategoryManagerSheet, ProductCategorySheet, ProductPickerSheet, SalesHistorySheet } from './MockSalesSheets.jsx'
import './mock-sales.css'

const SALES_VOICE_SEARCH_LANGUAGE = 'ar-LB'

function HistoryIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68M4 4v4.68h4.68M12 8v4l2.6 1.6" /></svg>
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

function ProductRow({ product, availableStock, currency, onOpen, onEdit }) {
  const low = availableStock > 0 && availableStock <= 5
  return <article className={`mock-pos-product${availableStock === 0 ? ' is-out' : ''}`}>
    <button type="button" className="mock-pos-product-main" disabled={availableStock === 0} onClick={onOpen}>
      <span className="mock-pos-product-art" style={{ '--garment': product.colors[0]?.hex || '#829182' }}>
        {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : <GarmentIcon type={product.icon} />}
      </span>
      <span className="mock-pos-product-copy"><strong>{product.name}</strong><small>{product.colors.length} colors</small></span>
      <span className="mock-pos-product-price"><strong>{productPrice(product, currency)}</strong>
        <small className={availableStock === 0 ? 'is-out' : low ? 'is-low' : ''}>
          {availableStock === 0 ? 'Out of stock' : low ? `Low · ${availableStock} in stock` : `${availableStock} in stock`}
        </small>
      </span>
    </button>
    <button type="button" className="mock-pos-product-edit" aria-label={`Change category for ${product.name}`} onClick={onEdit}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6 4 16ZM14 7.5l2.5 2.5" /></svg>
    </button>
  </article>
}

function sameLocalDay(iso, now = new Date()) {
  const date = new Date(iso)
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

export function MockSalesScreen({ supabase, role = 'OWNER', currency = 'USD' }) {
  const storage = useMemo(() => browserMockSalesStorage(), [])
  const [salesState, setSalesState] = useState(() => ({ categories: [], products: [], receipts: storage.load().receipts }))
  const [catalog, setCatalog] = useState({ kind: 'loading', complete: true })
  const [catalogVersion, setCatalogVersion] = useState(0)
  const [cart, setCart] = useState([])
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [sheet, setSheet] = useState(null)
  const [discount, setDiscount] = useState(0)
  const [payment, setPayment] = useState('Cash')
  const [toast, setToast] = useState('')
  const [voiceMessage, setVoiceMessage] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceCatalogFilter, setVoiceCatalogFilter] = useState(null)
  const recognition = useRef(null)
  const voiceSearchRevision = useRef(0)

  useEffect(() => { storage.save({ receipts: salesState.receipts }) }, [salesState.receipts, storage])
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
      setCatalog({ kind: 'ready', complete: result.complete, total: result.total, refreshing: false })
    })
    return () => controller.abort()
  }, [catalogVersion, supabase])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const todayReceipts = salesState.receipts.filter(receipt => sameLocalDay(receipt.createdAt))
  const todayTotal = todayReceipts.reduce((sum, receipt) => sum + receipt.totalCents, 0)
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
  const totals = cartTotals(cart, discount)

  async function searchVoiceCatalog(transcript) {
    const revision = ++voiceSearchRevision.current
    setQuery(transcript)
    setVoiceCatalogFilter(null)
    setVoiceMessage('Searching your catalog…')
    const response = await requestTextMatch({ supabase, text: transcript })
    if (revision !== voiceSearchRevision.current) return
    const localProductIds = searchLoadedCatalogByVoice(transcript, salesState.products)
    if (!response.ok) {
      if (localProductIds.length) {
        setVoiceCatalogFilter({ query: transcript, productIds: localProductIds, categoryIds: [] })
        setVoiceMessage(`${localProductIds.length} matching ${localProductIds.length === 1 ? 'product' : 'products'} found locally. Engine: ${response.message}`)
        return
      }
      setVoiceMessage(response.message || 'Voice catalog search is unavailable. Try typing the product name.')
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
      : 'No matching product was found in this store catalog.')
  }

  function startVoiceSearch() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) { setVoiceMessage('Voice search is not supported in this browser. Type a product name or SKU instead.'); return }
    recognition.current?.abort()
    const instance = new Recognition()
    recognition.current = instance
    instance.lang = SALES_VOICE_SEARCH_LANGUAGE
    instance.interimResults = false
    instance.maxAlternatives = 1
    instance.onstart = () => { setListening(true); setVoiceMessage('Listening in Lebanese Arabic…') }
    instance.onresult = event => { void searchVoiceCatalog(event.results[0][0].transcript) }
    instance.onerror = () => setVoiceMessage('Voice search could not hear that. Try again or type the product name.')
    instance.onend = () => setListening(false)
    instance.start()
  }

  function addToCart(product, color, size, quantity) {
    const result = addCartSelection(cart, product, color, size, quantity)
    if (result.ok) { setCart(result.cart); setToast(`${product.name} added to cart.`) }
    return result
  }

  async function addCategory(name) {
    const result = await createCategory({ supabase, name })
    if (!result.ok) return result
    setSalesState(current => ({ ...current, categories: [...current.categories, result.category]
      .sort((left, right) => left.name.localeCompare(right.name)) }))
    return result
  }

  async function renameCategory(id, name) {
    const current = salesState.categories.find(category => category.id === id)
    const result = await renameRealCategory({ supabase, categoryId: id, currentName: current?.name || '', name })
    if (!result.ok) return result
    if (!result.unchanged) setSalesState(state => ({ ...state,
      categories: state.categories.map(category => category.id === id ? result.category : category)
        .sort((left, right) => left.name.localeCompare(right.name)),
      products: state.products.map(product => product.categoryId === id ? { ...product, categoryName: result.category.name } : product),
    }))
    return result
  }

  async function deleteCategory(id) {
    const result = await deleteRealCategory({ supabase, categoryId: id })
    if (!result.ok) return result
    setSalesState(current => ({ ...current, categories: current.categories.filter(category => category.id !== id) }))
    if (categoryId === id) setCategoryId('all')
    return result
  }

  async function moveProduct(productId, nextCategoryId) {
    const product = salesState.products.find(item => item.id === productId)
    if (!product) return { ok: false, message: 'This product is no longer available. Refresh and try again.' }
    const result = await updateProduct({ supabase, productId, role, current: product.sourceProduct,
      draft: { name: product.name, categoryId: nextCategoryId, profitMarginOverride: product.sourceProduct.profitMarginOverride } })
    if (!result.ok) return result
    const mapped = mapCatalogProduct(result.product)
    setSalesState(current => ({ ...current, products: current.products.map(item => item.id === productId ? mapped : item) }))
    setToast('Product category updated.')
    return result
  }

  function completeSale() {
    const result = completeMockSale(salesState, cart, discount, payment)
    if (!result.ok) { setToast(result.message); return }
    setSalesState(result.state); setCart([]); setDiscount(0); setPayment('Cash'); setSheet(null)
    setToast(`Sale completed · ${money(result.receipt.totalCents, currency)}`)
  }

  const selectedProduct = sheet && typeof sheet === 'object'
    ? salesState.products.find(product => product.id === sheet.productId) : null
  return <section className="mock-pos-page" aria-label="Sales point of sale">
    <div className="mock-pos-shell">
      <header className="mock-pos-header"><div className="mock-pos-brand"><span className="mock-pos-logo" aria-hidden="true">S</span>
        <div><strong>Sales</strong><span>Sell products</span></div></div>
        <button type="button" className="mock-pos-history-button" onClick={() => setSheet('history')}><HistoryIcon /><span>Sales history</span></button>
      </header>

      <section className="mock-pos-today" aria-label="Today's sales"><div><span>Sales today</span><strong>{money(todayTotal, currency)}</strong></div>
        <div><span>Receipts</span><strong>{todayReceipts.length}</strong></div></section>

      <div className="mock-pos-search"><SearchIcon /><label className="sr-only" htmlFor="mock-pos-search">Search products</label>
        <input id="mock-pos-search" type="search" value={query} placeholder="Search products" onChange={event => {
          voiceSearchRevision.current += 1
          setVoiceCatalogFilter(null)
          setQuery(event.target.value)
        }} />
        <button type="button" className={listening ? 'is-listening' : ''} aria-label="Search with voice" onClick={startVoiceSearch}><MicIcon /></button>
      </div>
      {voiceMessage && <p className="mock-pos-voice-message" role="status">{voiceMessage}</p>}

      <nav className="mock-pos-chips" aria-label="Product categories"><button type="button" aria-pressed={categoryId === 'all'} onClick={() => setCategoryId('all')}>All</button>
        {visibleCategories.map(category => <button key={category.id} type="button" aria-pressed={categoryId === category.id}
          onClick={() => setCategoryId(category.id)}>{category.name}</button>)}
        <button type="button" className="is-edit" onClick={() => setSheet('categories')}>+ Edit</button>
      </nav>

      <main className="mock-pos-products" aria-live="polite" aria-busy={catalog.kind === 'loading' || catalog.refreshing === true}>
        <div className="mock-pos-list-heading"><h1>Products</h1><span>{catalog.kind === 'ready' ? `${products.length} products` : 'Live catalog'}</span></div>
        {catalog.kind === 'loading' && <div className="mock-pos-catalog-state" role="status"><span className="mock-pos-spinner" />Loading real products…</div>}
        {catalog.kind === 'error' && <div className="mock-pos-catalog-state is-error" role="alert"><strong>Products could not load</strong><p>{catalog.message}</p>
          <button type="button" onClick={() => { setCatalog({ kind: 'loading', complete: true }); setCatalogVersion(version => version + 1) }}>Try again</button></div>}
        {catalog.kind === 'ready' && !catalog.complete && <p className="mock-pos-catalog-note">Showing the first {salesState.products.length} of {catalog.total} products. Search coverage is limited.</p>}
        {catalog.kind === 'ready' && products.length ? products.map(product => <ProductRow key={product.id} product={product} currency={currency}
          availableStock={productAvailable(product)} onOpen={() => setSheet({ type: 'product', productId: product.id })}
          onEdit={() => setSheet({ type: 'product-category', productId: product.id })} />)
          : catalog.kind === 'ready' && <div className="mock-pos-empty"><strong>No products found</strong><p>Try another name, SKU, or category.</p></div>}
      </main>

      <footer className="mock-pos-sticky"><button type="button" className="mock-pos-primary" disabled={!cart.length} onClick={() => setSheet('cart')}>
        <span>{cart.length ? `View cart · ${cartUnits(cart)} items` : 'Cart is empty'}</span><strong>{cart.length ? money(totals.totalCents, currency) : money(0, currency)}</strong>
      </button></footer>
    </div>

    {sheet === 'cart' && <CartSheet cart={cart} currency={currency} discount={discount} payment={payment} onDiscount={setDiscount} onPayment={setPayment}
      onQuantity={(key, quantity) => setCart(current => setMockCartQuantity(current, key, quantity))}
      onClear={() => { setCart([]); setSheet(null); setToast('Cart cleared.') }} onComplete={completeSale} onClose={() => setSheet(null)} />}
    {sheet === 'history' && <SalesHistorySheet receipts={todayReceipts} currency={currency} onClose={() => setSheet(null)} />}
    {sheet === 'categories' && <CategoryManagerSheet categories={salesState.categories} products={salesState.products}
      onAdd={addCategory} onRename={renameCategory} onDelete={deleteCategory} onClose={() => setSheet(null)} />}
    {sheet?.type === 'product' && selectedProduct && <ProductPickerSheet key={selectedProduct.id} product={selectedProduct} cart={cart} currency={currency}
      onAdd={addToCart} onClose={() => setSheet(null)} />}
    {sheet?.type === 'product-category' && selectedProduct && <ProductCategorySheet product={selectedProduct} categories={salesState.categories}
      onChange={moveProduct} onClose={() => setSheet(null)} />}
    {toast && <div className="mock-pos-toast" role="status">{toast}</div>}
  </section>
}
