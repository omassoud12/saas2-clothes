import { useEffect, useRef } from 'react'
import { formatMoney } from '../../lib/money.js'
import { recoverySummary } from './inventory-presentation.js'
import { RECEIPT_OUTCOME, canRetryReceiptOperation } from './stock-receipt-outcome.js'

export function InventoryFeedback({ kind = 'info', children }) {
  const symbol = { success: '✓', error: '!', pending: '◇', info: 'i' }[kind]
  return <div className={`inventory-feedback is-${kind}`} role={kind === 'error' ? 'alert' : 'status'}><span aria-hidden="true">{symbol}</span><div>{children}</div></div>
}

export function ReceiptSteps({ owner, newProduct, current = 0 }) {
  const labels = owner ? newProduct ? ['Product', 'Quantities & cost', 'Review'] : ['Quantities & cost', 'Review'] : ['Product details', 'Product review']
  return <ol className="receipt-steps" aria-label="Workflow progress">{labels.map((label, index) => <li key={label} className={index === current ? 'is-current' : index < current ? 'is-complete' : ''} aria-current={index === current ? 'step' : undefined}><span aria-hidden="true">{index < current ? '✓' : index + 1}</span>{label}</li>)}</ol>
}

export function ReceiptReview({ review, name, variants, currency }) {
  const focus = useRef(null)
  useEffect(() => { focus.current?.focus() }, [])
  const items = review.summary?.payload.items ?? []
  const rows = items.map((item) => {
    const option = variants.find((variant) => (variant.id ?? variant.sku) === (item.variantId ?? item.sku))
    return <li key={item.variantId ?? item.sku}><span>{option?.color || 'No color'} / {option?.size || 'No size'}</span><strong>+{item.quantity} received</strong></li>
  })
  return <section className="receipt-review" aria-labelledby="receipt-review-title"><h2 id="receipt-review-title" tabIndex={-1} ref={focus}>{review.receive ? 'Review receiving' : 'Review product'}</h2><p className="receipt-review-product">{name}</p>
    {review.receive ? <><p>Confirming adds these pieces to current stock.</p><ul className="receipt-review-items">{rows.slice(0, 8)}</ul>{rows.length > 8 && <details><summary>Show {rows.length - 8} more options</summary><ul className="receipt-review-items">{rows.slice(8)}</ul></details>}
      <dl className="receipt-summary"><div><dt>Options</dt><dd>{items.length}</dd></div><div><dt>Total pieces</dt><dd>{review.summary.totalQuantity}</dd></div><div><dt>Unit cost</dt><dd>{formatMoney(review.summary.payload.unitCost, currency, 4)}</dd></div><div className="receipt-summary-total"><dt>Purchase total</dt><dd>{formatMoney(review.summary.totalCost, currency, 4)}</dd></div></dl></>
      : <p>The product will be created with zero stock and no purchase cost.</p>}
  </section>
}

export function ReceiptRecoveryBanner({ record, profile, products, retrying, onRetry, onCheck, onHistory }) {
  const info = recoverySummary(record, profile.user.role === 'OWNER')
  const name = info.name || products.find((product) => product.id === info.productId)?.name || 'Saved product selection'
  const quantityText = `${info.quantity} pieces · ${info.options} option${info.options === 1 ? '' : 's'}`
  const outcome = record.recovery?.outcome
  const conflict = outcome === RECEIPT_OUTCOME.CONFLICT
  const paused = [RECEIPT_OUTCOME.AUTH_PAUSE, RECEIPT_OUTCOME.ACCOUNT_PAUSE].includes(outcome)
  const retryAllowed = canRetryReceiptOperation(record) || (outcome === RECEIPT_OUTCOME.ACCOUNT_PAUSE && record.recovery?.code === 'ROLE_FORBIDDEN' && profile.user.role === 'OWNER')
  const heading = conflict ? info.saveOnly ? 'Product save needs review' : 'Receiving operation needs review'
    : paused ? info.saveOnly ? 'Product save paused' : 'Receiving paused'
      : info.saveOnly ? 'Product save awaiting confirmation' : 'Receiving awaiting confirmation'
  const guidance = conflict ? `${record.recovery.message}${profile.user.role === 'OWNER' ? '' : ' Ask an Owner to inspect this saved operation before continuing.'}`
    : outcome === RECEIPT_OUTCOME.AUTH_PAUSE ? `Authentication interrupted confirmation. Retry the original ${info.saveOnly ? 'product save' : 'receiving request'} after signing in.`
      : outcome === RECEIPT_OUTCOME.ACCOUNT_PAUSE ? record.recovery.message
        : `Retry the original ${info.saveOnly ? 'product save' : 'receiving request'} to confirm its result.`
  const retryLabel = info.saveOnly ? 'Retry original product save' : 'Retry original receiving request'
  return <section className="receipt-recovery" aria-label={info.saveOnly ? 'Pending product save' : 'Pending receiving operation'} data-outcome={outcome || RECEIPT_OUTCOME.UNCERTAIN}><InventoryFeedback kind="pending"><strong>{heading}</strong><p>{name}</p><p>{info.saveOnly ? 'Zero-stock product definition' : quantityText}{info.total !== null && ` · ${formatMoney(info.total, profile.account?.baseCurrency, 4)}`}</p><p>Started {new Date(record.createdAt).toLocaleString()}. {guidance}</p><details open={conflict || undefined}><summary>Original operation details</summary><p>Operation {record.operationId}</p>{info.productId && <p>Product {info.productId}</p>}{info.unitCost != null && <p>Unit cost {formatMoney(info.unitCost, profile.account?.baseCurrency, 4)}</p>}</details><div className="product-actions">{retryAllowed && <button disabled={retrying} onClick={() => onRetry(record)}>{retrying ? `Confirming original ${info.saveOnly ? 'product save' : 'receiving request'}…` : retryLabel}</button>}{conflict && profile.user.role === 'OWNER' && <button className="secondary-action" disabled={retrying} onClick={() => onCheck(record)}>{retrying ? 'Checking original result…' : 'Check original result'}</button>}{conflict && !info.saveOnly && <button className="secondary-action" disabled={retrying} onClick={onHistory}>View receipt history</button>}</div></InventoryFeedback></section>
}

export function ReceiptSuccess({ result, name, currency, owner, onBack, onHistory, onMore }) {
  const focus = useRef(null)
  useEffect(() => { focus.current?.focus() }, [])
  return <section className="product-panel receipt-success"><InventoryFeedback kind="success"><h2 ref={focus} tabIndex={-1}>{result.receipt ? 'Stock received successfully' : 'Product saved'}</h2><p>{name}</p><p>{result.receipt ? `${result.receipt.totalQuantity ?? 'Confirmed'} pieces received` : 'The product was created with zero stock.'}</p>{result.receipt && <><p>Receipt #{result.receipt.id}</p>{owner && result.receipt.totalCost != null && <p>Purchase total: {formatMoney(result.receipt.totalCost, currency, 4)}</p>}</>}{result.idempotentReplay && <p>This original operation was already processed; it was not applied again.</p>}</InventoryFeedback><div className="product-actions">{result.receipt && <button onClick={onHistory}>View receipt history</button>}{onMore && <button className="secondary-action" onClick={onMore}>Receive more stock</button>}<button className="secondary-action" onClick={onBack}>Back to inventory</button></div></section>
}
