import { useState } from 'react'
import { StockReceiptForm } from './StockReceiptForm.jsx'
import { useReceiptRecovery } from './useReceiptRecovery.js'
import { InventoryFeedback, ReceiptRecoveryBanner } from './ReceiptPresentation.jsx'

export function ProductRestock({ profile, product, onSaved, onCancel }) {
  const [success, setSuccess] = useState(null)
  const [failure, setFailure] = useState('')
  function received(result) { setSuccess(result); setFailure(''); onSaved() }
  const recovery = useReceiptRecovery(profile, received)
  return <div className="product-restock">
    <div className="product-section-intro"><h2>Restock</h2><p>Record a purchased delivery. Positive quantities create a receipt and RESTOCK movements. Use Count Check for physical corrections.</p></div>
    {failure && <InventoryFeedback kind="error">{failure}</InventoryFeedback>}
    {recovery.recoveryError && <InventoryFeedback kind="error">{recovery.recoveryError}</InventoryFeedback>}
    {recovery.feedback && <InventoryFeedback kind={recovery.feedback.kind}>{recovery.feedback.message}</InventoryFeedback>}
    {recovery.pending.map(record => record.path === '/api/inventory/receipts' && record.payload.productId === product.id
      ? <ReceiptRecoveryBanner key={record.operationId} record={record} profile={profile} products={[product]} retrying={recovery.retrying} onRetry={recovery.retry} onCheck={recovery.checkOriginal} onHistory={() => onCancel('receipts')} />
      : <InventoryFeedback key={record.operationId} kind="pending">Another saved operation must be resolved first. <a href={record.path === '/api/inventory/product-setups' ? '/app/inventory' : `/app/products/${encodeURIComponent(record.payload.productId)}?section=restock`}>Open its workflow</a></InventoryFeedback>)}
    {success ? <section className="product-panel receipt-success"><InventoryFeedback kind="success"><h2 tabIndex={-1} ref={node => node?.focus()}>Stock received successfully</h2><p>{success.receipt?.totalQuantity ?? 'Confirmed'} pieces received for {product.name}.</p>{success.idempotentReplay && <p>The original receipt was already processed; it was not applied again.</p>}</InventoryFeedback><div className="product-actions"><button onClick={() => onCancel('stock')}>View stock</button><button className="secondary-action" onClick={() => setSuccess(null)}>Receive another delivery</button><button className="text-button" onClick={() => onCancel('receipts')}>Receipt history</button></div></section>
      : !product.isActive ? <InventoryFeedback>Reactivate this product in Overview before receiving stock.</InventoryFeedback>
        : <StockReceiptForm product={product} profile={profile} scope={recovery.scope} blocked={recovery.blocked} onSaved={received} onTerminal={result => { setFailure(result.message); onSaved() }} onCancel={() => onCancel('overview')} />}
  </div>
}
