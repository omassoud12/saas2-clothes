import { useState } from 'react'
import { StockReceiptForm } from './StockReceiptForm.jsx'
import { useReceiptRecovery } from './useReceiptRecovery.js'
import { InventoryFeedback, ReceiptRecoveryBanner } from './ReceiptPresentation.jsx'
import { useI18n } from '../../i18n/I18nContext.js'

export function ProductRestock({ profile, product, onSaved, onCancel }) {
  const { t } = useI18n()
  const [success, setSuccess] = useState(null)
  const [failure, setFailure] = useState('')
  function received(result) { setSuccess(result); setFailure(''); onSaved() }
  const recovery = useReceiptRecovery(profile, received)
  return <div className="product-restock">
    <div className="product-section-intro"><h2>{t('Restock')}</h2><p>{t('Record purchased stock.')}</p><small>{t('For physical corrections, use Count Check.')}</small></div>
    {failure && <InventoryFeedback kind="error">{failure}</InventoryFeedback>}
    {recovery.recoveryError && <InventoryFeedback kind="error">{recovery.recoveryError}</InventoryFeedback>}
    {recovery.feedback && <InventoryFeedback kind={recovery.feedback.kind}>{t(recovery.feedback.message)}</InventoryFeedback>}
    {recovery.pending.map(record => record.path === '/api/inventory/receipts' && record.payload.productId === product.id
      ? <ReceiptRecoveryBanner key={record.operationId} record={record} profile={profile} products={[product]} retrying={recovery.retrying} onRetry={recovery.retry} onCheck={recovery.checkOriginal} onHistory={() => onCancel('receipts')} />
      : <InventoryFeedback key={record.operationId} kind="pending">{t('Another saved operation must be resolved first.')} <a href={record.path === '/api/inventory/product-setups' ? '/app/inventory' : `/app/products/${encodeURIComponent(record.payload.productId)}?section=restock`}>{t('Open its workflow')}</a></InventoryFeedback>)}
    {success ? <section className="product-panel receipt-success"><InventoryFeedback kind="success"><h2 tabIndex={-1} ref={node => node?.focus()}>{t('Stock received successfully')}</h2><p>{success.receipt?.totalQuantity ?? t('Confirmed')} {t('pieces received for {name}.', { name: product.name })}</p>{success.idempotentReplay && <p>{t('The original receipt was already processed; it was not applied again.')}</p>}</InventoryFeedback><div className="product-actions"><button onClick={() => onCancel('stock')}>{t('View stock')}</button><button className="secondary-action" onClick={() => setSuccess(null)}>{t('Receive another delivery')}</button><button className="text-button" onClick={() => onCancel('receipts')}>{t('Receipt history')}</button></div></section>
      : !product.isActive ? <InventoryFeedback>{t('Reactivate this product in Overview before receiving stock.')}</InventoryFeedback>
        : <StockReceiptForm product={product} profile={profile} scope={recovery.scope} blocked={recovery.blocked} onSaved={received} onTerminal={result => { setFailure(result.message); onSaved() }} onCancel={() => onCancel('overview')} />}
  </div>
}
