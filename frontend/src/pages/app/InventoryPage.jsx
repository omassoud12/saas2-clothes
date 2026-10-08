import { useEffect, useState } from 'react'
import { ProductCreateForm } from '../../features/products/ProductCreateForm.jsx'
import { StockReceiptForm } from '../../features/inventory/StockReceiptForm.jsx'
import { useReceiptRecovery } from '../../features/inventory/useReceiptRecovery.js'
import { ReceiptRecoveryBanner, ReceiptSteps, InventoryFeedback } from '../../features/inventory/ReceiptPresentation.jsx'
import { definitionDraft } from '../../features/inventory/inventory-presentation.js'
import { loadCategories } from '../../features/categories/category-flow.js'
import { useDirtyState, confirmDiscardChanges } from '../../app/dirty-state.js'
import { supabase } from '../../lib/supabase.js'
import '../../features/inventory/receiving.css'
import '../../features/products/product-workspace.css'
import '../../features/inventory/entry-polish.css'

// Preserve existing bookmarks. Existing-product receiving now belongs to Products.
export function InventoryPage({ profile, navigate }) {
  const [legacyProductId] = useState(() => new URLSearchParams(window.location.search).get('productId'))
  useEffect(() => {
    if (legacyProductId) navigate(`/app/products/${encodeURIComponent(legacyProductId)}?section=restock`, { replace: true })
  }, [legacyProductId, navigate])
  return legacyProductId ? <p role="status">Opening product restock...</p> : <ProductEntry profile={profile} navigate={navigate} />
}

function ProductEntry({ profile, navigate }) {
  const owner = profile.user.role === 'OWNER'
  const [categories, setCategories] = useState([])
  const [categoryState, setCategoryState] = useState({ kind: 'loading' })
  const [categoryAttempt, setCategoryAttempt] = useState(0)
  const [definition, setDefinition] = useState(null)
  const [editingDefinition, setEditingDefinition] = useState(false)
  const [success, setSuccess] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const clearDirty = useDirtyState(Boolean(definition && !success))
  function received(result, name) {
    clearDirty()
    setSuccess({ result, name: name || definition?.draft.name || 'Product' })
    setDefinition(null); setEditingDefinition(false); setError('')
  }
  const recovery = useReceiptRecovery(profile, received)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void loadCategories({ supabase, signal: controller.signal }).then(result => {
      if (!active || result.aborted) return
      if (result.requiresLogin) { window.location.replace('/login'); return }
      if (result.requiresAccountReview) { window.location.replace('/pending-approval'); return }
      if (result.ok) { setCategories(result.categories); setCategoryState({ kind: 'ready' }) }
      else setCategoryState({ kind: 'error', message: result.message })
    })
    return () => { active = false; controller.abort() }
  }, [categoryAttempt])
  function reset() {
    if (!confirmDiscardChanges()) return
    clearDirty(); setDefinition(null); setEditingDefinition(false); setSuccess(null); setError(''); setAttempt(value => value + 1)
  }
  return <section className="business-page inventory-page entry-page entry-polish">
    <header className="inventory-page-header"><div className="inventory-header-copy"><span className="eyebrow">New product</span><h1>Product Entry</h1><p>{owner ? 'Create a new product for your catalog. Add first stock now or save with zero stock.' : 'Create a new product with zero stock. An owner handles pricing and receiving.'}</p></div><button type="button" className="text-button entry-view-products" aria-label="View products" onClick={() => { if (confirmDiscardChanges()) navigate('/app/products') }}>View Products <span aria-hidden="true">↗</span></button></header>
    {recovery.recoveryError && <InventoryFeedback kind="error">{recovery.recoveryError}</InventoryFeedback>}
    {recovery.pending.map(record => record.path === '/api/inventory/product-setups'
      ? <ReceiptRecoveryBanner key={record.operationId} record={record} profile={profile} products={[]} retrying={recovery.retrying} onRetry={recovery.retry} onCheck={recovery.checkOriginal} onHistory={() => navigate('/app/products')} />
      : <InventoryFeedback key={record.operationId} kind="pending">An existing product has a receipt awaiting confirmation. <button className="text-button" onClick={() => { if (confirmDiscardChanges()) navigate(`/app/products/${encodeURIComponent(record.payload.productId)}?section=restock`) }}>Open product to resolve it</button></InventoryFeedback>)}
    {(error || recovery.feedback) && <InventoryFeedback kind={recovery.feedback?.kind || 'error'}>{error || recovery.feedback?.message}</InventoryFeedback>}
    {categoryState.kind === 'error' && <InventoryFeedback kind="error">{categoryState.message} <button className="text-button" onClick={() => { setCategoryState({ kind: 'loading' }); setCategoryAttempt(value => value + 1) }}>Retry categories</button></InventoryFeedback>}
    {success ? <section className="product-panel receipt-success" aria-label="Product created"><InventoryFeedback kind="success"><h2 tabIndex={-1} ref={node => node?.focus()}>Product created successfully</h2><p>{success.name}</p><p>{success.result.receipt ? `${success.result.receipt.totalQuantity ?? 'Confirmed'} pieces received in its first delivery.` : 'Saved with zero stock.'}</p>{success.result.idempotentReplay && <p>The original save was already processed; it was not applied again.</p>}</InventoryFeedback><div className="product-actions"><button onClick={() => navigate(`/app/products/${encodeURIComponent(success.result.productId)}`)}>View Product</button><button className="secondary-action" onClick={reset}>Add Another Product</button></div></section> : <>
      {(!definition || editingDefinition) && <div className="inventory-definition products-page"><ReceiptSteps owner={owner} newProduct current={0} /><ProductCreateForm key={editingDefinition ? 'editing' : attempt} role={profile.user.role} currency={profile.account?.baseCurrency} categories={categories} categoriesLoading={categoryState.kind === 'loading'} initialDraft={editingDefinition ? definitionDraft(definition?.draft) : undefined} initialImageFile={editingDefinition ? definition?.imageFile : undefined} onBusy={() => {}} onCancel={reset} onDefine={(draft, imageFile) => { setDefinition({ draft, imageFile }); setEditingDefinition(false); setError('') }} /></div>}
      {definition && <div hidden={editingDefinition}><StockReceiptForm profile={profile} scope={recovery.scope} definition={definition.draft} imageFile={definition.imageFile} blocked={recovery.blocked} onSaved={received} onEditDefinition={() => setEditingDefinition(true)} onTerminal={result => setError(result.message)} onCancel={reset} /></div>}
    </>}
  </section>
}
