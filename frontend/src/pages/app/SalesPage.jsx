import { useEffect, useRef, useState } from 'react'
import { loadCategories } from '../../features/categories/category-flow.js'
import { listProducts } from '../../features/products/product-flow.js'
import {
  addVariantToCart, calculateCart, checkoutOperation, createCheckoutGuard, loadSaleHistory,
  reconcileCart, removeCartLine, setCartPrice, setCartQuantity, settleCheckout, submitSale,
} from '../../features/sales/sale-flow.js'
import { formatMoney } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'
import { SaleLifecyclePanel } from '../../features/sales/SaleLifecyclePanel.jsx'
import { SalesCatalog } from '../../features/sales/SalesCatalog.jsx'
import { ProductSaleDialog } from '../../features/sales/ProductSaleDialog.jsx'
import { SaleDialog } from '../../features/sales/SaleDialog.jsx'
import '../../features/sales/sales-catalog.css'

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

function lineTotal(line, currency) {
  const total = calculateCart([line]).total
  return total === null ? 'Unavailable' : formatMoney(total, currency)
}

function Cart({ cart, currency, role, busy, onQuantity, onPrice, onRemove, onClear, onCheckout }) {
  const summary = calculateCart(cart)
  return <section className="pos-cart" aria-label="Current sale cart">
    <div className="pos-cart-heading"><div><span className="eyebrow">Current sale</span><h2 id="sale-cart-title">Cart</h2></div>{cart.length > 0 && <button type="button" className="text-button" disabled={busy} onClick={onClear}>Clear</button>}</div>
    {cart.length === 0 ? <div className="pos-cart-empty"><p>Your cart is empty.</p><small>Add a variant from the catalog to begin.</small></div> : <div className="pos-cart-lines">{cart.map((line) => <article className="pos-cart-line" key={line.variantId}>
      <div className="pos-cart-line-heading"><div><strong>{line.productName}</strong><span>{line.sku} · {[line.color, line.size].filter(Boolean).join(' / ') || 'Standard'}</span></div><button type="button" className="text-button" disabled={busy} aria-label={`Remove ${line.productName} ${line.sku}`} onClick={() => onRemove(line.variantId)}>Remove</button></div>
      <div className="pos-cart-line-controls"><div className="pos-quantity" aria-label={`Quantity for ${line.productName}`}><button type="button" disabled={busy || line.quantity <= 1} aria-label={`Decrease ${line.productName} quantity`} onClick={() => onQuantity(line.variantId, line.quantity - 1)}>−</button><span>{line.quantity}</span><button type="button" disabled={busy || line.quantity >= line.availableStock} aria-label={`Increase ${line.productName} quantity`} onClick={() => onQuantity(line.variantId, line.quantity + 1)}>+</button></div>
        {role === 'OWNER' ? <label className="pos-price-input"><span>Unit price ({currency || 'unavailable'})</span><input value={line.unitSoldPrice} inputMode="decimal" disabled={busy} onChange={(event) => onPrice(line.variantId, event.target.value, true)} onBlur={(event) => onPrice(line.variantId, event.target.value, false)} /></label> : <span className="pos-line-price">{line.unitSoldPrice ? formatMoney(line.unitSoldPrice, currency) : 'Unavailable'}</span>}
        <span className="pos-line-total"><small>Line total</small><strong>{lineTotal(line, currency)}</strong></span></div>
      <small>{line.availableStock} currently available</small>
    </article>)}</div>}
    <div className="pos-cart-total"><span><small>{summary.units} unit{summary.units === 1 ? '' : 's'}</small>Total</span><strong>{summary.total === null ? 'Unavailable' : formatMoney(summary.total, currency)}</strong></div>
    <button className="pos-checkout-button" type="button" disabled={busy || cart.length === 0 || !summary.valid || !currency} onClick={onCheckout}>{busy ? 'Completing sale...' : 'Complete sale'}</button>
  </section>
}

function RecentSales({ state, loadMore, onOpen }) {
  return <section className="pos-history" aria-labelledby="recent-sales-heading"><div className="pos-section-heading"><div><span className="eyebrow">Store activity</span><h2 id="recent-sales-heading">Recent sales</h2></div></div>
    {state.kind === 'loading' && <div className="pos-inline-state"><div className="spinner" aria-label="Loading recent sales" /><span>Loading...</span></div>}
    {state.kind === 'error' && <p className="error-message" role="alert">{state.message}</p>}
    {state.kind === 'ready' && state.sales.length === 0 && <p className="pos-muted">No sales have been recorded yet.</p>}
    {state.kind === 'ready' && state.sales.length > 0 && <div className="pos-history-list">{state.sales.map((sale) => <article key={sale.id} className="pos-history-row"><div><strong>Sale {sale.id.slice(0, 8)}</strong><span>{new Date(sale.createdAt).toLocaleString()}</span></div><div><span>{sale.itemCount} line{sale.itemCount === 1 ? '' : 's'} · {sale.totalUnits} units</span><small>{sale.seller?.name || 'Unknown seller'}</small></div><div><strong>{formatMoney(sale.totalAmount, sale.currency)}</strong><span className={`product-status ${sale.status === 'VOIDED' ? 'is-inactive' : ''}`}>{sale.status === 'VOIDED' ? 'Voided' : 'Completed'}</span></div><button type="button" className="secondary-action" onClick={() => onOpen(sale.id)}>View details</button></article>)}</div>}
    {state.kind === 'ready' && state.nextCursor && <button type="button" className="secondary-action pos-load-more" onClick={loadMore}>Load older sales</button>}
  </section>
}

export function SalesPage({ profile }) {
  const role = profile.user.role
  const currency = profile.account?.baseCurrency
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [page, setPage] = useState(1)
  const [catalogVersion, setCatalogVersion] = useState(0)
  const [catalog, setCatalog] = useState({ kind: 'loading' })
  const [cart, setCart] = useState([])
  const [cartOpen, setCartOpen] = useState(false)
  const [clearPending, setClearPending] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [success, setSuccess] = useState(null)
  const [checkingOut, setCheckingOut] = useState(false)
  const [history, setHistory] = useState({ kind: 'loading' })
  const [historyVersion, setHistoryVersion] = useState(0)
  const [selectedSaleId, setSelectedSaleId] = useState(null)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [cartRetryPending, setCartRetryPending] = useState(false)
  const catalogRequest = useRef(0)
  const operation = useRef(null)
  const checkoutGuard = useRef(createCheckoutGuard())
  const checkoutBusy = useRef(false)

  useEffect(() => {
    let active = true
    void loadCategories({ supabase }).then((result) => {
      if (!active || redirectIfNeeded(result)) return
      if (result.ok) setCategories(result.categories)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const requestId = ++catalogRequest.current
    const timer = window.setTimeout(() => {
      setCatalog((current) => current.kind === 'ready' ? { ...current, refreshing: true } : { kind: 'loading' })
      void listProducts({ supabase, filters: { search, categoryId, isActive: 'true', page } }).then((result) => {
        if (requestId !== catalogRequest.current || redirectIfNeeded(result)) return
        if (!result.ok) { setCatalog({ kind: 'error', message: result.message }); return }
        setCatalog({ kind: 'ready', ...result })
        setCart((current) => {
          const reconciled = reconcileCart(current, result.products, role)
          const before = JSON.stringify(current.map(({ variantId, quantity, unitSoldPrice }) => ({ variantId, quantity, unitSoldPrice })))
          const after = JSON.stringify(reconciled.map(({ variantId, quantity, unitSoldPrice }) => ({ variantId, quantity, unitSoldPrice })))
          if (before !== after && !cartRetryPending) operation.current = null
          if (cartRetryPending) return current
          return reconciled
        })
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [catalogVersion, categoryId, page, role, search, cartRetryPending])

  useEffect(() => {
    let active = true
    void loadSaleHistory({ supabase }).then((result) => {
      if (!active || redirectIfNeeded(result)) return
      setHistory(result.ok ? { kind: 'ready', ...result } : { kind: 'error', message: result.message })
    })
    return () => { active = false }
  }, [historyVersion])

  function replaceCart(result) {
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); return }
    operation.current = null
    setSuccess(null); setFeedback(null); setCart(result.cart)
  }

  function addSelection(line, product, variant) {
    let result = addVariantToCart(cart, product, variant, role)
    if (result.ok) result = setCartQuantity(result.cart, variant.id, (cart.find((item) => item.variantId === variant.id)?.quantity || 0) + line.quantity)
    if (result.ok && role === 'OWNER') result = setCartPrice(result.cart, variant.id, line.unitSoldPrice, role)
    replaceCart(result)
    if (result.ok) { setSelectedProduct(null); setFeedback({ kind: 'success', message: `${variant.sku} added to cart. Open cart to complete your sale.` }) }
    return result
  }

  function changePrice(variantId, price, draft) {
    if (draft && /^\d{0,16}(?:\.\d{0,2})?$/.test(price)) {
      operation.current = null
      setFeedback(null)
      setCart((current) => current.map((line) => line.variantId === variantId ? { ...line, unitSoldPrice: price } : line))
      return
    }
    replaceCart(setCartPrice(cart, variantId, price, role))
  }

  async function checkout(lines = cart, quickSale = false) {
    if (checkoutBusy.current) return { skipped: true }
    const prepared = checkoutOperation(lines, operation.current)
    if (!prepared.ok) { setFeedback({ kind: 'error', message: prepared.message }); return prepared }
    operation.current = prepared.operation
    checkoutBusy.current = true
    setCheckingOut(true); setFeedback(null)
    let guarded
    try {
      guarded = await checkoutGuard.current.run(() => submitSale({ supabase, operation: prepared.operation }))
    } catch {
      guarded = { value: { ok: false, retryable: true, message: 'The sale result could not be confirmed. Retry the same sale.' } }
    } finally {
      checkoutBusy.current = false
      setCheckingOut(false)
    }
    if (guarded.skipped) { setCheckingOut(false); return guarded }
    const result = guarded.value
    if (redirectIfNeeded(result)) return result
    if (!result.ok) {
      setFeedback({ kind: 'error', message: result.message })
      if (result.refreshCatalog) setCatalogVersion((version) => version + 1)
      if (!quickSale) setCartRetryPending(Boolean(result.retryable))
      return result
    }
    const completed = settleCheckout(lines, prepared.operation, result)
    operation.current = completed.operation
    setCart(completed.cart); setCartOpen(false); setClearPending(false); setSelectedProduct(null); setCartRetryPending(false); setSuccess(completed.sale)
    setFeedback({ kind: 'success', message: result.idempotentReplay ? 'Sale confirmed from the original checkout.' : 'Sale completed.' })
    setCatalogVersion((version) => version + 1)
    void loadSaleHistory({ supabase }).then((loaded) => { if (loaded.ok) setHistory({ kind: 'ready', ...loaded }) })
    return result
  }

  async function loadMoreHistory() {
    if (history.kind !== 'ready' || !history.nextCursor) return
    const result = await loadSaleHistory({ supabase, cursor: history.nextCursor })
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); return }
    setHistory({ kind: 'ready', sales: [...history.sales, ...result.sales], nextCursor: result.nextCursor })
  }

  const summary = calculateCart(cart)
  const pageCount = catalog.kind === 'ready' ? Math.max(1, Math.ceil(catalog.total / catalog.limit)) : 1
  const detailProduct = selectedProduct && (catalog.kind === 'ready' ? catalog.products.find((product) => product.id === selectedProduct.id) || { ...selectedProduct, isActive: false } : selectedProduct)

  return <section className="business-page sales-page simple-sales">
    <header className="business-page-heading sale-page-heading"><div><span className="eyebrow">Point of sale</span><h1>Sell products</h1><p>Choose a product. Select its options. Sell.</p></div><div className="sale-header-actions"><button type="button" className="secondary-action" aria-expanded={historyOpen} aria-controls="sale-history-area" onClick={() => setHistoryOpen((value) => !value)}>Sales history</button><button type="button" className="sale-cart-trigger" aria-haspopup="dialog" aria-label={`Open cart, ${summary.units} items`} onClick={() => setCartOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3h2l3 12h10l3-9H6M9 20h.01M18 20h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>Cart <span>{summary.units}</span></button></div></header>
    {!currency && <p className="business-alert error-message" role="alert">Account currency is unavailable. Checkout is disabled.</p>}
    {feedback && <p className={`product-feedback ${feedback.kind}-message`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    {success && <section className="pos-success" aria-label="Completed sale"><div><span className="eyebrow">Sale complete</span><h2>{formatMoney(success.totalAmount, success.currency)}</h2><p>{success.items.length} line{success.items.length === 1 ? '' : 's'} · Reference {success.id.slice(0, 8)}</p></div><button type="button" onClick={() => { setSuccess(null); setFeedback(null); document.getElementById('pos-search')?.focus() }}>New sale</button></section>}

    <div className="pos-layout"><section className="pos-catalog" aria-label="Sellable catalog" aria-busy={catalog.kind === 'loading' || Boolean(catalog.refreshing)}>
      <div className="pos-search-toolbar"><div><label htmlFor="pos-search">Find a product</label><input id="pos-search" type="search" value={search} maxLength={100} placeholder="Search…" onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></div><div><label htmlFor="pos-category">Category</label><select id="pos-category" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1) }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div></div>
      {catalog.kind === 'loading' && <div className="pos-inline-state"><div className="spinner" aria-label="Searching catalog" /><span>Finding products...</span></div>}
      {catalog.refreshing && <span className="sr-only" role="status">Updating products…</span>}
      {catalog.kind === 'error' && <div className="pos-catalog-state"><p className="error-message" role="alert">{catalog.message}</p><button type="button" onClick={() => setCatalogVersion((version) => version + 1)}>Try again</button></div>}
      {catalog.kind === 'ready' && catalog.products.length === 0 && <div className="pos-catalog-state"><h2>No sellable products found</h2><p>Try another product name, SKU, barcode, or category.</p></div>}
      {catalog.kind === 'ready' && catalog.products.length > 0 && <SalesCatalog products={catalog.products} busy={Boolean(catalog.refreshing)} onOpen={(product) => { setSelectedProduct(product); setFeedback(null); setSuccess(null) }} />}
      {catalog.kind === 'ready' && catalog.products.length > 0 && <nav className="product-pagination" aria-label="Catalog pages"><button type="button" className="secondary-action" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" className="secondary-action" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}
    </section></div>
    {cartOpen && <SaleDialog titleId="sale-cart-title" className="sale-cart-dialog" locked={checkingOut || cartRetryPending} onClose={() => setCartOpen(false)}>
      <button type="button" className="secondary-action sale-cart-close" disabled={checkingOut || cartRetryPending} onClick={() => setCartOpen(false)}>Close cart</button>
      <Cart cart={cart} currency={currency} role={role} busy={checkingOut || cartRetryPending}
        onQuantity={(id, quantity) => replaceCart(setCartQuantity(cart, id, quantity))} onPrice={changePrice}
        onRemove={(id) => replaceCart({ ok: true, cart: removeCartLine(cart, id) })}
        onClear={() => setClearPending(true)} onCheckout={() => checkout()} />
      {feedback?.kind === 'error' && <p className="error-message" role="alert">{feedback.message}</p>}
      {cartRetryPending && <div className="sale-cart-retry"><p>Retry this unchanged checkout to confirm its result safely.</p><button type="button" disabled={checkingOut} onClick={() => checkout()}>{checkingOut ? 'Confirming sale…' : 'Retry same sale'}</button></div>}
      {clearPending && <div className="pos-clear-confirm" role="group" aria-label="Confirm clear cart"><p>Remove every item from this cart?</p><div className="product-actions"><button type="button" className="danger-action" disabled={checkingOut || cartRetryPending} onClick={() => { replaceCart({ ok: true, cart: [] }); setClearPending(false) }}>Clear cart</button><button type="button" className="secondary-action" disabled={checkingOut || cartRetryPending} onClick={() => setClearPending(false)}>Keep cart</button></div></div>}
    </SaleDialog>}
    {detailProduct && <ProductSaleDialog key={detailProduct.id} product={detailProduct} role={role} currency={currency} cart={cart} busy={checkingOut} refreshing={catalog.kind !== 'ready' || Boolean(catalog.refreshing)} onClose={() => setSelectedProduct(null)} onSell={(lines) => checkout(lines, true)} onAdd={addSelection} />}
    <div id="sale-history-area">{historyOpen && <RecentSales state={history} loadMore={loadMoreHistory} onOpen={setSelectedSaleId} />}</div>
    {selectedSaleId && <SaleLifecyclePanel saleId={selectedSaleId} role={role} currency={currency} onClose={() => setSelectedSaleId(null)} onChanged={() => { setHistoryVersion((value) => value + 1); setCatalogVersion((value) => value + 1) }} />}
  </section>
}
