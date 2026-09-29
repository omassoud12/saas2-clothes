import { useEffect, useRef } from 'react'

export function CatalogConfirmation({ target, busy, error, onConfirm, onClose }) {
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    const trigger = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => { document.body.style.overflow = previousOverflow; element.close(); trigger?.focus?.() }
  }, [])
  const action = target.kind === 'image' ? 'Remove image' : `${target.next ? 'Reactivate' : 'Deactivate'} ${target.kind === 'variant' ? 'color / size' : 'product'}`
  return <dialog ref={dialog} className="catalog-confirmation-dialog" aria-labelledby="catalog-confirm-title" aria-describedby="catalog-confirm-description" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <h2 id="catalog-confirm-title">{action}?</h2>
    <p><strong>{target.label}</strong></p>
    <p id="catalog-confirm-description">{target.kind === 'image' ? 'The current product photo will be removed.' : target.next ? 'This item will be active again. Its product must also be active to appear in Sales.' : target.kind === 'variant' ? 'Only this color / size will be hidden from Sales. Other sizes stay unchanged. Historical records are kept.' : 'This product and its sizes will be hidden from Sales. Historical records are kept.'}</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="product-actions"><button type="button" autoFocus className="secondary-action" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={target.next ? '' : 'danger-action'} disabled={busy} onClick={onConfirm}>{busy ? 'Working...' : action}</button></div>
  </dialog>
}
