import { OpeningCostForm } from './OpeningCostForm.jsx'
import { ColorSwatch } from './ColorSwatch.jsx'
import { groupVariantsByColor } from './product-options.js'
import { canRestock } from '../inventory/restock-flow.js'
import { formatMoney } from '../../lib/money.js'

export function ProductStock({ product, role, currency, onSaved }) {
  return <section className="product-panel stock-inspection"><div className="product-section-intro"><h2>Stock</h2><p>Current quantities by color and size. Receive purchases in Restock; correct physical counts in Count Check.</p></div>
    {!product.variants.length && <p>No variants yet. Add colors and sizes in Overview.</p>}
    {groupVariantsByColor(product.variants).map(([color, variants]) => <section className="stock-inspection-group" key={variants[0].id}><h3><ColorSwatch name={color} />{color}</h3>{variants.map(variant => <article className="stock-inspection-row" key={variant.id}><div><strong>{variant.size || 'No size'}</strong><small>{variant.isActive && product.isActive ? 'Active' : 'Inactive'}</small></div><div><span className="product-muted">System stock</span><strong>{variant.currentStock} pieces</strong></div><div><span className="product-muted">Selling price</span><strong>{variant.sellingPrice == null ? 'Not set' : formatMoney(variant.sellingPrice, currency)}</strong></div>{role === 'OWNER' && <div className="stock-purchase-cost"><span className="product-muted">Current purchase cost</span><strong>{variant.lastPurchaseCost == null ? 'Unknown — cost pending' : formatMoney(variant.lastPurchaseCost, currency, 4)}</strong>{variant.lastPurchaseCost == null && canRestock(role, product, variant) && <OpeningCostForm product={product} variant={variant} currency={currency} onSaved={onSaved} />}</div>}</article>)}</section>)}
  </section>
}

export function ProductCountCheck({ product, role, busy, stockBusy, pendingStock, recoveryError, onCorrect, onRetry }) {
  return <section className="product-panel count-check"><div className="product-section-intro"><h2>Count Check</h2><p>Compare your physical count with system stock. Each confirmed + / − corrects exactly one piece and records an ADJUSTMENT. It creates no purchase or receipt.</p>{role !== 'OWNER' && <p>An owner must confirm physical count corrections. You can inspect stock and reconciliation.</p>}</div>
    {!product.variants.length && <p>No variants to count yet.</p>}
    {groupVariantsByColor(product.variants).map(([color, variants]) => <section className="count-check-group" key={variants[0].id}><h3><ColorSwatch name={color} />{color}</h3>{variants.map(variant => {
      const pending = pendingStock.find(record => record.variantId === variant.id)
      const blocked = busy || stockBusy.has(variant.id) || Boolean(pending) || Boolean(recoveryError)
      return <article className="count-check-row" key={variant.id}><div><strong>{variant.size || 'No size'}</strong><small>{variant.isActive && product.isActive ? 'Active' : 'Inactive'}</small></div><div className="count-check-quantity"><small>System stock</small><strong>{variant.currentStock}</strong></div>{canRestock(role, product, variant) && <div className="count-check-actions"><button type="button" className="secondary-action stock-step" aria-label={`Remove one piece: ${color} / ${variant.size || 'No size'}`} disabled={blocked || variant.currentStock === 0} onClick={() => onCorrect(variant, -1)}>−</button><button type="button" className="secondary-action stock-step" aria-label={`Add one piece: ${color} / ${variant.size || 'No size'}`} disabled={blocked} onClick={() => onCorrect(variant, 1)}>+</button></div>}
        {stockBusy.has(variant.id) ? <p className="count-check-recovery" role="status">Confirming correction...</p> : pending && <div className="count-check-recovery"><p>Count correction awaiting confirmation.</p>{pending.requiresReview && <p>Older update: review movement history before retrying the original request.</p>}<button type="button" className="secondary-action" disabled={busy || Boolean(recoveryError)} onClick={() => onRetry(variant, pending.delta)}>Retry same update</button></div>}
      </article>
    })}</section>)}
  </section>
}
