import { useEffect, useRef, useState } from 'react'
import { loadCategories } from '../../app/category-flow.js'
import {
  canShowProductMargin, canShowVariantCost, createProduct, createVariant, getProduct, listProducts, removeProductImage,
  setProductActive, setVariantActive, updateProduct, updateVariant,
  uploadProductImage, validateImage,
} from '../../app/product-flow.js'
import { supabase } from '../../lib/supabase.js'

const blankProduct = { name: '', categoryId: '', profitMarginOverride: '' }
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

function ProductForm({ draft, change, categories, categoriesLoading = false, role, editing, busy, submit, cancel }) {
  return <form className="product-form" onSubmit={submit}>
    <div className="product-form-grid">
      <div><label htmlFor="catalog-product-name">Product name</label><input id="catalog-product-name" required maxLength={150} value={draft.name} disabled={busy} placeholder="e.g. Linen shirt" onChange={(event) => change({ ...draft, name: event.target.value })} /></div>
      <div><label htmlFor="catalog-product-category">Category</label><select id="catalog-product-category" required value={draft.categoryId} disabled={busy || categories.length === 0} onChange={(event) => change({ ...draft, categoryId: event.target.value })}>
        <option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select></div>
      {role === 'OWNER' && <div><label htmlFor="catalog-product-margin">Profit margin override</label><input id="catalog-product-margin" inputMode="decimal" value={draft.profitMarginOverride} disabled={busy} placeholder="Optional, e.g. 0.3000" onChange={(event) => change({ ...draft, profitMarginOverride: event.target.value })} /><small>Optional fraction between 0 and 1.</small></div>}
    </div>
    {categoriesLoading && <p className="product-muted">Loading categories...</p>}
    {!categoriesLoading && categories.length === 0 && <p className="product-muted">Add a category first in <a href="/app/categories">Categories</a>.</p>}
    <div className="product-actions"><button type="submit" disabled={busy || categories.length === 0}>{busy ? 'Saving...' : editing ? 'Save product' : 'Create product'}</button><button type="button" className="secondary-action" disabled={busy} onClick={cancel}>Cancel</button></div>
  </form>
}

function VariantForm({ draft, change, editing, busy, submit, cancel }) {
  return <form className="product-form" onSubmit={submit}>
    <div className="product-form-grid">{[
      ['sku', 'SKU', true], ['barcode', 'Barcode'], ['color', 'Color'], ['size', 'Size'], ['sellingPrice', 'Default selling price'],
    ].map(([field, label, required]) => <div key={field}><label htmlFor={`catalog-variant-${field}`}>{label}</label><input id={`catalog-variant-${field}`} value={draft[field]} required={Boolean(required)} maxLength={field === 'sellingPrice' ? undefined : 100} inputMode={field === 'sellingPrice' ? 'decimal' : undefined} disabled={busy} onChange={(event) => change({ ...draft, [field]: event.target.value })} /></div>)}</div>
    <p className="product-muted">Stock and purchase cost are read-only. Initial stock belongs to the future Restock flow.</p>
    <div className="product-actions"><button type="submit" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save variant' : 'Add variant'}</button><button type="button" className="secondary-action" disabled={busy} onClick={cancel}>Cancel</button></div>
  </form>
}

export function ProductsPage({ profile }) {
  const role = profile.user.role
  const [categories, setCategories] = useState([])
  const [categoryState, setCategoryState] = useState({ kind: 'loading' })
  const [categoryAttempt, setCategoryAttempt] = useState(0)
  const [filters, setFilters] = useState({ search: '', categoryId: '', isActive: 'true', page: 1 })
  const [searchDraft, setSearchDraft] = useState('')
  const [listState, setListState] = useState({ kind: 'loading' })
  const [listVersion, setListVersion] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [detailState, setDetailState] = useState({ kind: 'idle' })
  const [detailVersion, setDetailVersion] = useState(0)
  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState(blankProduct)
  const [editDraft, setEditDraft] = useState(null)
  const [variantEdit, setVariantEdit] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState('')
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [imageRevision, setImageRevision] = useState(0)
  const mutationPending = useRef(false)
  const listRequestId = useRef(0)
  const detailRequestId = useRef(0)

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
    let active = true
    const requestId = listRequestId.current
    void listProducts({ supabase, filters }).then((result) => {
      if (!active || requestId !== listRequestId.current || redirectIfNeeded(result)) return
      setListState(result.ok ? { kind: 'ready', ...result } : { kind: 'error', message: result.message })
    })
    return () => { active = false }
  }, [filters, listVersion])

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

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function chooseFile(selected) {
    setFile(selected)
    setPreviewUrl(selected ? URL.createObjectURL(selected) : null)
  }

  function refreshList() { listRequestId.current += 1; setListState({ kind: 'loading' }); setListVersion((version) => version + 1) }
  function refreshDetail() { detailRequestId.current += 1; setDetailVersion((version) => version + 1) }
  function applyFilters(next) { listRequestId.current += 1; setListState({ kind: 'loading' }); setFilters(next) }
  function selectProduct(id) {
    detailRequestId.current += 1
    setSelectedId(id); setDetailState({ kind: 'loading' }); setCreating(false)
    setEditDraft(null); setVariantEdit(null); setConfirmation(null); chooseFile(null); setFeedback(null)
    if (id === selectedId) refreshDetail()
  }

  async function run(action, operation) {
    if (mutationPending.current) return null
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

  async function submitCreate(event) {
    event.preventDefault()
    const result = await run('create', () => createProduct({ supabase, draft: createDraft, role }))
    if (!result?.ok) return
    setCreating(false); setCreateDraft(blankProduct); setSelectedId(result.product.id)
    setDetailState({ kind: 'ready', product: result.product }); refreshList()
    setFeedback({ kind: 'success', message: 'Product created. You can now add an image or variants.' })
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
    const result = await run('variant', () => editing
      ? updateVariant({ supabase, productId: selectedId, variantId: editing, draft: variantEdit.draft })
      : createVariant({ supabase, productId: selectedId, draft: variantEdit.draft }))
    if (!result?.ok) return
    setVariantEdit(null); refreshDetail(); refreshList()
    setFeedback({ kind: 'success', message: editing ? 'Variant updated.' : 'Variant added with zero stock.' })
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
  const pageCount = listState.kind === 'ready' ? Math.max(1, Math.ceil(listState.total / listState.limit)) : 1

  return <section className="business-page products-page">
    <header className="business-page-heading product-page-heading"><div><span className="eyebrow">Catalog</span><h1>Products</h1><p>Manage clothing styles, variants, and their primary image.</p></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => { detailRequestId.current += 1; setCreating(true); setSelectedId(null); setDetailState({ kind: 'idle' }); chooseFile(null); setFeedback(null) }}>Add product</button></header>
    {feedback && <p className={`product-feedback ${feedback.kind}-message`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    {creating && <section className="product-panel" aria-label="Create product"><span className="eyebrow">New catalog item</span><h2>Add product</h2><p className="product-muted">Create the product first. Its image and variants are optional.</p>
      <ProductForm draft={createDraft} change={setCreateDraft} categories={categories} categoriesLoading={categoryState.kind === 'loading'} role={role} busy={Boolean(busy)} submit={submitCreate} cancel={() => setCreating(false)} /></section>}

    <div className="product-catalog-layout"><div className="product-list-column">
      <form className="product-filter-panel" onSubmit={(event) => { event.preventDefault(); applyFilters({ ...filters, search: searchDraft.trim(), page: 1 }) }}>
        <label htmlFor="product-search">Search products, SKU, or barcode</label><input id="product-search" type="search" maxLength={100} value={searchDraft} placeholder="Search catalog" onChange={(event) => setSearchDraft(event.target.value)} />
        <div className="product-filter-fields"><div><label htmlFor="product-category-filter">Category</label><select id="product-category-filter" value={filters.categoryId} onChange={(event) => applyFilters({ ...filters, categoryId: event.target.value, page: 1 })}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div><label htmlFor="product-status-filter">Status</label><select id="product-status-filter" value={filters.isActive} onChange={(event) => applyFilters({ ...filters, isActive: event.target.value, page: 1 })}><option value="true">Active products</option><option value="false">Inactive products</option><option value="all">All products</option></select></div></div>
        <div className="product-actions"><button type="submit">Search</button><button type="button" className="secondary-action" onClick={() => { setSearchDraft(''); applyFilters({ search: '', categoryId: '', isActive: 'true', page: 1 }) }}>Reset</button></div>
      </form>
      {categoryState.kind === 'error' && <p className="product-inline-error" role="alert">Categories unavailable. {categoryState.message} <button className="text-button" type="button" onClick={() => setCategoryAttempt((n) => n + 1)}>Retry</button></p>}
      {listState.kind === 'loading' && <div className="product-state"><div className="spinner" aria-label="Loading products" /><p>Loading products...</p></div>}
      {listState.kind === 'error' && <div className="product-state"><h2>Products unavailable</h2><p className="error-message" role="alert">{listState.message}</p><button type="button" onClick={refreshList}>Try again</button></div>}
      {listState.kind === 'ready' && listState.products.length === 0 && <div className="product-state"><h2>No products found</h2><p>{filters.search || filters.categoryId || filters.isActive !== 'true' ? 'Try changing your search or filters.' : 'Add your first product to start your catalog.'}</p>{!filters.search && !filters.categoryId && filters.isActive === 'true' && <button type="button" onClick={() => setCreating(true)}>Add product</button>}</div>}
      {listState.kind === 'ready' && listState.products.length > 0 && <><div className="product-list-summary"><span>{listState.total} product{listState.total === 1 ? '' : 's'}</span><button className="text-button" type="button" onClick={() => { refreshList(); if (selectedId) refreshDetail() }}>Refresh images</button></div>
        <div className="product-card-list">{listState.products.map((product) => <button type="button" key={product.id} className={`product-card ${selectedId === product.id ? 'is-selected' : ''}`} onClick={() => selectProduct(product.id)}>
          <ProductImage key={`${product.imageUrl || product.id}-${listVersion}`} url={product.imageUrl} name={product.name} revision={imageRevision} /><span className="product-card-copy"><strong>{product.name}</strong><span>{product.category.name}</span><span>{product.variants.length} variant{product.variants.length === 1 ? '' : 's'}</span>{product.variants.length > 0 && <small>{product.variants.slice(0, 2).map((variant) => variant.sku).join(' · ')}</small>}{canShowProductMargin(role, product) && product.profitMarginOverride != null && <small>Margin override: {product.profitMarginOverride}</small>}</span><span className={`product-status ${product.isActive ? '' : 'is-inactive'}`}>{product.isActive ? 'Active' : 'Inactive'}</span>
        </button>)}</div><nav className="product-pagination" aria-label="Product pages"><button type="button" className="secondary-action" disabled={filters.page <= 1} onClick={() => applyFilters({ ...filters, page: filters.page - 1 })}>Previous</button><span>Page {listState.page} of {pageCount}</span><button type="button" className="secondary-action" disabled={filters.page >= pageCount} onClick={() => applyFilters({ ...filters, page: filters.page + 1 })}>Next</button></nav></>}
    </div><div className="product-detail-column">
      {!selectedId && !creating && <div className="product-state"><h2>Select a product</h2><p>Choose a product to manage its image, details, and variants.</p></div>}
      {detailState.kind === 'loading' && selectedId && <div className="product-state"><div className="spinner" aria-label="Loading product details" /><p>Loading product details...</p></div>}
      {detailState.kind === 'error' && selectedId && <div className="product-state"><h2>Product unavailable</h2><p className="error-message" role="alert">{detailState.message}</p><button type="button" onClick={() => { setDetailState({ kind: 'loading' }); refreshDetail() }}>Try again</button></div>}
      {detail && selectedId && <div className="product-detail-stack">
        <section className="product-panel"><div className="product-section-heading"><div><span className="eyebrow">Product details</span><h2>{detail.name}</h2><p>{detail.category.name}</p></div><span className={`product-status ${detail.isActive ? '' : 'is-inactive'}`}>{detail.isActive ? 'Active' : 'Inactive'}</span></div>
          <div className="product-hero"><ProductImage key={`${detail.imageUrl || detail.id}-${detailVersion}-${imageRevision}`} url={detail.imageUrl} name={detail.name} revision={imageRevision} /><div><p>{detail.variants.length} variant{detail.variants.length === 1 ? '' : 's'}</p>{canShowProductMargin(role, detail) && <p>Margin override: {valueOrUnavailable(detail.profitMarginOverride)}</p>}<div className="product-actions"><button type="button" className="secondary-action" disabled={Boolean(busy)} onClick={() => { setEditDraft({ name: detail.name, categoryId: detail.category.id, profitMarginOverride: detail.profitMarginOverride ?? '' }); setConfirmation(null) }}>Edit product</button><button type="button" className={detail.isActive ? 'product-danger-button' : 'secondary-action'} disabled={Boolean(busy)} onClick={() => { setConfirmation({ kind: 'product', next: !detail.isActive, label: detail.name }); setEditDraft(null) }}>{detail.isActive ? 'Deactivate product' : 'Reactivate product'}</button></div></div></div>
          {editDraft && <ProductForm draft={editDraft} change={setEditDraft} categories={categories.some((category) => category.id === detail.category.id) ? categories : [...categories, detail.category]} role={role} editing busy={Boolean(busy)} submit={submitEdit} cancel={() => setEditDraft(null)} />}
        </section>
        <section className="product-panel"><span className="eyebrow">Primary image</span><h2>{detail.imageUrl ? 'Product image' : 'Add an image'}</h2><p className="product-muted">JPEG, PNG, or static WebP. Maximum 10 MiB. One primary image per product.</p>
          <form className="product-image-form" onSubmit={submitImage}><label htmlFor="product-image-file">Choose image</label><input key={`${selectedId}-${imageRevision}`} id="product-image-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={(event) => chooseFile(event.target.files?.[0] || null)} />{previewUrl && <div className="product-image-preview"><img src={previewUrl} alt="Local preview, not yet uploaded" /><span>Local preview — not saved</span></div>}
            <div className="product-actions"><button type="submit" disabled={!file || Boolean(busy)}>{busy === 'image-upload' ? 'Uploading...' : detail.imageUrl ? 'Replace image' : 'Upload image'}</button>{detail.imageUrl && <button type="button" className="product-danger-button" disabled={Boolean(busy)} onClick={() => setConfirmation({ kind: 'image', label: detail.name })}>Remove image</button>}</div></form>
        </section>
        <section className="product-panel"><div className="product-section-heading"><div><span className="eyebrow">Sellable units</span><h2>Variants</h2></div><button type="button" className="secondary-action" disabled={Boolean(busy) || !detail.isActive} onClick={() => setVariantEdit({ id: null, draft: { ...blankVariant } })}>Add variant</button></div>
          {!detail.isActive && <p className="product-muted">Reactivate this product before adding variants.</p>}
          {variantEdit && <VariantForm draft={variantEdit.draft} change={(draft) => setVariantEdit({ ...variantEdit, draft })} editing={Boolean(variantEdit.id)} busy={Boolean(busy)} submit={submitVariant} cancel={() => setVariantEdit(null)} />}
          {detail.variants.length === 0 ? <div className="product-variants-empty"><p>No variants yet. Add a SKU to define a sellable unit; stock starts at zero.</p></div> : <div className="product-variant-list">{detail.variants.map((variant) => <article className="product-variant" key={variant.id}><div className="product-variant-heading"><strong>{variant.sku}</strong><span className={`product-status ${variant.isActive ? '' : 'is-inactive'}`}>{variant.isActive ? 'Active' : 'Inactive'}</span></div>
            <dl><div><dt>Color / size</dt><dd>{[variant.color, variant.size].filter(Boolean).join(' / ') || 'Not available'}</dd></div><div><dt>Barcode</dt><dd>{valueOrUnavailable(variant.barcode)}</dd></div><div><dt>Selling price</dt><dd>{valueOrUnavailable(variant.sellingPrice)}</dd></div><div><dt>Current stock</dt><dd>{variant.currentStock} <small>read-only</small></dd></div>{canShowVariantCost(role, variant) && <div><dt>Last purchase cost</dt><dd>{valueOrUnavailable(variant.lastPurchaseCost)} <small>read-only</small></dd></div>}</dl>
            <div className="product-actions"><button type="button" className="secondary-action" disabled={Boolean(busy)} onClick={() => { setVariantEdit({ id: variant.id, draft: { sku: variant.sku, barcode: variant.barcode ?? '', color: variant.color ?? '', size: variant.size ?? '', sellingPrice: variant.sellingPrice ?? '' } }); setConfirmation(null) }}>Edit variant</button><button type="button" className={variant.isActive ? 'product-danger-button' : 'secondary-action'} disabled={Boolean(busy)} onClick={() => { setConfirmation({ kind: 'variant', id: variant.id, next: !variant.isActive, label: variant.sku }); setVariantEdit(null) }}>{variant.isActive ? 'Deactivate variant' : 'Reactivate variant'}</button></div>
          </article>)}</div>}
        </section>
        {confirmation && <div className="product-confirmation" role="group" aria-label="Confirm catalog change"><strong>{confirmation.kind === 'image' ? 'Remove image' : `${confirmation.next ? 'Reactivate' : 'Deactivate'} ${confirmation.kind}`}?</strong><p>{confirmation.kind === 'image' ? 'The current primary image will be removed.' : `Confirm this change for “${confirmation.label}”. Historical records are preserved.`}</p><div className="product-actions"><button type="button" className={confirmation.next ? '' : 'danger-action'} disabled={Boolean(busy)} onClick={confirmation.kind === 'image' ? confirmImageRemove : confirmStatus}>{busy ? 'Working...' : 'Confirm'}</button><button type="button" className="secondary-action" disabled={Boolean(busy)} onClick={() => setConfirmation(null)}>Cancel</button></div></div>}
      </div>}
    </div></div>
  </section>
}
