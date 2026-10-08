import { ProductRestock } from '../../features/inventory/ProductRestock.jsx'
import { InventoryHistory, InventoryReconciliation } from '../../features/inventory/InventoryAuditSections.jsx'
import { ReceiptHistory } from '../../features/inventory/ReceiptHistory.jsx'
import { ProductStock, ProductCountCheck } from '../../features/products/ProductStockSections.jsx'
import { ProductActionsMenu } from '../../features/products/ProductActionsMenu.jsx'
import { ProductNavigation } from '../../features/products/ProductNavigation.jsx'
import { ProductLoading } from '../../features/products/ProductLoading.jsx'
import '../../features/inventory/receiving.css'
import '../../features/products/product-workspace.css'
import { ProductImage, ProductIdentityForm, VariantForm, ProductCatalogCard } from '../../features/products/ProductComponents.jsx'
import { ColorSwatch } from '../../features/products/ColorSwatch.jsx'
import { groupVariantsByColor, operationalState } from '../../features/products/product-options.js'
import { readStockRecovery, persistStockOperation, resolveStockOperation, migrateStockRecovery, withStockRecoveryLock, withStockMetadataLock, stockRecoveryEvent, stockRecoveryKey, newStockOperation } from '../../features/products/stock-recovery.js'
import { useDirtyState, confirmDiscardChanges } from '../../app/dirty-state.js'
import '../../features/products/products.css'
import '../../features/products/product-polish.css'
import { useEffect, useRef, useState } from 'react'
import { loadCategories } from '../../features/categories/category-flow.js'
import { CatalogConfirmation } from '../../features/products/CatalogConfirmation.jsx'

import {
  canShowProductMargin, createVariant, findVariantDuplicate, getProduct, listProducts, removeProductImage,
  applyVariantPrices, adjustVariantStock, setProductActive, setVariantActive, updateProduct, updateVariant,
  uploadProductImage, validateImage,
} from '../../features/products/product-flow.js'
import { formatMoney } from '../../lib/money.js'
import { supabase } from '../../lib/supabase.js'

function newVariantDraft() { const sku = `ITEM-${crypto.randomUUID()}`; return { ...blankVariant, sku, initialSku: sku } }

const blankVariant = { sku: '', barcode: '', color: '', size: '', sellingPrice: '' }

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

export function ProductsPage({ profile, navigate, productId }) {
  const role = profile.user.role
  const currency = profile.account?.baseCurrency
  const [section, setSection] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('section')
    return ['stock', 'movements', 'count', 'receipts', ...(role === 'OWNER' ? ['restock'] : [])].includes(requested) ? requested : 'overview'
  })
  const [visited, setVisited] = useState(() => ({ [section]: true }))
  const [auditVersion, setAuditVersion] = useState(0)
  function selectSection(next) {
    setVisited(current => ({ ...current, [next]: true })); setSection(next)
    const url = new URL(window.location.href)
    if (next === 'overview') url.searchParams.delete('section')
    else url.searchParams.set('section', next)
    window.history.replaceState(null, '', url.pathname + url.search)
  }
  const [categories, setCategories] = useState([])
  const [categoryState, setCategoryState] = useState({ kind: 'loading' })
  const [categoryAttempt, setCategoryAttempt] = useState(0)
  const [filters, setFilters] = useState({ search: '', categoryId: '', isActive: 'true', page: 1 })
  const [searchDraft, setSearchDraft] = useState('')
  const [filterDraft, setFilterDraft] = useState({ categoryId: '', isActive: 'true' })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [listState, setListState] = useState({ kind: 'loading' })
  const [listVersion, setListVersion] = useState(0)
  const [selectedId] = useState(productId || null)
  const [detailState, setDetailState] = useState({ kind: productId ? 'loading' : 'idle' })
  const [detailVersion, setDetailVersion] = useState(0)

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
  const stockMounted = useRef(true)
  const [pendingStock, setPendingStock] = useState(recoveryInitial.records)
  const [stockBusy, setStockBusy] = useState(new Set())
  const stockInFlight = useRef(new Set())
  const detailRequestId = useRef(0)
  const [recoveryError, setRecoveryError] = useState(recoveryInitial.error)
  useEffect(() => {
    stockMounted.current = true
    if (role !== 'OWNER' || !productId) return () => { stockMounted.current = false }
    function sync(event) {
      if (event?.type === 'storage' && event.key !== null && event.key !== recoveryKey && !event.key.startsWith(`${recoveryKey}:operation:`)) return
      if (event?.type === stockRecoveryEvent && event.detail !== recoveryKey) return
      try {
        setPendingStock(readStockRecovery(recoveryKey))
        // A different tab settled an operation. Metadata alone is not stock data.
        if (event?.type === 'storage' && event.key?.startsWith(`${recoveryKey}:operation:`) && event.oldValue !== null && event.newValue === null) {
          detailRequestId.current += 1
          setDetailVersion(version => version + 1)
        }
      }
      catch { setRecoveryError('Stock recovery storage could not be read. Resolve browser storage before changing stock.') }
    }
    window.addEventListener('storage', sync)
    window.addEventListener(stockRecoveryEvent, sync)
    void migrateStockRecovery(recoveryKey).then(supported => {
      if (!stockMounted.current) return
      if (!supported) setRecoveryError('Safe stock updates require browser Web Locks. Use a supported browser. Pending updates have been preserved.')
      sync()
    }).catch(() => {
      if (stockMounted.current) setRecoveryError('Stock recovery migration could not finish. Pending updates have been preserved.')
    })
    return () => {
      stockMounted.current = false
      window.removeEventListener('storage', sync)
      window.removeEventListener(stockRecoveryEvent, sync)
    }
  }, [recoveryKey, role, productId])
  const [priceDraft, setPriceDraft] = useState(null)
  const [priceReview, setPriceReview] = useState(false)
  const currentProduct = detailState.kind === 'ready' ? detailState.product : null
  const productDirty = editDraft && currentProduct && (editDraft.name !== currentProduct.name || editDraft.categoryId !== currentProduct.category.id)
  const existingVariant = currentProduct?.variants.find(v => v.id === variantEdit?.id)
  const variantDirty = variantEdit && (existingVariant ? ['sku','barcode','color','size','sellingPrice'].some(field => String(variantEdit.draft[field] ?? '') !== String(existingVariant[field] ?? '')) : variantEdit.draft.sku !== variantEdit.draft.initialSku || ['barcode','color','size','sellingPrice'].some(field => Boolean(variantEdit.draft[field])))
  const defaultPriceTargets = currentProduct?.variants.filter(variant => variant.isActive).slice(0, 200).map(variant => variant.id) ?? []
  const priceDirty = Boolean(priceDraft && (priceDraft.sellingPrice || priceDraft.variantIds.length !== defaultPriceTargets.length || priceDraft.variantIds.some(id => !defaultPriceTargets.includes(id))))
  useDirtyState(Boolean(productDirty || variantDirty || file || priceDirty))

  const mutationPending = useRef(false)
  const listRequestId = useRef(0)
  const filterToggle = useRef(null)
  const filterPanel = useRef(null)
  const detailPanel = useRef(null)
  const resultsPanel = useRef(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void loadCategories({ supabase, signal: controller.signal }).then((result) => {
      if (!active || result.aborted || redirectIfNeeded(result)) return
      if (result.ok) { setCategories(result.categories); setCategoryState({ kind: 'ready' }) }
      else setCategoryState({ kind: 'error', message: result.message })
    })
    return () => { active = false; controller.abort() }
  }, [categoryAttempt])

  useEffect(() => {
    if (productId) return undefined
    let active = true
    const requestId = listRequestId.current
    const controller = new AbortController()
    void listProducts({ supabase, filters, summary: true, signal: controller.signal }).then((result) => {
      if (!active || result.aborted || requestId !== listRequestId.current || redirectIfNeeded(result)) return
      setListState(result.ok ? { kind: 'ready', ...result } : { kind: 'error', message: result.message })
    })
    return () => { active = false; controller.abort() }
  }, [filters, listVersion, productId])

  useEffect(() => {
    if (!selectedId) return undefined
    let active = true
    const requestId = detailRequestId.current
    const controller = new AbortController()
    void getProduct({ supabase, productId: selectedId, signal: controller.signal }).then((result) => {
      if (!active || result.aborted || requestId !== detailRequestId.current || redirectIfNeeded(result)) return
      setDetailState(result.ok ? { kind: 'ready', product: result.product } : { kind: 'error', message: result.message })
    })
    return () => { active = false; controller.abort() }
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
    stockInFlight.current.add(variant.id); setStockBusy(new Set(stockInFlight.current)); setFeedback(null)
    try {
      const supported = await migrateStockRecovery(recoveryKey)
      if (!supported) {
        if (stockMounted.current) setRecoveryError('Safe stock updates require browser Web Locks. Use a supported browser.')
        return
      }
      const locked = await withStockRecoveryLock(recoveryKey, variant.id, async () => {
        // Re-read under the lock: component state and storage events are not atomic.
        let record, blocked
        await withStockMetadataLock(recoveryKey, () => {
          record = readStockRecovery(recoveryKey).find(item => item.variantId === variant.id)
          blocked = (record && !retry) || (!record && retry)
          if (!blocked && !record) {
            record = newStockOperation(variant.id, delta)
            persistStockOperation(recoveryKey, record)
          }
        })
        if (blocked) {
          if (stockMounted.current) {
            setPendingStock(readStockRecovery(recoveryKey))
            setFeedback({kind:'error', message:record ? 'An update is awaiting confirmation. Retry that update first.' : 'This update was already resolved. Reload to see the latest stock.'})
          }
          return
        }
        const result = await adjustVariantStock({supabase, productId:selectedId, variantId:variant.id, operationId:record.operationId, delta:record.delta})
        // Cleanup still runs after navigation, but only removes this request's key.
        if (result.ok || !result.uncertain) await withStockMetadataLock(recoveryKey, () => resolveStockOperation(recoveryKey, record.operationId))
        if (!stockMounted.current) return
        if (redirectIfNeeded(result)) return
        setPendingStock(readStockRecovery(recoveryKey))
        if (!result.ok) { setFeedback({kind:'error', message:result.message}); return }
        setDetailState(current => current.kind === 'ready' ? {...current, product:{...current.product, variants:current.product.variants.map(item => item.id === variant.id ? result.variant : item)}} : current)
        setAuditVersion(value => value + 1)
        setFeedback({kind:'success', message:`Stock count updated. ${variant.color || ''} / ${variant.size || ''}: ${result.variant.currentStock} pieces.`})
      })
      if (!locked.acquired && stockMounted.current) setFeedback({kind:'error', message:'Another page is confirming this option. Wait for it to finish before retrying.'})
    } catch {
      if (stockMounted.current) setFeedback({kind:'error', message:'Stock update could not be confirmed. Pending updates are preserved; retry the same update below.'})
    } finally {
      stockInFlight.current.delete(variant.id)
      if (stockMounted.current) setStockBusy(new Set(stockInFlight.current))
    }
  }

  async function submitPrices(event) {
    event.preventDefault()
    if (variantEdit?.id && priceDraft.variantIds.includes(variantEdit.id)) {
      setFeedback({ kind: 'error', message: 'Save or cancel the open option edit before updating its price together with other options.' })
      return
    }
    if (!priceReview) { setPriceReview(true); return }
    const result = await run('bulk-price', () => applyVariantPrices({supabase, productId:selectedId, ...priceDraft}))
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
    setFeedback({ kind: 'success', message: editing ? 'Variant updated.' : role === 'OWNER' ? 'Color / size saved. Open Restock to receive a delivery.' : 'Color / size saved. An owner can now set the price and add stock.' })
  }

  async function confirmStatus() {
    const target = confirmation
    if (!target) return
    const result = await run('status', () => target.kind === 'product'
      ? setProductActive({ supabase, productId: selectedId, isActive: target.next })
      : setVariantActive({ supabase, productId: selectedId, variantId: target.id, isActive: target.next }))
    if (!result?.ok) return
    if (target.kind === 'product') {
      setDetailState({ kind: 'ready', product: result.product })
      setEditDraft(null)
    } else {
      refreshDetail()
      if (variantEdit?.id === target.id) setVariantEdit(null)
    }
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
    const result = await run('image-remove', async () => {
      const removed = await removeProductImage({ supabase, productId: selectedId })
      if (removed.code !== 'PRODUCT_IMAGE_DELETE_FAILED') return removed
      // The database detach precedes object deletion. Read authoritative state
      // without retrying a deletion against a possibly replaced canonical image.
      const current = await getProduct({ supabase, productId: selectedId })
      if (current.requiresLogin || current.requiresAccountReview) return current
      return { ...removed, refreshedProduct: current.ok ? current.product : null }
    })
    if (result?.refreshedProduct) {
      setDetailState({ kind: 'ready', product: result.refreshedProduct }); refreshList()
      if (result.refreshedProduct.imageStatus === 'none') {
        setConfirmation(null); chooseFile(null)
        setFeedback({ kind: 'error', message: 'The image was removed from the product, but storage cleanup failed. No further image deletion was sent; storage cleanup needs a separate follow-up.' })
      }
      return
    }
    if (!result?.ok) return
    setDetailState({ kind: 'ready', product: { ...detail, imageUrl: null, imageStatus: 'none' } })
    setConfirmation(null); chooseFile(null); refreshDetail(); refreshList()
    setFeedback({ kind: 'success', message: 'Product image removed.' })
  }

  const detail = detailState.kind === 'ready' ? detailState.product : null
  const hasAttachedImage = Boolean(detail && (detail.imageUrl || ['available', 'unavailable'].includes(detail.imageStatus)))
  const variantGroups = detail ? groupVariantsByColor(detail.variants) : []
  const pageCount = listState.kind === 'ready' ? Math.max(1, Math.ceil(listState.total / listState.limit)) : 1
  function editProduct() {
    if (productDirty && !confirmDiscardChanges()) return
    selectSection('overview'); setFeedback(null)
    setEditDraft({ name: detail.name, categoryId: detail.category.id, profitMarginOverride: detail.profitMarginOverride ?? '' }); setConfirmation(null)
  }
  function editVariant(variant) {
    if (variantDirty && !confirmDiscardChanges()) return
    setVariantEdit({ id: variant.id, draft: { sku: variant.sku, barcode: variant.barcode ?? '', color: variant.color ?? '', size: variant.size ?? '', sellingPrice: variant.sellingPrice ?? '' } }); setConfirmation(null)
  }

  return <section className="business-page products-page product-management">
    {!productId && <header className="business-page-heading product-page-heading"><div><span className="eyebrow">Product catalog</span><h1>Products</h1><p>Manage products, stock, restocking and movement history.</p></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => { navigate('/app/inventory') }}><span aria-hidden="true">+ </span>Add Product</button></header>}
    {!currency && <p className="product-feedback error-message" role="alert">Account currency is unavailable. Monetary values cannot be displayed safely.</p>}
    {recoveryError && <p role="alert" className="product-feedback error-message">{recoveryError}</p>}
    {pendingStock.length > 0 && section !== 'count' && <p className="product-feedback" role="status">A count correction is awaiting confirmation. <button type="button" className="text-button" onClick={() => selectSection('count')}>Open Count Check</button></p>}
    {feedback && <p id="products-feedback" className={`product-feedback ${feedback.kind}-message`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    <div className="product-catalog-layout">{!productId && <div className="product-list-column" ref={resultsPanel} tabIndex={-1} aria-label="Product catalog">
      <form className="product-filter-panel" onSubmit={(event) => { event.preventDefault(); applyFilters({ search: searchDraft.trim(), ...filterDraft, page: 1 }); setFiltersOpen(false) }}>
        <div className="product-search-row"><div><label htmlFor="product-search">Search</label><input id="product-search" type="search" maxLength={100} value={searchDraft} placeholder="Product name, SKU or barcode" onChange={(event) => setSearchDraft(event.target.value)} /></div><button ref={filterToggle} type="button" className="secondary-action product-filter-toggle" aria-expanded={filtersOpen} aria-controls="product-filter-options" onClick={() => setFiltersOpen((open) => !open)}>Filters</button></div>
        {filtersOpen && <button className="product-filter-backdrop" type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />}
        <div ref={filterPanel} id="product-filter-options" className={`product-filter-options ${filtersOpen ? 'is-open' : ''}`} role={filtersOpen ? 'dialog' : undefined} aria-modal={filtersOpen ? 'true' : undefined} aria-label="Product filters"><div className="product-filter-sheet-heading"><strong>Filter products</strong><button type="button" className="text-button" onClick={() => setFiltersOpen(false)}>Close</button></div><div className="product-filter-fields"><div><label htmlFor="product-category-filter">Category</label><select id="product-category-filter" value={filterDraft.categoryId} onChange={(event) => setFilterDraft({ ...filterDraft, categoryId: event.target.value })}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div><label htmlFor="product-status-filter">Status</label><select id="product-status-filter" value={filterDraft.isActive} onChange={(event) => setFilterDraft({ ...filterDraft, isActive: event.target.value })}><option value="true">Active products</option><option value="false">Inactive products</option><option value="all">All products</option></select></div></div>
        <div className="product-actions"><button type="submit" className="product-filter-submit">Apply filters</button><button type="button" className="text-button" onClick={() => { setSearchDraft(''); setFilterDraft({ categoryId: '', isActive: 'true' }); setFiltersOpen(false); applyFilters({ search: '', categoryId: '', isActive: 'true', page: 1 }) }}>Clear</button></div></div>
      </form>
      {categoryState.kind === 'error' && <p className="product-inline-error" role="alert">Categories unavailable. {categoryState.message} <button className="text-button" type="button" onClick={() => setCategoryAttempt((n) => n + 1)}>Retry</button></p>}
      {listState.kind === 'loading' && <ProductLoading label="Loading products..." />}
      {listState.kind === 'error' && <div className="product-state"><h2>Products unavailable</h2><p className="error-message" role="alert">{listState.message}</p><button type="button" onClick={refreshList}>Try again</button></div>}
      {listState.kind === 'ready' && listState.products.length === 0 && <div className="product-state"><h2>{filters.search || filters.categoryId || filters.isActive !== 'true' ? 'No matching products' : 'No products yet'}</h2><p>{filters.search || filters.categoryId || filters.isActive !== 'true' ? 'Try changing your search or filters.' : 'Add your first product to start building your catalog.'}</p>{!filters.search && !filters.categoryId && filters.isActive === 'true' && <button type="button" onClick={() => navigate('/app/inventory')}>Add product</button>}</div>}
      {listState.kind === 'ready' && listState.products.length > 0 && <><div className="product-list-summary"><span>{listState.total} product{listState.total === 1 ? '' : 's'}</span><button className="text-button product-refresh" type="button" aria-label="Refresh products" onClick={() => { refreshList(); if (selectedId) refreshDetail() }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></svg>Refresh</button></div>
        <div className="product-results"><div className="product-table-heading" aria-hidden="true"><span>Product</span><span>Category</span><span>Variants</span><span>Stock</span><span>Selling price</span><span>Status</span><span>Action</span></div><div className="product-card-list">{listState.products.map((product) => <ProductCatalogCard key={product.id} product={product} currency={currency} selected={selectedId === product.id} select={() => selectProduct(product.id)} listVersion={listVersion} imageRevision={imageRevision} />)}</div></div><nav className="product-pagination" aria-label="Product pages"><button type="button" className="secondary-action" disabled={filters.page <= 1} onClick={() => applyFilters({ ...filters, page: filters.page - 1 })}>Previous</button><span>Page {listState.page} of {pageCount}</span><button type="button" className="secondary-action" disabled={filters.page >= pageCount} onClick={() => applyFilters({ ...filters, page: filters.page + 1 })}>Next</button></nav></>}
    </div>}<div ref={detailPanel} className={`product-detail-column ${selectedId ? 'has-selection' : ''}`} tabIndex={-1} aria-label="Selected product details">
      {selectedId && <div className="product-detail-navigation"><button type="button" className="text-button" aria-label="Back to products" disabled={Boolean(busy)} onClick={() => { if (confirmDiscardChanges()) navigate('/app/products') }}><span aria-hidden="true">←</span> Products</button></div>}
      {detailState.kind === 'loading' && selectedId && <ProductLoading label="Loading product details..." />}
      {detailState.kind === 'error' && selectedId && <div className="product-state"><h2>Product unavailable</h2><p className="error-message" role="alert">{detailState.message}</p><button type="button" onClick={() => { setDetailState({ kind: 'loading' }); refreshDetail() }}>Try again</button></div>}
      {detail && selectedId && <div className="product-detail-stack">
        <header className="product-detail-header"><div className="product-detail-context"><h1>{detail.name}</h1><div className="product-detail-meta"><span>{detail.category.name}</span><span>{detail.variants.length} variants</span><span className={`product-status ${detail.isActive ? '' : 'is-inactive'}`}>{detail.isActive ? 'Active' : 'Inactive'}</span></div></div><div className="product-detail-header-actions"><button type="button" className="secondary-action" aria-label="Edit product" disabled={Boolean(busy)} onClick={editProduct}>Edit Product</button><ProductActionsMenu label="Product actions" items={[{ label: detail.isActive ? 'Deactivate product' : 'Reactivate product', danger: detail.isActive, disabled: Boolean(busy) || stockBusy.size > 0, action: () => { setFeedback(null); setConfirmation({ kind: 'product', next: !detail.isActive, label: detail.name }) } }]} /></div></header>
        <ProductNavigation role={role} section={section} onSelect={selectSection} />
        <div id="product-panel-overview" className="product-detail-stack" hidden={section !== 'overview'} role="tabpanel" tabIndex={0} aria-labelledby="product-section-overview">
        <section className="product-panel product-overview">
          <div className="product-overview-summary"><ProductImage key={`${detail.imageUrl || detail.id}-${detailVersion}-${imageRevision}`} url={detail.imageUrl} status={detail.imageStatus} name={detail.name} revision={imageRevision} /><div className="product-overview-identity"><h2>Catalog details</h2><dl className="product-catalog-facts"><div><dt>Category</dt><dd>{detail.category.name}</dd></div><div><dt>Variants</dt><dd>{detail.variants.length} colors / sizes</dd></div></dl>{canShowProductMargin(role, detail) && detail.profitMarginOverride != null && <p>Margin override: {detail.profitMarginOverride}</p>}</div></div>
          {editDraft && <ProductIdentityForm draft={editDraft} change={setEditDraft} categories={categories.some((category) => category.id === detail.category.id) ? categories : [...categories, detail.category]} role={role} editing error={feedback?.kind === 'error'} busy={Boolean(busy) || stockBusy.size > 0} submit={submitEdit} cancel={() => { if (!productDirty || confirmDiscardChanges()) { setEditDraft(null) } }} />}
        <details className="product-photo-action product-optional"><summary>{hasAttachedImage ? 'Change Photo' : 'Add Photo'}</summary><p className="product-muted">JPEG, PNG, or static WebP. Maximum 10 MiB. One primary image per product.</p>
          <form className="product-image-form" onSubmit={submitImage}><label htmlFor="product-image-file">Choose image</label><input key={`${selectedId}-${imageRevision}`} id="product-image-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy) || stockBusy.size > 0} aria-disabled={Boolean(busy) || stockBusy.size > 0} aria-describedby={stockBusy.size > 0 ? 'product-photo-stock-wait' : undefined} onChange={(event) => chooseFile(event.target.files?.[0] || null)} />{previewUrl && <div className="product-image-preview"><img src={previewUrl} alt="Local preview, not yet uploaded" /><span>Local preview &mdash; not saved</span></div>}
            {stockBusy.size > 0 && <p id="product-photo-stock-wait" role="status">Waiting for stock update to finish.</p>}<div className="product-actions"><button type="submit" disabled={!file || Boolean(busy) || stockBusy.size > 0} aria-disabled={!file || Boolean(busy) || stockBusy.size > 0} aria-describedby={stockBusy.size > 0 ? 'product-photo-stock-wait' : undefined}>{busy === 'image-upload' ? 'Uploading...' : hasAttachedImage ? 'Replace image' : 'Upload image'}</button>{hasAttachedImage && <button type="button" className="product-danger-button" disabled={Boolean(busy) || stockBusy.size > 0} onClick={() => { setFeedback(null); setConfirmation({ kind: 'image', label: detail.name }) }}>Remove image</button>}</div></form>
        </details>
        </section>

        <section className="product-panel product-options-panel"><div className="product-section-heading"><div><h2>Colors & sizes</h2><p>Catalog options and selling prices. Open Stock to inspect quantities, or Restock to record a delivery.</p></div><div className="product-section-actions">{role === 'OWNER' && <button type="button" className="text-button" disabled={Boolean(busy) || stockBusy.size > 0 || !detail.isActive} onClick={() => { if (priceDraft) return; setPriceDraft({sellingPrice:'',variantIds:detail.variants.filter(v=>v.isActive).slice(0,200).map(v=>v.id)});setPriceReview(false) }} aria-label="Apply price to variants">Apply Price</button>}<button type="button" className="secondary-action" disabled={Boolean(busy) || !detail.isActive} onClick={() => { if (!variantDirty || confirmDiscardChanges()) setVariantEdit({ id: null, draft: newVariantDraft() }) }} aria-label="Add color / size">Add Color / Size</button></div></div>
        {role === 'OWNER' && <div className="product-bulk-price">{priceDraft && <form className="product-form" onSubmit={submitPrices}><label htmlFor="product-common-price">Selling price ({currency})</label><input id="product-common-price" required inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?" value={priceDraft.sellingPrice} disabled={Boolean(busy)} onChange={event=>{setPriceDraft({...priceDraft,sellingPrice:event.target.value});setPriceReview(false)}} />
        <details className="product-price-selection"><summary>Choose options ({priceDraft.variantIds.length} selected)</summary><div className="product-price-targets">{detail.variants.filter(v=>v.isActive).map(v=><label key={v.id}><input type="checkbox" checked={priceDraft.variantIds.includes(v.id)} disabled={Boolean(busy)} onChange={event=>{setPriceDraft({...priceDraft,variantIds:event.target.checked?[...priceDraft.variantIds,v.id]:priceDraft.variantIds.filter(id=>id!==v.id)});setPriceReview(false)}} />{v.color || 'No color'} / {v.size || 'No size'} / {v.sellingPrice == null?'Not set':formatMoney(v.sellingPrice,currency)}</label>)}</div></details>
        <p>{priceDraft.variantIds.length} selected options (up to 200 per update). {priceReview ? `Confirm replacing their existing prices with ${priceDraft.sellingPrice} ${currency}. Unselected options stay unchanged.` : 'Review existing prices above before confirming.'}</p>
        {stockBusy.size > 0 && <p id="bulk-price-stock-wait" role="status">Waiting for stock update to finish.</p>}<div className="product-actions"><button type="submit" disabled={Boolean(busy)||stockBusy.size > 0||!priceDraft.variantIds.length||priceDraft.variantIds.length>200} aria-disabled={Boolean(busy)||stockBusy.size > 0||!priceDraft.variantIds.length||priceDraft.variantIds.length>200} aria-describedby={stockBusy.size > 0 ? 'bulk-price-stock-wait' : undefined}>{priceReview?'Confirm price update':'Review price update'}</button><button type="button" className="secondary-action" disabled={Boolean(busy)} onClick={()=>{if(!priceDirty || confirmDiscardChanges()){setPriceDraft(null);setPriceReview(false)}}}>Cancel</button></div></form>}</div>}
          {!detail.isActive && <p className="product-muted">Reactivate this product before adding variants.</p>}
          {variantEdit && !variantEdit.id && <VariantForm draft={variantEdit.draft} change={(draft) => setVariantEdit({ ...variantEdit, draft })} editing={Boolean(variantEdit.id)} busy={Boolean(busy) || stockBusy.size > 0} submit={submitVariant} cancel={() => { if (!variantDirty || confirmDiscardChanges()) { setVariantEdit(null) } }} role={role} currency={currency} error={feedback?.kind === 'error'} />}
          {detail.variants.length === 0 ? <p className="product-muted">Add your first color and size.</p> : <div className="product-color-stock-grid">{variantGroups.map(([color, variants]) => <section className="product-color-stock-card" style={{'--variant-count':variants.length}} key={variants[0].id} aria-label={`${color} sizes and stock`}>
            <header className="product-color-stock-header"><h3><ColorSwatch name={color} />{color}</h3><span>{variants.length} sizes · {variants.filter(v=>detail.isActive&&v.isActive).reduce((total, variant) => total + variant.currentStock, 0)} available{variants.some(v=>(!detail.isActive||!v.isActive)&&v.currentStock > 0) && ` · ${variants.filter(v=>!detail.isActive||!v.isActive).reduce((sum,v)=>sum+v.currentStock,0)} inactive pieces`}</span></header>
            {variants.map((variant) => <article className="product-stock-row" key={variant.id} aria-label={`${color} / ${variant.size || 'No size'}`}>
              <div className="product-option-state"><span className={`product-readiness ${operationalState(detail, variant, role) === 'Sellable' ? 'is-sellable' : operationalState(detail, variant, role) === 'Inactive' ? 'is-inactive' : operationalState(detail, variant, role) === 'Out of stock' ? 'is-empty' : 'is-warning'}`}>{operationalState(detail, variant, role)}</span>{role === 'OWNER' && variant.lastPurchaseCost === null && <button type="button" className="text-button product-cost-pending" onClick={() => selectSection('stock')}>Cost pending: set in Stock</button>}</div>
              <strong className="product-stock-size">{variant.size || 'No size'}</strong>
              <span className={`product-stock-quantity ${variant.currentStock === 0 ? 'is-empty' : ''}`}><small className="product-stock-label">Stock</small>{variant.currentStock}</span>
              <span className="product-stock-price"><small className="product-stock-label">Price</small>{variant.sellingPrice == null ? 'Not set' : formatMoney(variant.sellingPrice, currency)}</span>
              <div className="product-stock-actions"><ProductActionsMenu className="product-stock-more" label={`Variant actions: ${color} / ${variant.size || 'No size'}`} items={[
                { label: 'Edit Variant', disabled: Boolean(busy) || stockBusy.has(variant.id), action: () => editVariant(variant) },
                { label: variant.isActive ? 'Deactivate variant' : 'Reactivate variant', danger: variant.isActive, disabled: Boolean(busy) || stockBusy.size > 0, action: () => { setFeedback(null); setConfirmation({ kind: 'variant', id: variant.id, next: !variant.isActive, label: `${detail.name} / ${[variant.color, variant.size].filter(Boolean).join(' / ') || variant.sku}` }) } },
              ]}><span>SKU</span><strong>{variant.sku}</strong></ProductActionsMenu></div>
          {variantEdit?.id === variant.id && <VariantForm draft={variantEdit.draft} change={(draft) => setVariantEdit({ ...variantEdit, draft })} editing={Boolean(variantEdit.id)} busy={Boolean(busy) || stockBusy.size > 0} submit={submitVariant} cancel={() => { if (!variantDirty || confirmDiscardChanges()) { setVariantEdit(null) } }} role={role} currency={currency} error={feedback?.kind === 'error'} />}
            </article>)}
          </section>)}</div>}

        </section>
        </div>
        {visited.stock && <div id="product-panel-stock" hidden={section !== 'stock'} role="tabpanel" tabIndex={0} aria-labelledby="product-section-stock"><ProductStock product={detail} role={role} currency={currency} onSaved={() => { refreshDetail(); setFeedback({kind:'success',message:'Purchase cost saved. Quantity and historical sale costs are unchanged.'}) }} /></div>}
        {visited.restock && role === 'OWNER' && <div id="product-panel-restock" hidden={section !== 'restock'} role="tabpanel" tabIndex={0} aria-labelledby="product-section-restock"><ProductRestock profile={profile} product={detail} onSaved={() => { refreshDetail(); setAuditVersion(value => value + 1) }} onCancel={selectSection} /></div>}
        {visited.movements && <div id="product-panel-movements" hidden={section !== 'movements'} role="tabpanel" tabIndex={0} aria-labelledby="product-section-movements"><InventoryHistory active={section === 'movements'} role={role} currency={currency} products={[detail]} productId={detail.id} refreshVersion={auditVersion} /></div>}
        {visited.count && <div id="product-panel-count" hidden={section !== 'count'} role="tabpanel" tabIndex={0} aria-labelledby="product-section-count"><ProductCountCheck product={detail} role={role} busy={Boolean(busy)} stockBusy={stockBusy} pendingStock={pendingStock} recoveryError={recoveryError} onRetry={(variant, delta) => changeStock(variant, delta, true)} onCorrect={(variant, delta) => { setFeedback(null); setConfirmation({kind:'count',variant,delta,label:`${detail.name} / ${variant.color || 'No color'} / ${variant.size || 'No size'}`}) }} /><InventoryReconciliation active={section === 'count'} productId={detail.id} products={[detail]} refreshVersion={auditVersion} /></div>}
        {visited.receipts && <div id="product-panel-receipts" hidden={section !== 'receipts'} role="tabpanel" tabIndex={0} aria-labelledby="product-section-receipts"><ReceiptHistory active={section === 'receipts'} role={role} currency={currency} refreshVersion={auditVersion} /></div>}
        {confirmation && <CatalogConfirmation target={confirmation} busy={Boolean(busy) || (confirmation.kind === 'count' && stockBusy.has(confirmation.variant.id))} error={feedback?.kind === 'error' ? feedback.message : null} onConfirm={confirmation.kind === 'count' ? () => { const target = confirmation; setConfirmation(null); void changeStock(target.variant, target.delta) } : confirmation.kind === 'image' ? confirmImageRemove : confirmStatus} onClose={() => setConfirmation(null)} />}
      </div>}
    </div></div>

  </section>
}
