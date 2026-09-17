import { useState } from 'react'
import { createRestockWorkflow, postRestock } from './restock-flow.js'
import { supabase } from '../lib/supabase.js'

const blankDraft = { quantity: '', unitCost: '', note: '' }

export function RestockDialog({ product, variant, onClose, onSuccess, onRefresh }) {
  const [draft, setDraft] = useState(blankDraft)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [stale, setStale] = useState(false)
  const [editingUncertain, setEditingUncertain] = useState(false)
  const [workflow] = useState(() => createRestockWorkflow({ send: ({ productId, variantId, payload, idempotencyKey }) =>
    postRestock({ supabase, productId, variantId, ...payload, idempotencyKey }) }))

  async function handleResult(result) {
    if (result.skipped) return
    if (result.requiresLogin) { window.location.replace('/login'); return }
    if (result.requiresAccountReview) { window.location.replace('/pending-approval'); return }
    if (result.ok) { onSuccess(result); return }
    setFeedback({ message: result.message, field: result.field, code: result.code, uncertain: Boolean(result.uncertain) })
    if (result.uncertain) setEditingUncertain(false)
    if (result.refresh) { setStale(true); onRefresh() }
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setFeedback(null)
    try { await handleResult(await workflow.submit({ productId: product.id, variantId: variant.id, draft })) }
    finally { setBusy(false) }
  }

  async function retry() {
    if (busy) return
    setBusy(true); setFeedback(null)
    try { await handleResult(await workflow.retry()) }
    finally { setBusy(false) }
  }

  const uncertain = workflow.hasUncertainAttempt()
  const conflict = feedback?.code === 'RESTOCK_IDEMPOTENCY_CONFLICT'
  const locked = busy || (uncertain && !editingUncertain) || conflict || stale
  return <div className="restock-overlay"><section className="restock-dialog" role="dialog" aria-modal="true" aria-labelledby="restock-title" aria-describedby="restock-context">
    <div className="product-section-heading"><div><span className="eyebrow">Inventory</span><h2 id="restock-title">Restock variant</h2></div><button type="button" className="secondary-action" disabled={busy || uncertain} onClick={onClose} aria-label="Close Restock form">Close</button></div>
    <p id="restock-context" className="product-muted">{product.name} · {variant.sku}{[variant.color, variant.size].filter(Boolean).length ? ` · ${[variant.color, variant.size].filter(Boolean).join(' / ')}` : ''}</p>
    <p>Current stock: <strong>{variant.currentStock}</strong> <small>(read-only)</small></p>
    {feedback && <p className="product-feedback error-message" role="alert">{feedback.message}</p>}
    {uncertain && <p className="product-muted">Starting a different Restock could add stock again if the first request succeeded. Retry the same details first when possible.</p>}
    <form className="product-form" onSubmit={submit} noValidate>
      <div className="product-form-grid"><div><label htmlFor="restock-quantity">Quantity to add</label><input id="restock-quantity" autoFocus required inputMode="numeric" pattern="[0-9]*" value={draft.quantity} disabled={locked} aria-invalid={feedback?.field === 'quantity'} aria-describedby={feedback?.field === 'quantity' ? 'restock-error' : undefined} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /><small>Whole units, 1–1,000,000.</small></div>
        <div><label htmlFor="restock-cost">Purchase unit cost</label><input id="restock-cost" required inputMode="decimal" value={draft.unitCost} disabled={locked} aria-invalid={feedback?.field === 'unitCost'} aria-describedby={feedback?.field === 'unitCost' ? 'restock-error' : undefined} onChange={(event) => setDraft({ ...draft, unitCost: event.target.value })} /><small>Greater than zero; up to four decimals.</small></div></div>
      <div><label htmlFor="restock-note">Note (optional)</label><textarea id="restock-note" rows="3" value={draft.note} disabled={locked} aria-invalid={feedback?.field === 'note'} aria-describedby={feedback?.field === 'note' ? 'restock-error' : undefined} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /><small>Up to 500 characters.</small></div>
      {feedback?.field && <span id="restock-error" className="sr-only">{feedback.message}</span>}
      <div className="product-actions"><button type="submit" disabled={locked}>{busy ? 'Saving Restock...' : 'Confirm Restock'}</button>{uncertain && <><button type="button" disabled={busy} onClick={retry}>Retry same Restock</button>{!editingUncertain && <button type="button" className="secondary-action" disabled={busy} onClick={() => { setEditingUncertain(true); setFeedback(null) }}>Edit details</button>}</>}{conflict && <button type="button" className="secondary-action" onClick={() => { workflow.reset(); setFeedback(null) }}>Start new Restock</button>}<button type="button" className="secondary-action" disabled={busy || uncertain} onClick={onClose}>Cancel</button></div>
    </form>
  </section></div>
}
