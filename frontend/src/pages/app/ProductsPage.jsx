import { compareSizes, operationalState } from '../../app/product-options.js'
import { readStockRecovery, writeStockRecovery, stockRecoveryKey, newStockOperation } from '../../app/stock-recovery.js'
import { useDirtyState, confirmDiscardChanges } from '../../app/dirty-state.js'
import './products.css'
import { useEffect, useRef, useState } from 'react'
import { loadCategories } from '../../app/category-flow.js'
import { CatalogConfirmation } from '../../app/CatalogConfirmation.jsx'
import { ProductCreateForm } from '../../app/ProductCreateForm.jsx'
import { canRestock } from '../../app/restock-flow.js'
import {
  canEditVariantPrice, canShowProductMargin, createVariant, findVariantDuplicate, getProduct, listProducts, removeProductImage,
  applyVariantPrice, quickAddStock, setProductActive, setVariantActive, updateProduct, updateVariant,
  uploadProductImage, validateImage,
} from '../../app/product-flow.js'
import { formatMoney, summarizeProductCatalog } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'

function newVariantDraft() { const sku = `ITEM-${crypto.randomUUID()}`; return { ...blankVariant, sku, initialSku: sku } }

const blankVariant = { sku: '', barcode: '', color: '', size: '', sellingPrice: '' }

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

function valueOrUnavailable(value) { return value == null || value === '' ? 'Not available' : value }

function ProductImage({ url, name, revision = 0 }) {
  const [failed, setFailed] = useState(false)
  return <span className="product-image-frame">{url && !failed
    ? <img key={`${url}-${revision}`} src={url} alt={name} onError={() => setFailed(true)} />
    : <span className="product-image-placeholder" aria-label="No product image"><span aria-hidden="true">◇</span><small>No image</small></span>}
  </span>
}

function ProductForm({ draft, change, categories, categoriesLoading = false, editing, busy, submit, cancel, error }) {
  return <form className="product-form" aria-describedby={error ? 'products-feedback' : undefined} onSubmit={submit}>
    <div className="product-form-grid">
      <div><label htmlFor="catalog-product-name">Product name</label><input id="catalog-product-name" autoFocus required maxLength={150} value={draft.name} disabled={busy} placeholder="e.g. Linen shirt" onChange={(event) => change({ ...draft, name: event.target.value })} /></div>
      <div><label htmlFor="catalog-product-category">Category</label><select id="catalog-product-category" required value={draft.categoryId} disabled={busy || categories.length === 0} onChange={(event) => change({ ...draft, categoryId: event.target.value })}>
        <option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select></div>
    </div>
    {categoriesLoading && <p className="product-muted">Loading categories...</p>}
    {!categoriesLoading && categories.length === 0 && <p className="product-muted">Add a category first in <a href="/app/categories">Categories</a>.</p>}
    <div className="product-actions"><button type="submit" disabled={busy || categories.length === 0}>{busy ? 'Saving...' : editing ? 'Save product' : 'Save & add sizes' }</button><button type="button" className="secondary-action" disabled={busy} onClick={cancel}>Cancel</button></div>
  </form>
}

function VariantForm({ draft, change, editing, busy, submit, cancel, role, currency, error }) {
  const fields = [
    ['color', 'Color'], ['size', 'Size'],
    ...(canEditVariantPrice(role) ? [['sellingPrice', `Selling price per piece${currency ? ` (${currency})` : ''}`]] : []),
  ]
  return <form className="product-form" aria-describedby={error ? 'products-feedback' : undefined} onSubmit={submit}>
    <h3>{editing ? 'Edit color / size' : 'Add a color / size'}</h3><p className="product-muted">One option per color and size. For example: Black / M.</p>
    <div className="product-form-grid">{fields.map(([field, label, required]) => <div key={field}><label htmlFor={`catalog-variant-${field}`}>{label}</label><input id={`catalog-variant-${field}`} autoFocus={field === 'color'} placeholder={field === 'color' ? 'e.g. Black' : field === 'size' ? 'e.g. M' : 'e.g. 15.00'} value={draft[field]} required={Boolean(required)} maxLength={field === 'sellingPrice' ? undefined : 100} inputMode={field === 'sellingPrice' ? 'decimal' : undefined} disabled={busy} onChange={(event) => change({ ...draft, [field]: event.target.value })} /></div>)}</div>
    <details className="product-optional"><summary>Product code & barcode</summary><div className="product-form-grid"><div><label htmlFor="catalog-variant-sku">Product code (SKU)</label><input id="catalog-variant-sku" maxLength={100} value={draft.sku} disabled={busy} onChange={(event) => change({ ...draft, sku: event.target.value })} /><small>A unique code is filled in for you. You can change it.</small></div><div><label htmlFor="catalog-variant-barcode">Barcode (optional)</label><input id="catalog-variant-barcode" maxLength={100} value={draft.barcode} disabled={busy} onChange={(event) => change({ ...draft, barcode: event.target.value })} /></div></div></details>
    <p className="product-muted">{role === 'OWNER' ? ' Save this option, then use + to add one piece.' : ' An owner can set the selling price and add stock after you save.'}</p>
    <div className="product-actions"><button type="submit" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Save color / size'}</button><button type="button" className="secondary-action" disabled={busy} onClick={cancel}>Cancel</button></div>
  </form>
}

function ProductCatalogCard({ product, currency, select, listVersion, imageRevision }) {
  const aggregate = product.catalogSummary
  const summary = aggregate ? {stock:aggregate.availableStock,inactiveStock:aggregate.inactiveStock,price:aggregate.priceMin===null?'Price unavailable':aggregate.priceMin===aggregate.priceMax?formatMoney(aggregate.priceMin,currency):`${formatMoney(aggregate.priceMin,currency)} - ${formatMoney(aggregate.priceMax,currency)}`} : summarizeProductCatalog(product, currency)
  const optionCount = aggregate ? aggregate.activeVariantCount : product.variants.length
  return <div className="product-card">
    <span className="product-row-identity"><ProductImage key={`${product.imageUrl || product.id}-${listVersion}`} url={product.imageUrl} name={product.name} revision={imageRevision} /><strong>{product.name}</strong></span>
    <span className="product-row-category"><span className="product-cell-label">Category</span>{product.category.name}</span>
    <span className="product-row-count"><span className="product-cell-label">Variants</span>{optionCount}</span>
    <span className="product-row-stock"><span className="product-cell-label">Stock</span>{summary.stock} <small>available</small>{summary.inactiveStock !== '0' && <small>{summary.inactiveStock} inactive</small>}</span>
    <span className="product-row-price"><span className="product-cell-label">Selling price</span>{summary.price}</span>
    <span className={`product-status ${product.isActive ? '' : 'is-inactive'}`}>{product.isActive ? 'Active' : 'Inactive'}</span>
    <span className="sr-only" id={`product-summary-${product.id}`}>{product.category.name}. {optionCount} variants. {summary.stock} units in stock. {summary.price}. {product.isActive ? 'Active' : 'Inactive'}.</span>
    <span className="product-row-open"><button type="button" className="text-button" onClick={select} aria-label={`View product: ${product.name}`} aria-describedby={`product-summary-${product.id}`}>View product</button></span>
  </div>
}

export function ProductsPage({ profile, navigate, productId }) {
  const role = profile.user.role
  const currency = profile.account?.baseCurrency
  const [categories, setCategories] = useState([])
  const [categoryState, setCategoryState] = useState({ kind: 'loading' })
  const [categoryAttempt, setCategoryAttempt] = useState(0)
  const [filters, setFilters] = useState({ search: '', categoryId: '', isActive: 'true', page: 1 })
  const [searchDraft, setSearchDraft] = useState('')
  const [filterDraft, setFilterDraft] = useState({ categoryId: '', isActive: 'true' })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [listState, setListState] = useState({ kind: 'loading' })
  const [listVersion, setListVersion] = useState(0)
  const [selectedId, setSelectedId] = useState(productId || null)
  const [detailState, setDetailState] = useState({ kind: productId ? 'loading' : 'idle' })
  const [detailVersion, setDetailVersion] = useState(0)
  const [creating, setCreating] = useState(false)
  const [editDraft, setEditDraft] = useState(null)
  const [variantEdit, setVariantEdit] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState('')
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [imageRevision, setImageRevision] = useState(0)
  const recoveryKey = stockRecoveryKey(profile.account?.id || profile.user.accountId, profile.user.id, productId)
  const [recoveryInitial] = useState(() => {
    try { return {records: role === 'OWNER' && productId ? readStockRecovery(recoveryKey) : [], error:''} }
    catch { return {records:[], error:'Stock recovery storage is unavailable. Enable browser storage before changing stock.'} }
  })
  const stockOperations = useRef(new Map(recoveryInitial.records.map(record=>[record.variantId,record])))
  const [pendingStock, setPendingStock] = useState(recoveryInitial.records)
  const [stockBusy, setStockBusy] = useState(new Set())
  const stockInFlight = useRef(new Set())
  const [recoveryError, setRecoveryError] = useState(recoveryInitial.error)
  const [priceDraft, setPriceDraft] = useState(null)
  const [priceReview, setPriceReview] = useState(false)
  const currentProduct = detailState.kind === 'ready' ? detailState.product : null
  const productDirty = editDraft && currentProduct && (editDraft.name !== currentProduct.name || editDraft.categoryId !== currentProduct.category.id)
  const existingVariant = currentProduct?.variants.find(v => v.id === variantEdit?.id)
  const variantDirty = variantEdit && (existingVariant ? ['sku','barcode','color','size','sellingPrice'].some(field => String(variantEdit.draft[field] ?? '') !== String(existingVariant[field] ?? '')) : variantEdit.draft.sku !== variantEdit.draft.initialSku || ['barcode','color','size','sellingPrice'].some(field => Boolean(variantEdit.draft[field])))
  useDirtyState(Boolean(productDirty || variantDirty || file || priceDraft?.sellingPrice))

  const mutationPending = useRef(false)
  const listRequestId = useRef(0)
  const detailRequestId = useRef(0)
  const filterToggle = useRef(null)
  const filterPanel = useRef(null)
  const detailPanel = useRef(null)
  const resultsPanel = useRef(null)

  useEffect(() => {
    let active = true
    void loadCategories({ supabase }).then((result) => {
      if (!active || redirectIfNeeded(result)) return
      if (result.ok) { setCategories(result.categories); setCategoryState({ kind: 'ready' }) }
      else setCategoryState({ kind: 'error', message: result.message })
    })
    return () => { active = false }
  }, [categoryAttempt])

  useEffect(() => {
    if (productId) return undefined
    let active = true
    const requestId = listRequestId.current
    void listProducts({ supabase, filters, summary: true }).then((result) => {
      if (!active || requestId !== listRequestId.current || redirectIfNeeded(result)) return
      setListState(result.ok ? { kind: 'ready', ...result } : { kind: 'error', message: result.message })
    })
    return () => { active = false }
  }, [filters, listVersion, productId])

  useEffect(() => {
    if (!selectedId) return undefined
    let active = true
    const requestId = detailRequestId.current
    void getProduct({ supabase, productId: selectedId }).then((result) => {
      if (!active || requestId !== detailRequestId.current || redirectIfNeeded(result)) return
      setDetailState(result.ok ? { kind: 'ready', product: result.product } : { kind: 'error', message: result.message })
    })
    return () => { active = false }
  }, [selectedId, detailVersion])

  useEffect(() => {
    if (selectedId && detailState.kind !== 'loading') {
      detailPanel.current?.scrollIntoView({ block: 'start' })
      detailPanel.current?.focus({ preventScroll: true })
    }
  }, [selectedId, detailState.kind])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 701px)')
    function closeOnDesktop(event) { if (event.matches) setFiltersOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => {
    if (!filtersOpen) return undefined
    const panel = filterPanel.current
    const toggle = filterToggle.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = panel ? [...panel.querySelectorAll('button, select, input')] : []
    focusable[0]?.focus()
    function closeFilters(event) {
      if (event.key === 'Escape') setFiltersOpen(false)
      if (event.key !== 'Tab' || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', closeFilters)
    return () => {
      window.removeEventListener('keydown', closeFilters)
      document.body.style.overflow = previousOverflow
      toggle?.focus()
    }
  }, [filtersOpen])

  function chooseFile(selected) {
    setFile(selected)
    setPreviewUrl(selected ? URL.createObjectURL(selected) : null)
  }

  function refreshList() { listRequestId.current += 1; setListState({ kind: 'loading' }); setListVersion((version) => version + 1) }
  function refreshDetail() { detailRequestId.current += 1; setDetailVersion((version) => version + 1) }
  function applyFilters(next) { listRequestId.current += 1; setListState({ kind: 'loading' }); setFilters(next) }
  function selectProduct(id) {
    navigate(`/app/products/${encodeURIComponent(id)}`)
  }

  async function run(action, operation) {
    if (mutationPending.current || stockInFlight.current.size) return null
    mutationPending.current = true; setBusy(action); setFeedback(null)
    try {
      const result = await operation()
      if (redirectIfNeeded(result)) return null
      if (!result.ok) setFeedback({ kind: 'error', message: result.message })
      return result
    } catch {
      setFeedback({ kind: 'error', message: 'Something went wrong. Please try again.' })
      return null
    } finally { mutationPending.current = false; setBusy('') }
  }

  async function changeStock(variant, delta, retry = false) {
    if (stockInFlight.current.has(variant.id) || busy || recoveryError) return
    let record = stockOperations.current.get(variant.id)
    if (record && !retry) return
    if (!record) record = newStockOperation(variant.id, delta)
    stockOperations.current.set(variant.id, record)
    try { writeStockRecovery(recoveryKey, [...stockOperations.current.values()]) }
    catch { setRecoveryError('Stock update was not sent because recovery storage is unavailable.'); return }
    setPendingStock([...stockOperations.current.values()])
    stockInFlight.current.add(variant.id); setStockBusy(new Set(stockInFlight.current)); setFeedback(null)
    try {
      const result = await quickAddStock({supabase, productId:selectedId, variantId:variant.id, operationId:record.operationId, delta:record.delta})
      if (redirectIfNeeded(result)) return
      if (result.ok || !result.uncertain) {
        stockOperations.current.delete(variant.id)
        try { writeStockRecovery(recoveryKey, [...stockOperations.current.values()]) }
        catch { stockOperations.current.set(variant.id, record); setRecoveryError('The response arrived, but recovery storage could not be cleared. Reload before continuing.') }
        setPendingStock([...stockOperations.current.values()])
      }
      if (!result.ok) { setFeedback({kind:'error', message:result.message}); return }
      setDetailState(current => current.kind === 'ready' ? {...current, product:{...current.product, variants:current.product.variants.map(item => item.id === variant.id ? result.variant : item)}} : current)
      setFeedback({kind:'success', message:`Stock saved. ${variant.color || ''} / ${variant.size || ''}: ${result.variant.currentStock} pieces.`})
    } catch { setFeedback({kind:'error', message:'Stock update awaiting confirmation. Retry the same update below.'}) }
    finally { stockInFlight.current.delete(variant.id); setStockBusy(new Set(stockInFlight.current)) }
  }

  async function submitPrices(event) {
    event.preventDefault()
    if (!priceReview) { setPriceReview(true); return }
    const result = await run('bulk-price', () => applyVariantPrice({supabase, productId:selectedId, ...priceDraft}))
    if (!result?.ok) return
    setDetailState({kind:'ready',product:result.product}); setPriceDraft(null); setPriceReview(false)
    setFeedback({kind:'success',message:'Selected option prices updated together.'})
  }

  async function submitEdit(event) {
    event.preventDefault()
    const result = await run('product-edit', () => updateProduct({ supabase, productId: selectedId, draft: editDraft, role, current: detailState.product }))
    if (!result?.ok) return
    setDetailState({ kind: 'ready', product: result.product }); setEditDraft(null); refreshList()
    setFeedback({ kind: 'success', message: result.unchanged ? 'No product changes to save.' : 'Product updated.' })
  }

  async function submitVariant(event) {
    event.preventDefault()
    const editing = variantEdit.id
    const duplicate = findVariantDuplicate(variantEdit.draft, detailState.product.variants, editing)
    if (!duplicate.ok) { setFeedback({ kind: 'error', message: duplicate.message }); return }
    const result = await run('variant', () => editing
      ? updateVariant({ supabase, productId: selectedId, variantId: editing, draft: variantEdit.draft, role })
      : createVariant({ supabase, productId: selectedId, draft: variantEdit.draft, role }))
    if (!result?.ok) return
    setVariantEdit(null); refreshDetail(); refreshList()
    setFeedback({ kind: 'success', message: editing ? 'Variant updated.' : role === 'OWNER' ? 'Color / size saved. Use + or - to adjust stock by one piece.' : 'Color / size saved. An owner can now set the price and add stock.' })
  }

  async function confirmStatus() {
    const target = confirmation
    if (!target) return
    const result = await run('status', () => target.kind === 'product'
      ? setProductActive({ supabase, productId: selectedId, isActive: target.next })
      : setVariantActive({ supabase, productId: selectedId, variantId: target.id, isActive: target.next }))
    if (!result?.ok) return
    if (target.kind === 'product') setDetailState({ kind: 'ready', product: result.product })
    else refreshDetail()
    refreshList(); setConfirmation(null)
    setFeedback({ kind: 'success', message: `${target.kind === 'product' ? 'Product' : 'Variant'} ${target.next ? 'reactivated' : 'deactivated'}.` })
  }

  async function submitImage(event) {
    event.preventDefault()
    const valid = validateImage(file)
    if (!valid.ok) { setFeedback({ kind: 'error', message: valid.message }); return }
    const result = await run('image-upload', () => uploadProductImage({ supabase, productId: selectedId, file }))
    if (!result?.ok) return
    setDetailState({ kind: 'ready', product: result.product }); setImageRevision((n) => n + 1)
    chooseFile(null); refreshList(); setFeedback({ kind: 'success', message: 'Product image saved.' })
  }

  async function confirmImageRemove() {
    const result = await run('image-remove', () => removeProductImage({ supabase, productId: selectedId }))
    if (!result?.ok) return
    setDetailState({ kind: 'ready', product: { ...detail, imageUrl: null } })
    setConfirmation(null); chooseFile(null); refreshDetail(); refreshList()
    setFeedback({ kind: 'success', message: 'Product image removed.' })
  }

  const detail = detailState.kind === 'ready' ? detailState.product : null
  const variantGroups = detail ? [...detail.variants.reduce((groups, variant) => {
    const name = variant.color?.trim() || 'No color'
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(variant)
    return groups
  }, new Map())].map(([color, variants]) => [color, [...variants].sort(compareSizes)]) : []
  const pageCount = listState.kind === 'ready' ? Math.max(1, Math.ceil(listState.total / listState.limit)) : 1

  return <section className="business-page products-page">
    {!productId && <header className="business-page-heading product-page-heading"><div><h1>Products</h1><p>Manage your catalog, colors, sizes and pricing.</p></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => { detailRequestId.current += 1; setCreating(true); setVariantEdit(null); setEditDraft(null); setConfirmation(null); setSelectedId(null); setDetailState({ kind: 'idle' }); chooseFile(null); setFeedback(null) }}><span aria-hidden="true">+ </span>Add product</button></header>}
    {!currency && <p className="product-feedback error-message" role="alert">Account currency is unavailable. Monetary values cannot be displayed safely.</p>}
    {recoveryError && <p role="alert" className="product-feedback error-message">{recoveryError}</p>}
    {feedback && <p id="products-feedback" className={`product-feedback ${feedback.kind}-message`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    {creating && <ProductCreateForm role={role} currency={currency} categories={categories} categoriesLoading={categoryState.kind === 'loading'}
      onBusy={(pending) => setBusy(pending ? 'create' : '')}
      onCancel={() => { setCreating(false); refreshList() }}
      onSaved={(productId, partial = false) => { selectProduct(productId); refreshList(); setFeedback({ kind: 'success', message: partial ? 'Showing the saved product. Review its options and stock below.' : 'Product and colors / sizes saved.' }) }} />}


    <div className={`product-catalog-layout ${creating ? 'is-creating' : ''}`}>{!productId && <div className="product-list-column" ref={resultsPanel} tabIndex={-1} aria-label="Product catalog">
      <form className="product-filter-panel" onSubmit={(event) => { event.preventDefault(); applyFilters({ search: searchDraft.trim(), ...filterDraft, page: 1 }); setFiltersOpen(false) }}>
        <div className="product-search-row"><div><label htmlFor="product-search">Search</label><input id="product-search" type="search" maxLength={100} value={searchDraft} placeholder="Product name, SKU or barcode" onChange={(event) => setSearchDraft(event.target.value)} /></div><button ref={filterToggle} type="button" className="secondary-action product-filter-toggle" aria-expanded={filtersOpen} aria-controls="product-filter-options" onClick={() => setFiltersOpen((open) => !open)}>Filters</button><button type="submit">Search</button></div>
        {filtersOpen && <button className="product-filter-backdrop" type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />}
        <div ref={filterPanel} id="product-filter-options" className={`product-filter-options ${filtersOpen ? 'is-open' : ''}`} role={filtersOpen ? 'dialog' : undefined} aria-modal={filtersOpen ? 'true' : undefined} aria-label="Product filters"><div className="product-filter-sheet-heading"><strong>Filter products</strong><button type="button" className="text-button" onClick={() => setFiltersOpen(false)}>Close</button></div><div className="product-filter-fields"><div><label htmlFor="product-category-filter">Category</label><select id="product-category-filter" value={filterDraft.categoryId} onChange={(event) => setFilterDraft({ ...filterDraft, categoryId: event.target.value })}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div><label htmlFor="product-status-filter">Status</label><select id="product-status-filter" value={filterDraft.isActive} onChange={(event) => setFilterDraft({ ...filterDraft, isActive: event.target.value })}><option value="true">Active products</option><option value="false">Inactive products</option><option value="all">All products</option></select></div></div>
        <div className="product-actions"><button type="submit">Apply</button><button type="button" className="secondary-action" onClick={() => { setSearchDraft(''); setFilterDraft({ categoryId: '', isActive: 'true' }); setFiltersOpen(false); applyFilters({ search: '', categoryId: '', isActive: 'true', page: 1 }) }}>Clear</button></div></div>
      </form>
      {categoryState.kind === 'error' && <p className="product-inline-error" role="alert">Categories unavailable. {categoryState.message} <button className="text-button" type="button" onClick={() => setCategoryAttempt((n) => n + 1)}>Retry</button></p>}
      {listState.kind === 'loading' && <div className="product-state"><div className="spinner" aria-label="Loading products" /><p>Loading products...</p></div>}
      {listState.kind === 'error' && <div className="product-state"><h2>Products unavailable</h2><p className="error-message" role="alert">{listState.message}</p><button type="button" onClick={refreshList}>Try again</button></div>}
      {listState.kind === 'ready' && listState.products.length === 0 && <div className="product-state"><h2>{filters.search || filters.categoryId || filters.isActive !== 'true' ? 'No matching products' : 'No products yet'}</h2><p>{filters.search || filters.categoryId || filters.isActive !== 'true' ? 'Try changing your search or filters.' : 'Add your first product to start building your catalog.'}</p>{!filters.search && !filters.categoryId && filters.isActive === 'true' && <button type="button" onClick={() => setCreating(true)}>Add product</button>}</div>}
      {listState.kind === 'ready' && listState.products.length > 0 && <><div className="product-list-summary"><span>{listState.total} product{listState.total === 1 ? '' : 's'}</span><button className="text-button" type="button" onClick={() => { refreshList(); if (selectedId) refreshDetail() }}>Refresh images</button></div>
        <div className="product-results"><div className="product-table-heading" aria-hidden="true"><span>Product</span><span>Category</span><span>Variants</span><span>Stock</span><span>Selling price</span><span>Status</span><span>Action</span></div><div className="product-card-list">{listState.products.map((product) => <ProductCatalogCard key={product.id} product={product} currency={currency} selected={selectedId === product.id} select={() => selectProduct(product.id)} listVersion={listVersion} imageRevision={imageRevision} />)}</div></div><nav className="product-pagination" aria-label="Product pages"><button type="button" className="secondary-action" disabled={filters.page <= 1} onClick={() => applyFilters({ ...filters, page: filters.page - 1 })}>Previous</button><span>Page {listState.page} of {pageCount}</span><button type="button" className="secondary-action" disabled={filters.page >= pageCount} onClick={() => applyFilters({ ...filters, page: filters.page + 1 })}>Next</button></nav></>}
    </div>}<div ref={detailPanel} className={`product-detail-column ${selectedId ? 'has-selection' : ''}`} tabIndex={-1} aria-label="Selected product details">
      {selectedId && <div className="product-detail-navigation"><button type="button" className="secondary-action" disabled={Boolean(busy)} onClick={() => { if (confirmDiscardChanges()) navigate('/app/products') }}>Back to products</button><span>Product details</span></div>}
      {detailState.kind === 'loading' && selectedId && <div className="product-state"><div className="spinner" aria-label="Loading product details" /><p>Loading product details...</p></div>}
      {detailState.kind === 'error' && selectedId && <div className="product-state"><h2>Product unavailable</h2><p className="error-message" role="alert">{detailState.message}</p><button type="button" onClick={() => { setDetailState({ kind: 'loading' }); refreshDetail() }}>Try again</button></div>}
      {detail && selectedId && <div className="product-detail-stack">
        <section className="product-panel product-overview">
          <div className="product-overview-summary"><ProductImage key={`${detail.imageUrl || detail.id}-${detailVersion}-${imageRevision}`} url={detail.imageUrl} name={detail.name} revision={imageRevision} /><div className="product-overview-identity"><h2>{detail.name}</h2><div className="product-overview-meta"><span>{detail.category.name}</span><span>{detail.variants.length} option{detail.variants.length === 1 ? '' : 's'}</span><span className={`product-status ${detail.isActive ? '' : 'is-inactive'}`}>{detail.isActive ? 'Active' : 'Inactive'}</span></div>{canShowProductMargin(role, detail) && detail.profitMarginOverride != null && <p>Margin override: {valueOrUnavailable(detail.profitMarginOverride)}</p>}</div></div>
          <div className="product-actions"><button type="button" className="secondary-action" disabled={Boolean(busy)} onClick={() => { if (productDirty && !confirmDiscardChanges()) return; setFeedback(null); setEditDraft({ name: detail.name, categoryId: detail.category.id, profitMarginOverride: detail.profitMarginOverride ?? '' }); setConfirmation(null) }} aria-label="Edit product">Edit</button><button type="button" className={detail.isActive ? 'product-danger-button' : 'secondary-action'} disabled={Boolean(busy) || stockBusy.size > 0} onClick={() => { setFeedback(null); setConfirmation({ kind: 'product', next: !detail.isActive, label: detail.name }); setEditDraft(null) }}>{detail.isActive ? 'Deactivate product' : 'Reactivate product'}</button></div>
          {editDraft && <ProductForm draft={editDraft} change={setEditDraft} categories={categories.some((category) => category.id === detail.category.id) ? categories : [...categories, detail.category]} role={role} editing error={feedback?.kind === 'error'} busy={Boolean(busy) || stockBusy.size > 0} submit={submitEdit} cancel={() => { if (!productDirty || confirmDiscardChanges()) { setEditDraft(null); setVariantEdit(null) } }} />}
        </section>
        {role === 'OWNER' && <div className="product-bulk-price"><button type="button" className="secondary-action" disabled={Boolean(busy) || stockBusy.size > 0 || !detail.isActive} onClick={() => {setPriceDraft({sellingPrice:'',variantIds:detail.variants.filter(v=>v.isActive).slice(0,200).map(v=>v.id)});setPriceReview(false)}}>Apply price to variants</button>
        {priceDraft && <form className="product-form" onSubmit={submitPrices}><label htmlFor="product-common-price">Selling price ({currency})</label><input id="product-common-price" required inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?" value={priceDraft.sellingPrice} disabled={Boolean(busy)} onChange={event=>{setPriceDraft({...priceDraft,sellingPrice:event.target.value});setPriceReview(false)}} />
        <div className="product-price-targets">{detail.variants.filter(v=>v.isActive).map(v=><label key={v.id}><input type="checkbox" checked={priceDraft.variantIds.includes(v.id)} disabled={Boolean(busy)} onChange={event=>{setPriceDraft({...priceDraft,variantIds:event.target.checked?[...priceDraft.variantIds,v.id]:priceDraft.variantIds.filter(id=>id!==v.id)});setPriceReview(false)}} />{v.color || 'No color'} / {v.size || 'No size'} ? {v.sellingPrice == null?'Not set':formatMoney(v.sellingPrice,currency)}</label>)}</div>
        <p>{priceDraft.variantIds.length} selected options (up to 200 per update). {priceReview ? `Confirm replacing their existing prices with ${priceDraft.sellingPrice} ${currency}. Unselected options stay unchanged.` : 'Review existing prices above before confirming.'}</p>
        <div className="product-actions"><button type="submit" disabled={Boolean(busy)||!priceDraft.variantIds.length||priceDraft.variantIds.length>200}>{priceReview?'Confirm price update':'Review price update'}</button><button type="button" className="secondary-action" disabled={Boolean(busy)} onClick={()=>{if(confirmDiscardChanges()){setPriceDraft(null);setPriceReview(false)}}}>Cancel</button></div></form>}</div>}
        <section className="product-panel"><div className="product-section-heading"><div><h2>Colors & sizes</h2><p>Stock and price by size.</p></div><button type="button" className="secondary-action" disabled={Boolean(busy) || !detail.isActive} onClick={() => { if (!variantDirty || confirmDiscardChanges()) setVariantEdit({ id: null, draft: newVariantDraft() }) }}>Add color / size</button></div>
          {!detail.isActive && <p className="product-muted">Reactivate this product before adding variants.</p>}
          {variantEdit && <VariantForm draft={variantEdit.draft} change={(draft) => setVariantEdit({ ...variantEdit, draft })} editing={Boolean(variantEdit.id)} busy={Boolean(busy) || stockBusy.size > 0} submit={submitVariant} cancel={() => { if (!variantDirty || confirmDiscardChanges()) { setVariantEdit(null) } }} role={role} currency={currency} error={feedback?.kind === 'error'} />}
          {detail.variants.length === 0 ? <p className="product-muted">Add your first color and size.</p> : <div className="product-color-stock-grid">{variantGroups.map(([color, variants]) => <section className="product-color-stock-card" style={{'--variant-count':variants.length}} key={color} aria-label={`${color} sizes and stock`}>
            <header className="product-color-stock-header"><h3>{color}</h3><span>{variants.length} sizes / {variants.filter(v=>detail.isActive&&v.isActive).reduce((total, variant) => total + variant.currentStock, 0)} available / {variants.filter(v=>!detail.isActive||!v.isActive).reduce((sum,v)=>sum+v.currentStock,0)} inactive pieces</span></header>
            {variants.map((variant) => <article className="product-stock-row" key={variant.id} aria-label={`${color} / ${variant.size || 'No size'}`}>
              <div className="product-option-state">{operationalState(detail, variant, role)}{role === 'OWNER' && variant.lastPurchaseCost === null && <a href="/app/inventory" title="Set purchase cost in Inventory; historical sales remain unchanged">Cost pending</a>}</div>
              <strong className="product-stock-size">{variant.size || '?'}{!variant.isActive && <small>Inactive</small>}</strong>
              <span className={`product-stock-quantity ${variant.currentStock === 0 ? 'is-empty' : ''}`}><small className="product-stock-label">Stock</small>{variant.currentStock}</span>
              <span className="product-stock-price"><small className="product-stock-label">Price</small>{variant.sellingPrice == null ? 'Not set' : formatMoney(variant.sellingPrice, currency)}</span>
              <div className="product-stock-actions">{canRestock(role, detail, variant) && <><button type="button" className="secondary-action stock-step" aria-label="Remove stock" title="Remove one piece" disabled={Boolean(busy) || stockBusy.has(variant.id) || pendingStock.some(r=>r.variantId===variant.id) || Boolean(recoveryError) || variant.currentStock === 0} onClick={() => changeStock(variant, -1)}>&minus;</button><button type="button" className="secondary-action stock-step" aria-label="Add stock" title="Add one piece" disabled={Boolean(busy) || stockBusy.has(variant.id) || pendingStock.some(r=>r.variantId===variant.id) || Boolean(recoveryError)} onClick={() => changeStock(variant, 1)}>+</button></>}<button type="button" className="secondary-action" disabled={Boolean(busy) || stockBusy.has(variant.id)} onClick={() => { if (variantDirty && !confirmDiscardChanges()) return; setVariantEdit({ id: variant.id, draft: { sku: variant.sku, barcode: variant.barcode ?? '', color: variant.color ?? '', size: variant.size ?? '', sellingPrice: variant.sellingPrice ?? '' } }); setConfirmation(null) }}>Edit</button></div>
              {stockBusy.has(variant.id) ? <p className="product-stock-recovery" role="status">Updating...</p> : pendingStock.find(r=>r.variantId===variant.id) && <div className="product-stock-recovery"><p>Stock update awaiting confirmation</p>{pendingStock.find(r=>r.variantId===variant.id)?.requiresReview && <p>Older update: review Inventory before retrying this original request.</p>}<button type="button" className="secondary-action" disabled={Boolean(busy)||Boolean(recoveryError)} onClick={()=>changeStock(variant, pendingStock.find(r=>r.variantId===variant.id).delta, true)}>Retry same update</button></div>}
              <details className="product-stock-more product-optional"><summary aria-label={`Details and options for ${color} / ${variant.size || 'No size'}`}>More</summary><div className="product-stock-extra">
                <dl><div><dt>SKU</dt><dd>{variant.sku}</dd></div></dl>
                <button type="button" className={variant.isActive ? 'product-danger-button' : 'secondary-action'} disabled={Boolean(busy) || stockBusy.size > 0} onClick={() => { setFeedback(null); setConfirmation({ kind: 'variant', id: variant.id, next: !variant.isActive, label: `${detail.name} / ${[variant.color, variant.size].filter(Boolean).join(' / ') || variant.sku}` }); setVariantEdit(null) }}>{variant.isActive ? 'Deactivate variant' : 'Reactivate variant'}</button>
              </div></details>
            </article>)}
          </section>)}</div>}

        </section>
        <details className="product-photo-action product-optional"><summary>Product photo (optional)</summary><p className="product-muted">JPEG, PNG, or static WebP. Maximum 10 MiB. One primary image per product.</p>
          <form className="product-image-form" onSubmit={submitImage}><label htmlFor="product-image-file">Choose image</label><input key={`${selectedId}-${imageRevision}`} id="product-image-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={(event) => chooseFile(event.target.files?.[0] || null)} />{previewUrl && <div className="product-image-preview"><img src={previewUrl} alt="Local preview, not yet uploaded" /><span>Local preview — not saved</span></div>}
            <div className="product-actions"><button type="submit" disabled={!file || Boolean(busy)}>{busy === 'image-upload' ? 'Uploading...' : detail.imageUrl ? 'Replace image' : 'Upload image'}</button>{detail.imageUrl && <button type="button" className="product-danger-button" disabled={Boolean(busy) || stockBusy.size > 0} onClick={() => { setFeedback(null); setConfirmation({ kind: 'image', label: detail.name }) }}>Remove image</button>}</div></form>
        </details>
        {confirmation && <CatalogConfirmation target={confirmation} busy={Boolean(busy)} error={feedback?.kind === 'error' ? feedback.message : null} onConfirm={confirmation.kind === 'image' ? confirmImageRemove : confirmStatus} onClose={() => setConfirmation(null)} />}
      </div>}
    </div></div>

  </section>
}
