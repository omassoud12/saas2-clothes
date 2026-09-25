import { useEffect, useRef, useState } from 'react'
import { listProducts } from '../../app/product-flow.js'
import {
  calculateExchangePreview, calculateReturnPreview, canReturnSale, canVoidSale, exchangeOperation,
  loadSaleDetail, loadSaleReturns, returnOperation, setReturnQuantity, submitExchange, submitReturn, submitVoid,
} from '../../app/sale-lifecycle-flow.js'
import {
  addVariantToCart, calculateCart, createCheckoutGuard, removeCartLine, setCartPrice, setCartQuantity,
} from '../../app/sale-flow.js'
import { decimalToMinorUnits, formatMoney, formatSignedMoney } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'

function QuantityControl({ label, quantity, maximum, disabled, onChange }) {
  return <div className="lifecycle-quantity" aria-label={label}>
    <button type="button" disabled={disabled || quantity <= 0} aria-label={`Decrease ${label}`} onClick={() => onChange(quantity - 1)}>−</button>
    <span>{quantity}</span>
    <button type="button" disabled={disabled || quantity >= maximum} aria-label={`Increase ${label}`} onClick={() => onChange(quantity + 1)}>+</button>
  </div>
}

function SaleItems({ sale, currency, quantities, disabled, onQuantity }) {
  return <div className="lifecycle-items">{sale.items.map((item) => {
    const quantity = quantities?.[item.id] ?? 0
    return <article className="lifecycle-item" key={item.id}>
      <div className="lifecycle-item-main"><strong>{item.productName}</strong><span>{item.sku} · {[item.color, item.size].filter(Boolean).join(' / ') || 'Standard'}</span><small>{item.categoryName}</small></div>
      <div className="lifecycle-item-numbers"><span>{item.quantity} sold</span><span>{item.returnedQuantity} returned</span><strong>{item.remainingReturnableQuantity} available</strong></div>
      <div className="lifecycle-item-money"><span>{formatMoney(item.unitSoldPrice, currency)} each</span><strong>{formatMoney(item.lineTotal, currency)}</strong></div>
      {onQuantity && <QuantityControl label={`${item.productName} return quantity`} quantity={quantity} maximum={item.remainingReturnableQuantity} disabled={disabled || item.remainingReturnableQuantity === 0} onChange={(value) => onQuantity(item, value)} />}
    </article>
  })}</div>
}

function ReturnHistory({ state, currency, onLoadMore }) {
  if (state.kind === 'loading') return <div className="pos-inline-state"><div className="spinner" aria-label="Loading return history" /><span>Loading returns...</span></div>
  if (state.kind === 'error') return <p className="error-message" role="alert">{state.message}</p>
  if (state.returns.length === 0) return <p className="pos-muted">No returns recorded for this sale.</p>
  return <div className="lifecycle-return-history">{state.returns.map((entry) => <article key={entry.id}>
    <div><strong>{entry.exchangeId ? 'Exchange return' : 'Return'} {entry.id.slice(0, 8)}</strong><span>{new Date(entry.createdAt).toLocaleString()}</span></div>
    <div><span>{entry.totalUnits} unit{entry.totalUnits === 1 ? '' : 's'}</span><strong>{formatMoney(entry.totalRefund, currency)}</strong></div>
    {entry.reason && <p>{entry.reason}</p>}
  </article>)}{state.nextCursor && <button type="button" className="secondary-action" onClick={onLoadMore}>Load older returns</button>}</div>
}

function DetailView({ sale, returns, currency, role, onMode, onLoadMoreReturns }) {
  const returnable = canReturnSale(sale)
  return <>
    <div className="lifecycle-summary-grid">
      <div><span>Total</span><strong>{formatMoney(sale.totalAmount, currency)}</strong></div>
      <div><span>Seller</span><strong>{sale.seller?.name || 'Unknown seller'}</strong></div>
      <div><span>Returns</span><strong>{sale.returnSummary.returnCount}</strong></div>
      <div><span>Returned value</span><strong>{formatMoney(sale.returnSummary.totalReturnedAmount, currency)}</strong></div>
    </div>
    {sale.void && <div className="lifecycle-notice is-voided"><strong>Sale voided</strong><span>{new Date(sale.void.voidedAt).toLocaleString()} by {sale.void.voidedByName}</span><p>{sale.void.voidReason}</p></div>}
    {(sale.exchangeSummary.originalExchangeCount > 0 || sale.exchangeSummary.replacementForExchangeId) && <div className="lifecycle-notice"><strong>Exchange activity</strong><span>{sale.exchangeSummary.originalExchangeCount} exchange{sale.exchangeSummary.originalExchangeCount === 1 ? '' : 's'} created from this sale{sale.exchangeSummary.replacementForExchangeId ? ' · This is a replacement sale' : ''}</span></div>}
    <section aria-labelledby="sale-lines-heading"><h3 id="sale-lines-heading">Sale items</h3><SaleItems sale={sale} currency={currency} /></section>
    {sale.status === 'COMPLETED' && <div className="lifecycle-actions">
      <button type="button" disabled={!returnable} onClick={() => onMode('return')}>Create return</button>
      <button type="button" className="secondary-action" disabled={!returnable} onClick={() => onMode('exchange')}>Create exchange</button>
      {canVoidSale(role, sale) && <button type="button" className="danger-action" onClick={() => onMode('void')}>Void sale</button>}
    </div>}
    <section aria-labelledby="sale-returns-heading"><h3 id="sale-returns-heading">Return history</h3><ReturnHistory state={returns} currency={currency} onLoadMore={onLoadMoreReturns} /></section>
  </>
}

function ReturnFlow({ sale, currency, quantities, reason, busy, feedback, onQuantity, onReason, onSubmit, onCancel }) {
  const preview = calculateReturnPreview(sale, quantities)
  return <form className="lifecycle-flow" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
    <div className="lifecycle-flow-heading"><div><span className="eyebrow">Returning</span><h3>Select original items</h3></div><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button></div>
    <SaleItems sale={sale} currency={currency} quantities={quantities} disabled={busy} onQuantity={onQuantity} />
    <label className="lifecycle-reason"><span>Reason (optional)</span><textarea value={reason} maxLength={2000} disabled={busy} onChange={(event) => onReason(event.target.value)} placeholder="Add an operational note" /></label>
    <div className="lifecycle-review"><span>{preview.units} unit{preview.units === 1 ? '' : 's'} selected</span><strong>Expected refund: {preview.total === null ? 'Unavailable' : formatMoney(preview.total, currency)}</strong></div>
    {feedback && <p className={`${feedback.kind}-message`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    <div className="lifecycle-submit"><button type="submit" disabled={busy || !preview.valid}>{busy ? 'Completing return...' : 'Complete return'}</button></div>
  </form>
}

function VoidFlow({ sale, currency, reason, busy, feedback, onReason, onSubmit, onCancel }) {
  return <form className="lifecycle-flow lifecycle-void" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
    <div className="lifecycle-flow-heading"><div><span className="eyebrow">High-impact action</span><h3>Void sale {sale.id.slice(0, 8)}</h3></div><button type="button" className="secondary-action" disabled={busy} autoFocus onClick={onCancel}>Keep sale</button></div>
    <div className="lifecycle-notice is-warning"><strong>This reverses the complete sale.</strong><span>All sold stock will be restored. Existing returns make a sale ineligible for voiding.</span></div>
    <div className="lifecycle-review"><span>Original sale total</span><strong>{formatMoney(sale.totalAmount, currency)}</strong></div>
    <label className="lifecycle-reason"><span>Void reason</span><textarea value={reason} maxLength={2000} disabled={busy} required onChange={(event) => onReason(event.target.value)} placeholder="Explain why this sale is being voided" /></label>
    {feedback && <p className={`${feedback.kind}-message`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    <div className="lifecycle-submit"><button type="submit" className="danger-action" disabled={busy || !reason.trim()}>{busy ? 'Voiding sale...' : 'Confirm void sale'}</button></div>
  </form>
}

function ReplacementCatalog({ state, search, onSearch, role, currency, onAdd }) {
  return <section className="exchange-catalog" aria-labelledby="replacement-heading">
    <div className="lifecycle-flow-heading"><div><span className="eyebrow">Receiving</span><h3 id="replacement-heading">Replacement items</h3></div></div>
    <label><span>Search product, SKU, or barcode</span><input type="search" value={search} maxLength={100} onChange={(event) => onSearch(event.target.value)} placeholder="Find a replacement variant" /></label>
    {state.kind === 'loading' && <div className="pos-inline-state"><div className="spinner" aria-label="Searching replacements" /><span>Searching...</span></div>}
    {state.kind === 'error' && <p className="error-message" role="alert">{state.message}</p>}
    {state.kind === 'ready' && state.products.length === 0 && <p className="pos-muted">No replacement products found.</p>}
    {state.kind === 'ready' && <div className="exchange-results">{state.products.flatMap((product) => product.variants.filter((variant) => variant.isActive).map((variant) => {
      const priced = (decimalToMinorUnits(variant.sellingPrice) ?? 0n) > 0n
      const available = variant.currentStock > 0 && (role === 'OWNER' || priced)
      return <article key={variant.id}><div><strong>{product.name}</strong><span>{variant.sku} · {[variant.color, variant.size].filter(Boolean).join(' / ') || 'Standard'}</span></div><div><strong>{priced ? formatMoney(variant.sellingPrice, currency) : role === 'OWNER' ? 'Set price after adding' : 'Price unavailable'}</strong><span>{variant.currentStock} in stock</span></div><button type="button" disabled={!available} onClick={() => onAdd(product, variant)}>Add</button></article>
    }))}</div>}
  </section>
}

function ReplacementCart({ cart, role, currency, busy, onQuantity, onPrice, onRemove }) {
  const summary = calculateCart(cart)
  return <section className="exchange-cart" aria-labelledby="replacement-cart-heading"><h3 id="replacement-cart-heading">Receiving cart</h3>
    {cart.length === 0 ? <p className="pos-muted">Add at least one replacement item.</p> : cart.map((line) => <article key={line.variantId}>
      <div><strong>{line.productName}</strong><span>{line.sku} · {[line.color, line.size].filter(Boolean).join(' / ') || 'Standard'}</span></div>
      <QuantityControl label={`${line.productName} replacement quantity`} quantity={line.quantity} maximum={line.availableStock} disabled={busy} onChange={(value) => value === 0 ? onRemove(line.variantId) : onQuantity(line.variantId, value)} />
      {role === 'OWNER' ? <label><span>Unit price ({currency})</span><input inputMode="decimal" value={line.unitSoldPrice} disabled={busy} onChange={(event) => onPrice(line.variantId, event.target.value, true)} onBlur={(event) => onPrice(line.variantId, event.target.value, false)} /></label> : <strong>{formatMoney(line.unitSoldPrice, currency)}</strong>}
      <button type="button" className="text-button" disabled={busy} onClick={() => onRemove(line.variantId)}>Remove</button>
    </article>)}
    <div className="lifecycle-review"><span>{summary.units} replacement unit{summary.units === 1 ? '' : 's'}</span><strong>{summary.total === null ? 'Unavailable' : formatMoney(summary.total, currency)}</strong></div>
  </section>
}

function ExchangeFlow({ sale, currency, role, quantities, reason, cart, catalog, search, busy, feedback, onQuantity, onReason, onSearch, onAdd, onCartQuantity, onPrice, onRemove, onSubmit, onCancel }) {
  const preview = calculateExchangePreview(sale, quantities, cart)
  const difference = preview.difference === null ? 'Unavailable' : formatSignedMoney(preview.difference, currency)
  return <form className="lifecycle-flow exchange-flow" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
    <div className="lifecycle-flow-heading"><div><span className="eyebrow">Atomic exchange</span><h3>Return and replacement review</h3></div><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button></div>
    <section aria-labelledby="exchange-returning-heading"><h3 id="exchange-returning-heading">Returning</h3><SaleItems sale={sale} currency={currency} quantities={quantities} disabled={busy} onQuantity={onQuantity} /></section>
    <ReplacementCatalog state={catalog} search={search} onSearch={onSearch} role={role} currency={currency} onAdd={onAdd} />
    <ReplacementCart cart={cart} role={role} currency={currency} busy={busy} onQuantity={onCartQuantity} onPrice={onPrice} onRemove={onRemove} />
    <label className="lifecycle-reason"><span>Exchange reason (optional)</span><textarea value={reason} maxLength={2000} disabled={busy} onChange={(event) => onReason(event.target.value)} /></label>
    <div className="exchange-review"><div><span>Returning value</span><strong>{preview.returned === null ? 'Unavailable' : formatMoney(preview.returned, currency)}</strong></div><div><span>Replacement value</span><strong>{preview.replacement === null ? 'Unavailable' : formatMoney(preview.replacement, currency)}</strong></div><div><span>Difference (replacement − return)</span><strong>{difference}</strong></div></div>
    {feedback && <p className={`${feedback.kind}-message`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    <div className="lifecycle-submit"><button type="submit" disabled={busy || !preview.valid}>{busy ? 'Completing exchange...' : 'Complete exchange'}</button></div>
  </form>
}

export function SaleLifecyclePanel({ saleId, role, currency, onClose, onChanged }) {
  const [detail, setDetail] = useState({ kind: 'loading' })
  const [returns, setReturns] = useState({ kind: 'loading' })
  const [mode, setMode] = useState('detail')
  const [quantities, setQuantities] = useState({})
  const [reason, setReason] = useState('')
  const [replacementCart, setReplacementCart] = useState([])
  const [replacementSearch, setReplacementSearch] = useState('')
  const [replacementCatalog, setReplacementCatalog] = useState({ kind: 'ready', products: [] })
  const [catalogVersion, setCatalogVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [discard, setDiscard] = useState(null)
  const panel = useRef(null)
  const trigger = useRef(document.activeElement)
  const returnOp = useRef(null)
  const exchangeOp = useRef(null)
  const returnGuard = useRef(createCheckoutGuard())
  const voidGuard = useRef(createCheckoutGuard())
  const exchangeGuard = useRef(createCheckoutGuard())
  const catalogRequest = useRef(0)
  const dirty = Object.keys(quantities).length > 0 || Boolean(reason.trim()) || replacementCart.length > 0

  async function refresh() {
    const [saleResult, returnResult] = await Promise.all([
      loadSaleDetail({ supabase, saleId }), loadSaleReturns({ supabase, saleId }),
    ])
    if (saleResult.requiresLogin) { window.location.replace('/login'); return }
    setDetail(saleResult.ok ? { kind: 'ready', sale: saleResult.sale } : { kind: 'error', message: saleResult.message })
    setReturns(returnResult.ok ? { kind: 'ready', ...returnResult } : { kind: 'error', message: returnResult.message })
  }

  useEffect(() => {
    let active = true
    void Promise.all([
      loadSaleDetail({ supabase, saleId }), loadSaleReturns({ supabase, saleId }),
    ]).then(([saleResult, returnResult]) => {
      if (!active) return
      if (saleResult.requiresLogin || returnResult.requiresLogin) { window.location.replace('/login'); return }
      setDetail(saleResult.ok ? { kind: 'ready', sale: saleResult.sale } : { kind: 'error', message: saleResult.message })
      setReturns(returnResult.ok ? { kind: 'ready', ...returnResult } : { kind: 'error', message: returnResult.message })
    })
    return () => { active = false }
  }, [saleId])

  useEffect(() => {
    const node = panel.current
    const initialTrigger = trigger.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    node?.querySelector('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')?.focus()
    return () => { document.body.style.overflow = previousOverflow; initialTrigger?.focus?.() }
  }, [])

  useEffect(() => {
    const node = panel.current
    function keydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (discard) { setDiscard(null); return }
        if (mode !== 'detail' && dirty) setDiscard('close')
        else onClose()
        return
      }
      const scope = node?.querySelector('.lifecycle-discard') ?? node
      const focusable = scope ? [...scope.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')] : []
      if (event.key !== 'Tab' || focusable.length === 0) return
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus() }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => { window.removeEventListener('keydown', keydown) }
  }, [dirty, discard, mode, onClose])

  useEffect(() => {
    if (mode !== 'exchange') return undefined
    const requestId = ++catalogRequest.current
    const timer = window.setTimeout(() => {
      setReplacementCatalog({ kind: 'loading' })
      void listProducts({ supabase, filters: { search: replacementSearch, isActive: 'true', page: 1 } }).then((result) => {
        if (requestId !== catalogRequest.current) return
        if (result.requiresLogin) { window.location.replace('/login'); return }
        setReplacementCatalog(result.ok ? { kind: 'ready', products: result.products } : { kind: 'error', message: result.message })
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [catalogVersion, mode, replacementSearch])

  function resetFlow() { setMode('detail'); setQuantities({}); setReason(''); setReplacementCart([]); setFeedback(null); returnOp.current = null; exchangeOp.current = null }
  function requestClose(target) { if (mode !== 'detail' && dirty) setDiscard(target); else if (target === 'close') onClose(); else resetFlow() }
  function confirmDiscard() { const target = discard; setDiscard(null); resetFlow(); if (target === 'close') onClose() }
  function select(item, quantity) { const result = setReturnQuantity(quantities, item, quantity); if (result.ok) { setQuantities(result.quantities); returnOp.current = null; exchangeOp.current = null; setFeedback(null) } else setFeedback({ kind: 'error', message: result.message }) }
  function updateReason(value) { setReason(value); returnOp.current = null; exchangeOp.current = null; setFeedback(null) }
  function updateReplacement(result) { if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); return }; setReplacementCart(result.cart); exchangeOp.current = null; setFeedback(null) }
  function updatePrice(id, value, draft) {
    if (draft && /^\d{0,16}(?:\.\d{0,2})?$/.test(value)) { setReplacementCart((cart) => cart.map((line) => line.variantId === id ? { ...line, unitSoldPrice: value } : line)); exchangeOp.current = null; return }
    updateReplacement(setCartPrice(replacementCart, id, value, role))
  }

  async function loadMoreReturns() {
    if (returns.kind !== 'ready' || !returns.nextCursor) return
    const result = await loadSaleReturns({ supabase, saleId, cursor: returns.nextCursor })
    if (result.requiresLogin) { window.location.replace('/login'); return }
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); return }
    setReturns({ kind: 'ready', returns: [...returns.returns, ...result.returns], nextCursor: result.nextCursor })
  }

  async function completeReturn() {
    const prepared = returnOperation({ sale: detail.sale, quantities, reason, current: returnOp.current })
    if (!prepared.ok) { setFeedback({ kind: 'error', message: prepared.message }); return }
    returnOp.current = prepared.operation; setBusy(true); setFeedback(null)
    const guarded = await returnGuard.current.run(() => submitReturn({ supabase, saleId, operation: prepared.operation }))
    if (guarded.skipped) return
    setBusy(false); const result = guarded.value
    if (result.requiresLogin) { window.location.replace('/login'); return }
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); if (result.refreshDetail) void refresh(); return }
    resetFlow(); setFeedback({ kind: 'success', message: result.idempotentReplay ? 'Original return confirmed.' : `Return ${result.return.id.slice(0, 8)} completed for ${formatMoney(result.return.totalRefund, currency)}.` }); await refresh(); onChanged()
  }

  async function completeVoid() {
    setBusy(true); setFeedback(null)
    const guarded = await voidGuard.current.run(() => submitVoid({ supabase, saleId, reason }))
    if (guarded.skipped) return
    setBusy(false); const result = guarded.value
    if (result.requiresLogin) { window.location.replace('/login'); return }
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); if (result.refreshDetail) void refresh(); return }
    resetFlow(); setFeedback({ kind: 'success', message: result.idempotentReplay ? 'Existing void confirmed.' : 'Sale voided and stock restored.' }); await refresh(); onChanged()
  }

  async function completeExchange() {
    const prepared = exchangeOperation({ sale: detail.sale, quantities, reason, replacementCart, current: exchangeOp.current })
    if (!prepared.ok) { setFeedback({ kind: 'error', message: prepared.message }); return }
    exchangeOp.current = prepared.operation; setBusy(true); setFeedback(null)
    const guarded = await exchangeGuard.current.run(() => submitExchange({ supabase, saleId, operation: prepared.operation }))
    if (guarded.skipped) return
    setBusy(false); const result = guarded.value
    if (result.requiresLogin) { window.location.replace('/login'); return }
    if (!result.ok) { setFeedback({ kind: 'error', message: result.message }); if (result.refreshDetail) void refresh(); if (result.refreshCatalog) setCatalogVersion((value) => value + 1); return }
    resetFlow(); setFeedback({ kind: 'success', message: result.idempotentReplay ? 'Original exchange confirmed.' : `Exchange ${result.exchange.id.slice(0, 8)} completed. Difference: ${formatSignedMoney(result.exchange.differenceAmount, currency)}.` }); await refresh(); onChanged()
  }

  return <><button type="button" className="lifecycle-backdrop" aria-label="Close sale details" onClick={() => requestClose('close')} /><section ref={panel} className="lifecycle-panel" role="dialog" aria-modal="true" aria-labelledby="sale-detail-heading">
    <header className="lifecycle-header"><div><span className="eyebrow">Sale details</span><h2 id="sale-detail-heading">Sale {saleId.slice(0, 8)}</h2>{detail.kind === 'ready' && <p>{new Date(detail.sale.createdAt).toLocaleString()} · <span className={`product-status ${detail.sale.status === 'VOIDED' ? 'is-inactive' : ''}`}>{detail.sale.status === 'VOIDED' ? 'Voided' : 'Completed'}</span></p>}</div><button type="button" className="secondary-action" onClick={() => requestClose('close')}>Close</button></header>
    <div className="lifecycle-body">
      {detail.kind === 'loading' && <div className="pos-inline-state"><div className="spinner" aria-label="Loading sale details" /><span>Loading sale...</span></div>}
      {detail.kind === 'error' && <div className="pos-catalog-state"><p className="error-message" role="alert">{detail.message}</p><button type="button" onClick={refresh}>Try again</button></div>}
      {detail.kind === 'ready' && detail.sale.currency !== currency && <p className="error-message" role="alert">Sale currency does not match the authenticated account currency.</p>}
      {detail.kind === 'ready' && detail.sale.currency === currency && mode === 'detail' && <>{feedback && <p className={`${feedback.kind}-message`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}<DetailView sale={detail.sale} returns={returns} currency={currency} role={role} onMode={(next) => { setMode(next); setFeedback(null) }} onLoadMoreReturns={loadMoreReturns} /></>}
      {detail.kind === 'ready' && mode === 'return' && <ReturnFlow sale={detail.sale} currency={currency} quantities={quantities} reason={reason} busy={busy} feedback={feedback} onQuantity={select} onReason={updateReason} onSubmit={completeReturn} onCancel={() => requestClose('detail')} />}
      {detail.kind === 'ready' && mode === 'void' && <VoidFlow sale={detail.sale} currency={currency} reason={reason} busy={busy} feedback={feedback} onReason={updateReason} onSubmit={completeVoid} onCancel={() => requestClose('detail')} />}
      {detail.kind === 'ready' && mode === 'exchange' && <ExchangeFlow sale={detail.sale} currency={currency} role={role} quantities={quantities} reason={reason} cart={replacementCart} catalog={replacementCatalog} search={replacementSearch} busy={busy} feedback={feedback} onQuantity={select} onReason={updateReason} onSearch={setReplacementSearch} onAdd={(product, variant) => updateReplacement(addVariantToCart(replacementCart, product, variant, role))} onCartQuantity={(id, value) => updateReplacement(setCartQuantity(replacementCart, id, value))} onPrice={updatePrice} onRemove={(id) => updateReplacement({ ok: true, cart: removeCartLine(replacementCart, id) })} onSubmit={completeExchange} onCancel={() => requestClose('detail')} />}
    </div>
    {discard && <div className="lifecycle-discard" role="alertdialog" aria-modal="true" aria-labelledby="discard-heading"><div><h3 id="discard-heading">Discard this unfinished workflow?</h3><p>Your selected quantities and replacement items will be cleared.</p><div className="product-actions"><button type="button" className="danger-action" onClick={confirmDiscard}>Discard</button><button type="button" className="secondary-action" autoFocus onClick={() => setDiscard(null)}>Continue editing</button></div></div></div>}
  </section></>
}
