import { useEffect, useRef, useState } from 'react'
import {
  MOVEMENT_LABELS, appendPage, canShowMovementCost, canShowMovementNote,
  getInventoryReconciliation, listInventoryMovements, reconciliationSummary, signedQuantity,
} from './inventory-audit-flow.js'
import { supabase } from '../../lib/supabase.js'
import { formatMoney } from '../../lib/money.js'

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

function utcBoundary(value) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function ProductVariantFilters({ products, draft, setDraft, productId }) {
  const product = products.find((item) => item.id === draft.productId)
  return <><div><label htmlFor={`${draft.kind}-product`}>Product</label><select disabled={Boolean(productId)} id={`${draft.kind}-product`} value={draft.productId} onChange={(event) => setDraft({ ...draft, productId: event.target.value, variantId: '' })}><option value="">All products</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <div><label htmlFor={`${draft.kind}-variant`}>Variant</label><select id={`${draft.kind}-variant`} value={draft.variantId} disabled={!product} onChange={(event) => setDraft({ ...draft, variantId: event.target.value })}><option value="">All variants</option>{product?.variants.map((item) => <option key={item.id} value={item.id}>{[item.color, item.size].filter(Boolean).join(' / ') || item.sku}</option>)}</select></div></>
}

export function InventoryHistory({ active, role, currency, products, productId, refreshVersion = 0 }) {
  const [draft, setDraft] = useState({ kind: 'history', productId: productId || '', variantId: '', type: '', from: '', to: '' })
  const [filters, setFilters] = useState(productId ? { productId } : {})
  const [version, setVersion] = useState(0)
  const [state, setState] = useState({ kind: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const generation = useRef(0)
  const loadedKey = useRef('')
  const loadMoreController = useRef(null)

  useEffect(() => {
    const key = JSON.stringify([filters, version, refreshVersion])
    if (!active || loadedKey.current === key) return undefined
    const controller = new AbortController()
    let current = true
    const request = ++generation.current
    setState({ kind: 'loading' })
    void listInventoryMovements({ supabase, filters, signal: controller.signal }).then((result) => {
      if (!current || result.aborted || generation.current !== request || redirectIfNeeded(result)) return
      loadedKey.current = key
      setState(result.ok ? { kind: 'ready', ...result } : { kind: 'error', message: result.message })
    })
    return () => { current = false; controller.abort(); loadMoreController.current?.abort() }
  }, [active, filters, version, refreshVersion])

  function refresh() { generation.current += 1; loadedKey.current = ''; setState({ kind: 'loading' }); setVersion((value) => value + 1) }
  function apply(event) {
    event.preventDefault()
    const from = utcBoundary(draft.from)
    const to = utcBoundary(draft.to)
    if (from === null || to === null) { setState({ kind: 'error', message: 'Enter valid date and time filters.' }); return }
    if (from && to && from > to) { setState({ kind: 'error', message: 'From must not be after To.' }); return }
    generation.current += 1
    setState({ kind: 'loading' })
    setFilters({ productId: draft.productId, variantId: draft.variantId, type: draft.type, from, to })
  }
  async function loadMore() {
    if (loadingMore || state.kind !== 'ready' || !state.nextCursor) return
    const request = generation.current
    const controller = new AbortController()
    loadMoreController.current = controller
    setLoadingMore(true)
    try {
      const result = await listInventoryMovements({ supabase, filters: { ...filters, cursor: state.nextCursor }, signal: controller.signal })
      if (result.aborted || generation.current !== request || redirectIfNeeded(result)) return
      if (result.ok) setState({ kind: 'ready', movements: appendPage(state.movements, result.movements), nextCursor: result.nextCursor })
      else setState({ ...state, moreError: result.message })
    } finally { if (loadMoreController.current === controller) loadMoreController.current = null; setLoadingMore(false) }
  }

  return <section className="product-panel inventory-audit-section" aria-labelledby="history-heading">
    <div className="product-section-heading"><div><span className="eyebrow">Audit trail</span><h2 id="history-heading">Movement history</h2></div><button type="button" className="secondary-action" onClick={refresh}>Refresh</button></div>
    <p className="product-muted">Signed quantities show what each movement added or removed. Incoming quantities use +; outgoing quantities use -. This history is read-only.</p>
    <form className="inventory-audit-filters" onSubmit={apply}><ProductVariantFilters products={products} draft={draft} setDraft={setDraft} productId={productId} />
      <div><label htmlFor="history-type">Movement type</label><select id="history-type" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}><option value="">All types</option>{Object.entries(MOVEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div><label htmlFor="history-from">From</label><input id="history-from" type="datetime-local" step="1" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></div>
      <div><label htmlFor="history-to">To</label><input id="history-to" type="datetime-local" step="1" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></div>
      <button type="submit">Apply filters</button></form>
    <p className="product-muted">Date and time inputs use your local timezone.</p>
    {state.kind === 'loading' && <p role="status">Loading movement history...</p>}
    {state.kind === 'error' && <div><p role="alert" className="error-message">{state.message}</p><button type="button" onClick={refresh}>Try again</button></div>}
    {state.kind === 'ready' && <>{state.movements.length === 0 ? <p className="product-muted">No movements match these filters yet.</p> : <div className="inventory-audit-list">{state.movements.map((movement) => <article className="inventory-audit-card" key={movement.id}>
      <div className="inventory-audit-card-heading"><strong>{MOVEMENT_LABELS[movement.type] ?? movement.type}</strong><strong className={movement.quantityChange < 0 ? 'inventory-negative' : 'inventory-positive'}>{signedQuantity(movement.quantityChange)}</strong></div>
      <p>{movement.product.name} · {movement.variant.sku}{[movement.variant.color, movement.variant.size].filter(Boolean).length ? ` · ${[movement.variant.color, movement.variant.size].filter(Boolean).join(' / ')}` : ''}</p>
      <small>{new Date(movement.createdAt).toLocaleString()} · {movement.performer.name}{movement.performer.employeeCode ? ` (${movement.performer.employeeCode})` : ''}</small>
      {canShowMovementCost(role, movement) && <p>Unit cost: {formatMoney(movement.unitCost, currency, 4)}</p>}
      {canShowMovementNote(role, movement) && <p>Note: {movement.note}</p>}
    </article>)}</div>}
      {state.moreError && <p role="alert" className="error-message">{state.moreError}</p>}
      {state.nextCursor && <button type="button" className="secondary-action" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading...' : 'Load more movements'}</button>}
    </>}
  </section>
}

export function InventoryReconciliation({ active, products, productId, refreshVersion = 0 }) {
  const [draft, setDraft] = useState({ kind: 'reconciliation', productId: productId || '', variantId: '', status: '' })
  const [filters, setFilters] = useState(productId ? { productId } : {})
  const [version, setVersion] = useState(0)
  const [state, setState] = useState({ kind: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const generation = useRef(0)
  const loadedKey = useRef('')
  const loadMoreController = useRef(null)

  useEffect(() => {
    const key = JSON.stringify([filters, version, refreshVersion])
    if (!active || loadedKey.current === key) return undefined
    const controller = new AbortController()
    let current = true
    const request = ++generation.current
    setState({ kind: 'loading' })
    void getInventoryReconciliation({ supabase, filters, signal: controller.signal }).then((result) => {
      if (!current || result.aborted || generation.current !== request || redirectIfNeeded(result)) return
      loadedKey.current = key
      setState(result.ok ? { kind: 'ready', ...result } : { kind: 'error', message: result.message })
    })
    return () => { current = false; controller.abort(); loadMoreController.current?.abort() }
  }, [active, filters, version, refreshVersion])

  function refresh() { generation.current += 1; loadedKey.current = ''; setState({ kind: 'loading' }); setVersion((value) => value + 1) }
  async function loadMore() {
    if (loadingMore || state.kind !== 'ready' || !state.nextCursor) return
    const request = generation.current
    const controller = new AbortController()
    loadMoreController.current = controller
    setLoadingMore(true)
    try {
      const result = await getInventoryReconciliation({ supabase, filters: { ...filters, cursor: state.nextCursor }, signal: controller.signal })
      if (result.aborted || generation.current !== request || redirectIfNeeded(result)) return
      if (result.ok) setState({ kind: 'ready', variants: appendPage(state.variants, result.variants), nextCursor: result.nextCursor })
      else setState({ ...state, moreError: result.message })
    } finally { if (loadMoreController.current === controller) loadMoreController.current = null; setLoadingMore(false) }
  }
  const summary = state.kind === 'ready' ? reconciliationSummary(state.variants) : null

  return <section className="product-panel inventory-audit-section" aria-labelledby="reconciliation-heading">
    <div className="product-section-heading"><div><span className="eyebrow">Stock check</span><h2 id="reconciliation-heading">Stock reconciliation</h2></div><button type="button" className="secondary-action" onClick={refresh}>Refresh</button></div>
    <p className="product-muted">Compares current stock with the sum of recorded movements. Discrepancies are shown, never changed automatically.</p>
    <form className="inventory-audit-filters" onSubmit={(event) => { event.preventDefault(); generation.current += 1; setState({ kind: 'loading' }); setFilters({ productId: draft.productId, variantId: draft.variantId, status: draft.status }) }}><ProductVariantFilters products={products} draft={draft} setDraft={setDraft} productId={productId} />
      <div><label htmlFor="reconciliation-status">Status</label><select id="reconciliation-status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="">All statuses</option><option value="RECONCILED">Reconciled</option><option value="MISMATCH">Mismatch</option></select></div><button type="submit">Apply filters</button></form>
    {state.kind === 'loading' && <p role="status">Checking stock...</p>}
    {state.kind === 'error' && <div><p role="alert" className="error-message">{state.message}</p><button type="button" onClick={refresh}>Try again</button></div>}
    {state.kind === 'ready' && <><p className="product-muted">Shown results: {summary.reconciled} reconciled · {summary.mismatched} mismatched{state.nextCursor ? ' (more results available)' : ''}.</p>
      {state.variants.length === 0 ? <p className="product-muted">No variants match these filters.</p> : <div className="inventory-audit-list">{state.variants.map((row) => <article className={`inventory-audit-card ${row.status === 'MISMATCH' ? 'inventory-mismatch' : ''}`} key={row.variant.id}>
        <div className="inventory-audit-card-heading"><strong>{row.variant.product.name} · {row.variant.sku}</strong><span className={`product-status ${row.status === 'MISMATCH' ? 'is-inactive' : ''}`}>{row.status === 'MISMATCH' ? 'Mismatch' : 'Reconciled'}</span></div>
        {row.status === 'MISMATCH' && <p className="inventory-warning" role="alert">Stock discrepancy detected. Review the movement history; no stock was changed.</p>}
        <dl className="inventory-stock-comparison"><div><dt>Stored stock</dt><dd>{row.storedStock}</dd></div><div><dt>Movement total</dt><dd>{row.ledgerStock}</dd></div><div><dt>Difference</dt><dd>{signedQuantity(row.difference)}</dd></div></dl>
      </article>)}</div>}
      {state.moreError && <p role="alert" className="error-message">{state.moreError}</p>}
      {state.nextCursor && <button type="button" className="secondary-action" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading...' : 'Load more variants'}</button>}
    </>}
  </section>
}
