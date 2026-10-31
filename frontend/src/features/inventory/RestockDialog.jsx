import { useEffect, useRef, useState } from 'react'
import { createRestockWorkflow, postRestock } from './restock-flow.js'
import { supabase } from '../../lib/supabase.js'
import { useI18n } from '../../i18n/I18nContext.js'

const blankDraft = { quantity: '', unitCost: '', note: '' }

export function RestockDialog({ product, variant, onClose, onSuccess, onRefresh }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(blankDraft)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [stale, setStale] = useState(false)
  const [editingUncertain, setEditingUncertain] = useState(false)
  const [workflow] = useState(() => createRestockWorkflow({ send: ({ productId, variantId, payload, idempotencyKey }) =>
    postRestock({ supabase, productId, variantId, ...payload, idempotencyKey }) }))
  const dialog = useRef(null)
  const trigger = useRef(document.activeElement)
  const closeState = useRef({ busy: false, uncertain: false })

  const uncertain = workflow.hasUncertainAttempt()

  useEffect(() => {
    closeState.current = { busy, uncertain }
  }, [busy, uncertain])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const initialTrigger = trigger.current
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector('input:not(:disabled), button:not(:disabled), textarea:not(:disabled)')?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        if (!closeState.current.busy && !closeState.current.uncertain) onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialog.current ? [...dialog.current.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )] : []
      if (focusable.length === 0) return
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault()
        focusable.at(-1).focus()
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault()
        focusable[0].focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      initialTrigger?.focus?.()
    }
  }, [onClose])

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

  const conflict = feedback?.code === 'RESTOCK_IDEMPOTENCY_CONFLICT'
  const locked = busy || (uncertain && !editingUncertain) || conflict || stale
  return <div className="restock-overlay"><section ref={dialog} className="restock-dialog" role="dialog" aria-modal="true" aria-labelledby="restock-title" aria-describedby="restock-context">
    <div className="product-section-heading"><div><span className="eyebrow">{t('Inventory')}</span><h2 id="restock-title">{t('Restock variant')}</h2></div><button type="button" className="secondary-action" disabled={busy || uncertain} onClick={onClose} aria-label={t('Close Restock form')}>{t('Close')}</button></div>
    <p id="restock-context" className="product-muted">{product.name} · {variant.sku}{[variant.color, variant.size].filter(Boolean).length ? ` · ${[variant.color, variant.size].filter(Boolean).join(' / ')}` : ''}</p>
    <p>{t('Current stock:')} <strong>{variant.currentStock}</strong> <small>{t('(read-only)')}</small></p>
    {feedback && <p className="product-feedback error-message" role="alert">{t(feedback.message)}</p>}
    {uncertain && <p className="product-muted">{t('Starting a different Restock could add stock again if the first request succeeded. Retry the same details first when possible.')}</p>}
    <form className="product-form" onSubmit={submit} noValidate>
      <div className="product-form-grid"><div><label htmlFor="restock-quantity">{t('Quantity to add')}</label><input id="restock-quantity" autoFocus required inputMode="numeric" pattern="[0-9]*" value={draft.quantity} disabled={locked} aria-invalid={feedback?.field === 'quantity'} aria-describedby={feedback?.field === 'quantity' ? 'restock-error' : undefined} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /><small>{t('Whole units, 1–1,000,000.')}</small></div>
        <div><label htmlFor="restock-cost">{t('Purchase unit cost')}</label><input id="restock-cost" required inputMode="decimal" value={draft.unitCost} disabled={locked} aria-invalid={feedback?.field === 'unitCost'} aria-describedby={feedback?.field === 'unitCost' ? 'restock-error' : undefined} onChange={(event) => setDraft({ ...draft, unitCost: event.target.value })} /><small>{t('Greater than zero; up to four decimals.')}</small></div></div>
      <div><label htmlFor="restock-note">{t('Note (optional)')}</label><textarea id="restock-note" rows="3" value={draft.note} disabled={locked} aria-invalid={feedback?.field === 'note'} aria-describedby={feedback?.field === 'note' ? 'restock-error' : undefined} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /><small>{t('Up to 500 characters.')}</small></div>
      {feedback?.field && <span id="restock-error" className="sr-only">{t(feedback.message)}</span>}
      <div className="product-actions"><button type="submit" disabled={locked}>{busy ? t('Saving Restock...') : t('Confirm Restock')}</button>{uncertain && <><button type="button" disabled={busy} onClick={retry}>{t('Retry same Restock')}</button>{!editingUncertain && <button type="button" className="secondary-action" disabled={busy} onClick={() => { setEditingUncertain(true); setFeedback(null) }}>{t('Edit details')}</button>}</>}{conflict && <button type="button" className="secondary-action" onClick={() => { workflow.reset(); setFeedback(null) }}>{t('Start new Restock')}</button>}<button type="button" className="secondary-action" disabled={busy || uncertain} onClick={onClose}>{t('Cancel')}</button></div>
    </form>
  </section></div>
}
