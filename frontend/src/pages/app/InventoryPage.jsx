import { useEffect, useState } from 'react'
import { listProducts, canShowVariantCost } from '../../app/product-flow.js'
import { RestockDialog } from '../../app/RestockDialog.jsx'
import { canRestock } from '../../app/restock-flow.js'
import { supabase } from '../../lib/supabase.js'
import { InventoryHistory, InventoryReconciliation } from './InventoryAuditSections.jsx'

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

export function InventoryPage({ profile }) {
  const role = profile.user.role
  const [searchDraft, setSearchDraft] = useState('')
  const [filters, setFilters] = useState({ search: '', page: 1 })
  const [version, setVersion] = useState(0)
  const [state, setState] = useState({ kind: 'loading' })
  const [target, setTarget] = useState(null)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    let active = true
    void listProducts({ supabase, filters: { ...filters, isActive: 'all' } }).then((result) => {
      if (!active || redirectIfNeeded(result)) return
      setState(result.ok ? { kind: 'ready', ...result } : { kind: 'error', message: result.message })
    })
    return () => { active = false }
  }, [filters, version])

  function refresh() { setState({ kind: 'loading' }); setVersion((value) => value + 1) }
  function changeFilters(next) { setTarget(null); setState({ kind: 'loading' }); setFilters(next) }
  const pageCount = state.kind === 'ready' ? Math.max(1, Math.ceil(state.total / state.limit)) : 1

  return <section className="business-page inventory-page">
    <header className="business-page-heading"><span className="eyebrow">Stock control</span><h1>Inventory</h1><p>Review stock by variant. Stock changes are recorded through Restock, not direct edits.</p></header>
    {feedback && <p className="product-feedback success-message" role="status">{feedback}</p>}
    <form className="product-filter-panel inventory-filter" onSubmit={(event) => { event.preventDefault(); changeFilters({ search: searchDraft.trim(), page: 1 }) }}>
      <label htmlFor="inventory-search">Search products, SKU, or barcode</label><div className="product-actions"><input id="inventory-search" type="search" maxLength="100" placeholder="Search inventory" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /><button type="submit">Search</button><button type="button" className="secondary-action" onClick={() => { setSearchDraft(''); changeFilters({ search: '', page: 1 }) }}>Reset</button></div>
    </form>
    {state.kind === 'loading' && <div className="product-state"><div className="spinner" aria-label="Loading inventory" /><p>Loading inventory...</p></div>}
    {state.kind === 'error' && <div className="product-state"><h2>Inventory unavailable</h2><p className="error-message" role="alert">{state.message}</p><button type="button" onClick={refresh}>Try again</button></div>}
    {state.kind === 'ready' && <>
      <div className="product-list-summary"><span>{state.total} product{state.total === 1 ? '' : 's'}</span><button type="button" className="text-button" onClick={refresh}>Refresh stock</button></div>
      {state.products.length === 0 ? <div className="product-state"><h2>No inventory found</h2><p>Try another search or add a product in the catalog.</p></div> : <div className="inventory-list">{state.products.map((product) => <article className="product-panel inventory-product" key={product.id}>
        <div className="inventory-product-heading"><span className="product-image-frame">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <span className="product-image-placeholder">No image</span>}</span><div><h2>{product.name}</h2><p>{product.category.name}</p></div><span className={`product-status ${product.isActive ? '' : 'is-inactive'}`}>{product.isActive ? 'Active' : 'Inactive'}</span></div>
        {product.variants.length === 0 ? <p className="product-muted">No variants yet.</p> : <div className="inventory-variant-list">{product.variants.map((variant) => <div className="inventory-variant" key={variant.id}>
          <div><strong>{variant.sku}</strong><p>{[variant.color, variant.size].filter(Boolean).join(' / ') || 'No color / size'} · <span className={variant.isActive ? '' : 'inventory-inactive'}>{variant.isActive ? 'Active' : 'Inactive'}</span></p></div>
          <div><small>Current stock</small><strong>{variant.currentStock}</strong></div>
          {canShowVariantCost(role, variant) && <div><small>Last purchase cost</small><strong>{variant.lastPurchaseCost ?? 'Not available'}</strong></div>}
          {canRestock(role, product, variant) && <button type="button" onClick={() => { setFeedback(''); setTarget({ product, variant }) }}>Restock</button>}
        </div>)}</div>}
      </article>)}</div>}
      <nav className="product-pagination" aria-label="Inventory pages"><button type="button" className="secondary-action" disabled={filters.page <= 1} onClick={() => changeFilters({ ...filters, page: filters.page - 1 })}>Previous</button><span>Page {state.page} of {pageCount}</span><button type="button" className="secondary-action" disabled={filters.page >= pageCount} onClick={() => changeFilters({ ...filters, page: filters.page + 1 })}>Next</button></nav>
    </>}
    <InventoryHistory key={`history-${version}-${filters.page}-${filters.search}`} role={role} products={state.kind === 'ready' ? state.products : []} />
    <InventoryReconciliation key={`reconciliation-${version}-${filters.page}-${filters.search}`} products={state.kind === 'ready' ? state.products : []} />
    {target && role === 'OWNER' && <RestockDialog key={`${target.product.id}:${target.variant.id}`} product={target.product} variant={target.variant} onClose={() => setTarget(null)} onRefresh={refresh} onSuccess={(result) => {
      setTarget(null); refresh()
      setFeedback(result.idempotentReplay
        ? `This Restock was already processed. Current stock is ${result.variant.currentStock}.`
        : `Restock completed: +${result.restock.quantity} units. Updated stock: ${result.variant.currentStock}. Purchase cost: ${result.restock.unitCost}.`)
    }} />}
  </section>
}
