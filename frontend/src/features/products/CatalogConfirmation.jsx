import { useEffect, useRef } from 'react'
import { useI18n } from '../../i18n/I18nContext.js'

export function CatalogConfirmation({ target, busy, error, onConfirm, onClose }) {
  const { t } = useI18n()
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    const trigger = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => { document.body.style.overflow = previousOverflow; element.close(); trigger?.focus?.() }
  }, [])
  const action = target.kind === 'count' ? 'Confirm correction' : target.kind === 'image' ? 'Remove image' : `${target.next ? 'Reactivate' : 'Deactivate'} ${target.kind === 'variant' ? 'color / size' : 'product'}`
  return <dialog ref={dialog} className="catalog-confirmation-dialog" aria-labelledby="catalog-confirm-title" aria-describedby="catalog-confirm-description" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <h2 id="catalog-confirm-title">{target.kind === 'count' ? t('Correct physical count?') : `${action}?`}</h2>
    <p><strong>{t(target.label)}</strong></p>
    <p id="catalog-confirm-description">{target.kind === 'count' ? `${target.delta > 0 ? 'Add' : 'Remove'} exactly one piece. System stock: ${target.variant.currentStock} to ${target.variant.currentStock + target.delta}. Records an ADJUSTMENT with no purchase or receipt.` : target.kind === 'image' ? t('The current product photo will be removed.') : target.next ? t('This item will be active again. Its product must also be active to appear in Sales.') : target.kind === 'variant' ? t('Only this color / size will be hidden from Sales. Other sizes stay unchanged. Historical records are kept.') : t('This product and its sizes will be hidden from Sales. Historical records are kept.')}</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="product-actions"><button type="button" autoFocus className="secondary-action" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button type="button" className={target.kind === 'count' || target.next ? '' : 'danger-action'} disabled={busy} onClick={onConfirm}>{busy ? t('Working...') : action}</button></div>
  </dialog>
}
