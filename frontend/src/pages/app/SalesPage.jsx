import { useEffect, useRef, useState } from 'react'
import { loadCategories } from '../../features/categories/category-flow.js'
import { listProducts } from '../../features/products/product-flow.js'
import {
  addVariantToCart, calculateCart, checkoutOperation, createCheckoutGuard, loadSaleHistory,
  reconcileCart, removeCartLine, setCartPrice, setCartQuantity, settleCheckout, submitSale,
} from '../../features/sales/sale-flow.js'
import { decimalToMinorUnits, formatMoney } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'
import { SaleLifecyclePanel } from '../../features/sales/SaleLifecyclePanel.jsx'

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

function ProductImage({ product }) {
  const [failed, setFailed] = useState(false)
  return <span className="pos-product-image">{product.imageUrl && !failed
    ? <img src={product.imageUrl} alt={product.name} loading="lazy" onError={() => setFailed(true)} />
    : <span aria-label="No product image"><span aria-hidden="true">◇</span><small>No image</small></span>}
  </span>
}

function lineTotal(line, currency) {
  const total = calculateCart([line]).total
  return total === null ? 'Unavailable' : formatMoney(total, currency)
}

function Cart({ cart, currency, role, busy, onQuantity, onPrice, onRemove, onClear, onCheckout }) {
  const summary = calculateCart(cart)
  return <section className="pos-cart" aria-label="Current sale cart">
    <div className="pos-cart-heading"><div><span className="eyebrow">Current sale</span><h2>Cart</h2></div>{cart.length > 0 && <button type="button" className="text-button" disabled={busy} onClick={onClear}>Clear</button>}</div>
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
  const catalogRequest = useRef(0)
  const operation = useRef(null)
  const checkoutGuard = useRef(createCheckoutGuard())
  const cartToggle = useRef(null)
  const cartSheet = useRef(null)

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
      setCatalog({ kind: 'loading' })
      void listProducts({ supabase, filters: { search, categoryId, isActive: 'true', page } }).then((result) => {
        if (requestId !== catalogRequest.current || redirectIfNeeded(result)) return
        if (!result.ok) { setCatalog({ kind: 'error', message: result.message }); return }
        setCatalog({ kind: 'ready', ...result })
        setCart((current) => {
          const reconciled = reconcileCart(current, result.products, role)
          const before = JSON.stringify(current.map(({ variantId, quantity, unitSoldPrice }) => ({ variantId, quantity, unitSoldPrice })))
          const after = JSON.stringify(reconciled.map(({ variantId, quantity, unitSoldPrice }) => ({ variantId, quantity, unitSoldPrice })))
          if (before !== after) operation.current = null
          return reconciled
        })
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [catalogVersion, categoryId, page, role, search])

  useEffect(() => {
    let active = true
    void loadSaleHistory({ supabase }).then((result) => {
      if (!active || redirectIfNeeded(result)) return
      setHistory(result.ok ? { kind: 'ready', ...result } : { kind: 'error', message: result.message })
    })
    return () => { active = false }
  }, [historyVersion])

  useEffect(() => {
    if (!cartOpen) return undefined
    const sheet = cartSheet.current
    const toggle = cartToggle.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const initial = sheet?.querySelector('button, input')
    initial?.focus()
    function handleKey(event) {
      if (event.key === 'Escape') setCartOpen(false)
      const focusable = sheet ? [...sheet.querySelectorAll('button:not(:disabled), input:not(:disabled)')] : []
      if (event.key !== 'Tab' || focusable.length === 0) return
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus() }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus() }
    }
    window.addEventListener('keydown', handleKey)
    return () => { window.removeEventListener('keydown', handleKey); document.body.style.overflow = previousOverflow; toggle?.focus() }
  }, [cartOpen])

  function replaceCart(result) {
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); return }
    operation.current = null
    setSuccess(null); setFeedback(null); setCart(result.cart)
  }

  function add(product, variant) {
    const result = addVariantToCart(cart, product, variant, role)
    replaceCart(result)
    if (result.ok) setFeedback({ kind: 'success', message: `${product.name} · ${variant.sku} added to cart.` })
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

  async function checkout() {
    const prepared = checkoutOperation(cart, operation.current)
    if (!prepared.ok) { setFeedback({ kind: 'error', message: prepared.message }); return }
    operation.current = prepared.operation
    setCheckingOut(true); setFeedback(null)
    const guarded = await checkoutGuard.current.run(() => submitSale({ supabase, operation: prepared.operation }))
    if (guarded.skipped) return
    const result = guarded.value
    setCheckingOut(false)
    if (redirectIfNeeded(result)) return
    if (!result.ok) {
      setFeedback({ kind: 'error', message: result.message })
      if (result.refreshCatalog) setCatalogVersion((version) => version + 1)
      return
    }
    const completed = settleCheckout(cart, prepared.operation, result)
    operation.current = completed.operation
    setCart(completed.cart); setCartOpen(false); setClearPending(false); setSuccess(completed.sale)
    setFeedback({ kind: 'success', message: result.idempotentReplay ? 'Sale confirmed from the original checkout.' : 'Sale completed.' })
    setCatalogVersion((version) => version + 1)
    void loadSaleHistory({ supabase }).then((loaded) => { if (loaded.ok) setHistory({ kind: 'ready', ...loaded }) })
  }

  async function loadMoreHistory() {
    if (history.kind !== 'ready' || !history.nextCursor) return
    const result = await loadSaleHistory({ supabase, cursor: history.nextCursor })
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); return }
    setHistory({ kind: 'ready', sales: [...history.sales, ...result.sales], nextCursor: result.nextCursor })
  }

  const summary = calculateCart(cart)
  const pageCount = catalog.kind === 'ready' ? Math.max(1, Math.ceil(catalog.total / catalog.limit)) : 1

  return <section className="business-page sales-page">
    <header className="business-page-heading"><span className="eyebrow">Point of sale</span><h1>New sale</h1><p>Search the catalog, build the cart, and complete checkout.</p></header>
    {!currency && <p className="business-alert error-message" role="alert">Account currency is unavailable. Checkout is disabled.</p>}
    {feedback && <p className={`product-feedback ${feedback.kind}-message`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    {success && <section className="pos-success" aria-label="Completed sale"><div><span className="eyebrow">Sale complete</span><h2>{formatMoney(success.totalAmount, success.currency)}</h2><p>{success.items.length} line{success.items.length === 1 ? '' : 's'} · Reference {success.id.slice(0, 8)}</p></div><button type="button" onClick={() => { setSuccess(null); setFeedback(null); document.getElementById('pos-search')?.focus() }}>New sale</button></section>}

    <div className="pos-layout"><section className="pos-catalog" aria-label="Sellable catalog">
      <div className="pos-search-toolbar"><div><label htmlFor="pos-search">Search product, SKU, or barcode</label><input id="pos-search" type="search" value={search} maxLength={100} placeholder="Start typing to find an item" onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></div><div><label htmlFor="pos-category">Category</label><select id="pos-category" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1) }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div></div>
      {catalog.kind === 'loading' && <div className="pos-inline-state"><div className="spinner" aria-label="Searching catalog" /><span>Finding products...</span></div>}
      {catalog.kind === 'error' && <div className="pos-catalog-state"><p className="error-message" role="alert">{catalog.message}</p><button type="button" onClick={() => setCatalogVersion((version) => version + 1)}>Try again</button></div>}
      {catalog.kind === 'ready' && catalog.products.length === 0 && <div className="pos-catalog-state"><h2>No sellable products found</h2><p>Try another product name, SKU, barcode, or category.</p></div>}
      {catalog.kind === 'ready' && catalog.products.length > 0 && <div className="pos-product-list">{catalog.products.map((product) => <article className="pos-product" key={product.id}><div className="pos-product-heading"><ProductImage product={product} /><div><h2>{product.name}</h2><p>{product.category.name}</p></div></div><div className="pos-variant-list">{product.variants.some((variant) => variant.isActive) ? product.variants.filter((variant) => variant.isActive).map((variant) => {
        const priced = (decimalToMinorUnits(variant.sellingPrice) ?? 0n) > 0n
        const canAdd = variant.currentStock > 0 && (role === 'OWNER' || priced)
        return <div className="pos-variant" key={variant.id}><div><strong>{variant.sku}</strong><span>{[variant.color, variant.size].filter(Boolean).join(' / ') || 'Standard variant'}</span></div><div><strong>{priced ? formatMoney(variant.sellingPrice, currency) : role === 'OWNER' ? 'Set price in cart' : 'Price unavailable'}</strong><span>{variant.currentStock} in stock</span></div><button type="button" disabled={!canAdd} aria-label={`Add ${product.name} ${variant.sku} to cart`} onClick={() => add(product, variant)}>{variant.currentStock <= 0 ? 'Out of stock' : !priced && role === 'WAREHOUSE' ? 'Unavailable' : 'Add'}</button></div>
      }) : <p className="pos-no-variants">No active variants available.</p>}</div></article>)}</div>}
      {catalog.kind === 'ready' && catalog.products.length > 0 && <nav className="product-pagination" aria-label="Catalog pages"><button type="button" className="secondary-action" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" className="secondary-action" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}
    </section><aside className={`pos-cart-column ${cartOpen ? 'is-open' : ''}`} ref={cartSheet} role={cartOpen ? 'dialog' : undefined} aria-modal={cartOpen ? 'true' : undefined} aria-label="Sale cart"><button type="button" className="pos-cart-close text-button" onClick={() => setCartOpen(false)}>Close cart</button><Cart cart={cart} currency={currency} role={role} busy={checkingOut} onQuantity={(id, quantity) => replaceCart(setCartQuantity(cart, id, quantity))} onPrice={changePrice} onRemove={(id) => replaceCart({ ok: true, cart: removeCartLine(cart, id) })} onClear={() => setClearPending(true)} onCheckout={checkout} />{clearPending && <div className="pos-clear-confirm" role="group" aria-label="Confirm clear cart"><p>Remove every item from this cart?</p><div className="product-actions"><button type="button" className="danger-action" onClick={() => { replaceCart({ ok: true, cart: [] }); setClearPending(false) }}>Clear cart</button><button type="button" className="secondary-action" onClick={() => setClearPending(false)}>Keep cart</button></div></div>}</aside></div>
    {cartOpen && <button type="button" className="pos-cart-backdrop" aria-label="Close cart" onClick={() => setCartOpen(false)} />}
    <button ref={cartToggle} type="button" className="pos-mobile-cart" aria-expanded={cartOpen} onClick={() => setCartOpen(true)}><span>Cart · {summary.units} item{summary.units === 1 ? '' : 's'}</span><strong>{summary.total === null ? 'Unavailable' : formatMoney(summary.total, currency)}</strong></button>
    <RecentSales state={history} loadMore={loadMoreHistory} onOpen={setSelectedSaleId} />
    {selectedSaleId && <SaleLifecyclePanel saleId={selectedSaleId} role={role} currency={currency} onClose={() => setSelectedSaleId(null)} onChanged={() => { setHistoryVersion((value) => value + 1); setCatalogVersion((value) => value + 1) }} />}
  </section>
}
