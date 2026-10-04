import { useEffect, useState } from 'react'
import { listProducts, getProduct, setOpeningCost } from '../../features/products/product-flow.js'
import { RestockDialog } from '../../features/inventory/RestockDialog.jsx'
import { supabase } from '../../lib/supabase.js'
import { formatMoney } from '../../lib/money.js'
import { InventoryHistory, InventoryReconciliation } from '../../features/inventory/InventoryAuditSections.jsx'
import { useDirtyState, confirmDiscardChanges } from '../../app/dirty-state.js'
import { ProductCreateForm } from '../../features/products/ProductCreateForm.jsx'
import { StockReceiptForm } from '../../features/inventory/StockReceiptForm.jsx'
import { loadCategories } from '../../features/categories/category-flow.js'
import { receiptScope, readReceipts, receiptRecoveryEvent, lockReceipt, markReceiptOutcome, settleReceipt } from '../../features/inventory/stock-receipt-recovery.js'
import { checkReceiptOperation, receiptOperationKind, submitReceipt } from '../../features/inventory/stock-receipt-flow.js'
import { RECEIPT_OUTCOME } from '../../features/inventory/stock-receipt-outcome.js'
import '../../features/inventory/receiving.css'
import { ReceiptHistory } from '../../features/inventory/ReceiptHistory.jsx'
import { InventoryProductPicker } from '../../features/inventory/InventoryProductPicker.jsx'
import { InventoryFeedback, ReceiptSteps, ReceiptRecoveryBanner, ReceiptSuccess } from '../../features/inventory/ReceiptPresentation.jsx'
import { definitionDraft } from '../../features/inventory/inventory-presentation.js'

function redirectIfNeeded(result) {
  if (result.requiresLogin) window.location.replace('/login')
  else if (result.requiresAccountReview) window.location.replace('/pending-approval')
  return Boolean(result.requiresLogin || result.requiresAccountReview)
}

function OpeningCostForm({ product, variant, currency, onSaved }) {
  const [open, setOpen] = useState(false)
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clearDirty = useDirtyState(open && (cost !== '' || busy))
  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(cost) || !/[1-9]/.test(cost)) { setError('Enter a positive purchase cost with up to four decimal places.'); return }
    setBusy(true); setError('')
    try {
      const result = await setOpeningCost({ supabase, productId: product.id, variantId: variant.id, unitCost: cost })
      if (redirectIfNeeded(result)) return
      if (result.ok) { clearDirty(); setOpen(false); setCost(''); onSaved() }
      else setError(result.message)
    } finally { setBusy(false) }
  }
  return <div>{!open ? <button type="button" className="secondary-action" onClick={() => setOpen(true)}>Set cost</button> : <form onSubmit={submit}>
    <label htmlFor={`opening-cost-${variant.id}`}>Purchase cost per piece{currency ? ` (${currency})` : ''}</label>
    <input id={`opening-cost-${variant.id}`} autoFocus required inputMode="decimal" maxLength={19} value={cost} disabled={busy} onChange={(event) => setCost(event.target.value)} />
    <small>Sets current purchase cost. Quantity and historical sale costs stay unchanged.</small>
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="product-actions"><button disabled={busy} type="submit">{busy ? 'Saving...' : 'Save cost'}</button><button disabled={busy} type="button" className="secondary-action" onClick={() => { if (cost && !window.confirm('Discard this unsaved purchase cost?')) return; clearDirty(); setOpen(false); setCost(''); setError('') }}>Cancel</button></div>
  </form>}</div>
}

export function InventoryPage({ profile }) {
  const role = profile.user.role
  const currency = profile.account?.baseCurrency
  const [searchDraft, setSearchDraft] = useState('')
  const [filters, setFilters] = useState({ search: '', page: 1 })
  const [version, setVersion] = useState(0)
  const [state, setState] = useState({ kind: 'loading' })
  const [target, setTarget] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [view, setView] = useState('stock')
  const [success, setSuccess] = useState(null)
  const [creating, setCreating] = useState(()=>new URLSearchParams(window.location.search).get('new')==='1')
  const [definition, setDefinition] = useState(null)
  const [editingDefinition, setEditingDefinition] = useState(false)
  const [receiving, setReceiving] = useState(null)
  const [categories, setCategories] = useState([])
  const [categoryError, setCategoryError] = useState('')
  const [pending, setPending] = useState([])
  const [recoveryError, setRecoveryError] = useState('')
  const [retrying, setRetrying] = useState(false)
  const scope = receiptScope(profile.account?.id || profile.user.accountId, profile.user.id)
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get('productId')
    if(!id || role!=='OWNER')return
    let active=true
    getProduct({supabase,productId:id}).then(result=>{if(active){if(result.ok)setReceiving(result.product);else setFeedback({kind:'error',message:result.message})}})
    return ()=>{active=false}
  },[role])
  useEffect(() => {
    let active=true
    loadCategories({supabase}).then(result=>{if(active){if(result.ok)setCategories(result.categories);else setCategoryError(result.message)}})
    return ()=>{active=false}
  }, [])
  useEffect(()=>{
    function sync(){try{setPending(readReceipts(scope))}catch{setRecoveryError('Receiving recovery storage is unavailable. Resolve browser storage before receiving.')}}
    const timer=setTimeout(()=>{sync();if(!navigator.locks)setRecoveryError('Safe receiving requires browser Web Locks. Use a supported browser.')},0)
    window.addEventListener('storage',sync);window.addEventListener(receiptRecoveryEvent,sync)
    return ()=>{clearTimeout(timer);window.removeEventListener('storage',sync);window.removeEventListener(receiptRecoveryEvent,sync)}
  },[scope])
  function received(result, name){
    const productName=name || result.receipt?.productName || definition?.draft.name || receiving?.name || (state.kind==='ready' && state.products.find(product=>product.id===result.productId)?.name) || 'Product'
    setSuccess({result,name:productName});setCreating(false);setDefinition(null);setEditingDefinition(false);setReceiving(null);setVersion(v=>v+1);setFeedback(null);setRecoveryError('')
  }
  function operationName(record){return receiptOperationKind(record.path,record.payload)==='product-save'?'product save':'receiving request'}
  async function handleRecoveryFailure(record,result){
    if(result.preservePending)await markReceiptOutcome(scope,record,result)
    else await settleReceipt(scope,record)
    if(redirectIfNeeded(result))return
    if(result.outcome===RECEIPT_OUTCOME.TERMINAL_REJECTION){setFeedback({kind:'error',message:result.message});setVersion(v=>v+1);setRecoveryError('');return}
    if(result.outcome===RECEIPT_OUTCOME.CORRECTABLE_REJECTION){setFeedback({kind:'error',message:`The original ${operationName(record)} was rejected without saving. ${result.message}`});setRecoveryError('');return}
    setRecoveryError('')
  }
  async function retry(record){
    if(retrying)return
    setRetrying(true)
    try{const locked=await lockReceipt(scope,record,async()=>{
      const result=await submitReceipt({supabase,...record})
      if(result.ok){await settleReceipt(scope,record);received(result, record.payload?.product?.name)}
      else await handleRecoveryFailure(record,result)
    });if(!locked.acquired)setRecoveryError('Another tab is confirming this operation.')}
    catch{setRecoveryError(`Could not confirm the original ${operationName(record)}. Its saved request remains preserved.`)}
    finally{setRetrying(false)}
  }
  async function checkOriginal(record){
    if(retrying)return
    setRetrying(true)
    try{
      const result=await checkReceiptOperation({supabase,record})
      if(result.ok){await settleReceipt(scope,record);received(result,record.payload?.product?.name)}
      else await handleRecoveryFailure(record,result)
    }catch{setRecoveryError(`Could not check the original ${operationName(record)}. Its saved details remain available.`)}
    finally{setRetrying(false)}
  }

  useEffect(() => {
    let active = true
    void listProducts({ supabase, filters: { ...filters, isActive: 'all' } }).then((result) => {
      if (!active || redirectIfNeeded(result)) return
      setState(result.ok ? { kind: 'ready', ...result } : { kind: 'error', message: result.message })
    })
    return () => { active = false }
  }, [filters, version])

  function refresh() { if (!confirmDiscardChanges()) return; setState({ kind: 'loading' }); setVersion((value) => value + 1) }
  function changeFilters(next) { if (!confirmDiscardChanges()) return; setTarget(null); setState({ kind: 'loading' }); setFilters(next) }
  const pageCount = state.kind === 'ready' ? Math.max(1, Math.ceil(state.total / state.limit)) : 1

  const activeFlow=creating || Boolean(receiving)
  const clearFlow=()=>{setCreating(false);setDefinition(null);setEditingDefinition(false);setReceiving(null);setSuccess(null)}
  const resetFlow=()=>{if(confirmDiscardChanges())clearFlow()}
  const views=[['stock','Stock & receiving'],['receipts','Receipt history'],['movements','Movement history'],['check','Stock check']]
  return <section className="business-page inventory-page">
    <header className="inventory-page-header"><div className="inventory-header-copy"><span className="eyebrow">Stock control</span><h1>{activeFlow ? receiving ? 'Receive stock' : 'New product' : 'Inventory'}</h1><p>{activeFlow ? receiving ? `${receiving.name} · Enter a purchased delivery.` : role==='OWNER' ? 'Define colors and sizes, then receive stock.' : 'Define a product with zero stock.' : 'Find a product, receive stock, and review inventory history.'}</p></div><div className="inventory-header-actions">{activeFlow ? <button className="secondary-action" onClick={resetFlow}>Back to inventory</button> : !success && <button onClick={()=>{if(confirmDiscardChanges()){setCreating(true);setDefinition(null);setEditingDefinition(false);setReceiving(null);setView('stock')}}} disabled={pending.length>0 || Boolean(recoveryError)}>New product</button>}</div></header>
    {recoveryError && <InventoryFeedback kind="error">{recoveryError}</InventoryFeedback>}
    {pending.map(record=><ReceiptRecoveryBanner key={record.operationId} record={record} profile={profile} products={state.kind==='ready'?state.products:[]} retrying={retrying} onRetry={retry} onCheck={checkOriginal} onHistory={()=>{clearFlow();setView('receipts')}}/>)}
    {categoryError && <InventoryFeedback kind="error">{categoryError}</InventoryFeedback>}
    {feedback && <InventoryFeedback kind={feedback.kind}>{feedback.message}</InventoryFeedback>}
    {!currency && role === 'OWNER' && <InventoryFeedback kind="error">Account currency is unavailable. Purchase costs cannot be displayed safely.</InventoryFeedback>}
    {success && !activeFlow && <ReceiptSuccess result={success.result} name={success.name} currency={currency} owner={role==='OWNER'} onBack={()=>setSuccess(null)} onHistory={()=>{setSuccess(null);setView('receipts')}} onMore={role==='OWNER' && success.result.productId ? async()=>{const result=await getProduct({supabase,productId:success.result.productId});if(result.ok){setSuccess(null);setReceiving(result.product)}else setFeedback({kind:'error',message:result.message})} : null}/>}
    {creating && (!definition || editingDefinition) && <div className="inventory-definition products-page"><ReceiptSteps owner={role==='OWNER'} newProduct current={0}/><ProductCreateForm key={editingDefinition?'editing':'new'} role={role} currency={currency} categories={categories} categoriesLoading={!categories.length && !categoryError} initialDraft={editingDefinition ? definitionDraft(definition?.draft) : undefined} initialImageFile={editingDefinition ? definition?.imageFile : undefined} onBusy={()=>{}} onCancel={clearFlow} onDefine={(draft,imageFile)=>{setDefinition({draft,imageFile});setEditingDefinition(false)}} /></div>}
    {(definition || receiving) && <div hidden={editingDefinition}><StockReceiptForm key={receiving?.id || 'new'} profile={profile} scope={scope} product={receiving} definition={definition?.draft} imageFile={definition?.imageFile} blocked={pending.length>0 || Boolean(recoveryError)} onSaved={received} onEditDefinition={definition?()=>setEditingDefinition(true):undefined} onTerminal={(result)=>{clearFlow();setFeedback({kind:'error',message:result.message});setVersion(v=>v+1)}} onCancel={clearFlow} /></div>}
    <div hidden={activeFlow || Boolean(success)}>
    <nav className="inventory-views" aria-label="Inventory views">{views.map(([key,label])=><button type="button" key={key} className={view===key?'is-current':''} aria-current={view===key?'page':undefined} onClick={()=>setView(key)}>{label}</button>)}</nav>
    <div hidden={view!=='stock'}>
    <form className="product-filter-panel inventory-filter" onSubmit={(event) => { event.preventDefault(); changeFilters({ search: searchDraft.trim(), page: 1 }) }}>
      <label htmlFor="inventory-search">Search products, SKU, or barcode</label><div className="product-actions"><input id="inventory-search" type="search" maxLength="100" placeholder="Search inventory" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /><button type="submit">Search</button><button type="button" className="secondary-action" onClick={() => { setSearchDraft(''); changeFilters({ search: '', page: 1 }) }}>Reset</button></div>
    </form>
    {state.kind === 'loading' && <div className="product-state"><div className="spinner" aria-label="Loading inventory" /><p>Loading inventory...</p></div>}
    {state.kind === 'error' && <div className="product-state"><h2>Inventory unavailable</h2><p className="error-message" role="alert">{state.message}</p><button type="button" onClick={refresh}>Try again</button></div>}
    {state.kind === 'ready' && <>
      <div className="product-list-summary"><span>{state.total} product{state.total === 1 ? '' : 's'}</span><button type="button" className="text-button" onClick={refresh}>Refresh stock</button></div>
      {state.products.length === 0 ? <div className="product-state"><h2>{filters.search ? 'No matching products' : 'No products yet'}</h2><p>{filters.search ? 'Try another search or clear your search.' : 'Add your first product here, then receive stock.'}</p>{!filters.search && <button type="button" disabled={pending.length>0 || Boolean(recoveryError)} onClick={()=>{setCreating(true);setDefinition(null)}}>Add product</button>}</div> : <InventoryProductPicker products={state.products} role={role} currency={currency} blocked={pending.length>0 || Boolean(recoveryError)} onReceive={(product)=>{if(confirmDiscardChanges()){setCreating(false);setDefinition(null);setReceiving(product)}}} onRestock={(product,variant)=>{setFeedback(null);setTarget({product,variant})}} renderCost={(product,variant)=><OpeningCostForm product={product} variant={variant} currency={currency} onSaved={()=>{setFeedback({kind:'success',message:'Purchase cost saved. Stock quantity is unchanged.'});refresh()}}/>}/>}
      {state.products.length>0 && <nav className="product-pagination" aria-label="Inventory pages"><button type="button" className="secondary-action" disabled={filters.page <= 1} onClick={() => changeFilters({ ...filters, page: filters.page - 1 })}>Previous</button><span>Page {state.page} of {pageCount}</span><button type="button" className="secondary-action" disabled={filters.page >= pageCount} onClick={() => changeFilters({ ...filters, page: filters.page + 1 })}>Next</button></nav>}
    </>}
    </div>
    <div hidden={view!=='receipts'}><ReceiptHistory refreshVersion={version} role={role} currency={currency} /></div>
    <div hidden={view!=='movements'}><InventoryHistory refreshVersion={version} role={role} currency={currency} products={state.kind === 'ready' ? state.products : []} /></div>
    <div hidden={view!=='check'}><InventoryReconciliation refreshVersion={version} products={state.kind === 'ready' ? state.products : []} /></div>
    </div>
    {target && role === 'OWNER' && <RestockDialog key={`${target.product.id}:${target.variant.id}`} product={target.product} variant={target.variant} onClose={() => setTarget(null)} onRefresh={refresh} onSuccess={(result) => {
      setTarget(null); refresh()
      setFeedback({kind:'success',message:result.idempotentReplay
        ? `This Restock was already processed. Current stock is ${result.variant.currentStock}.`
        : `Restock completed: +${result.restock.quantity} units. Updated stock: ${result.variant.currentStock}. Purchase cost: ${formatMoney(result.restock.unitCost, currency, 4)}.`})
    }} />}
  </section>
}
