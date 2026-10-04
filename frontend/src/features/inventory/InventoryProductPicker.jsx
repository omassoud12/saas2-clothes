import { canShowVariantCost } from '../products/product-flow.js'
import { canRestock } from './restock-flow.js'
import { formatMoney } from '../../lib/money.js'

export function InventoryProductPicker({ products, role, currency, blocked, onReceive, onRestock, renderCost }) {
  return <div className="inventory-picker">{products.map((product) => {
    const active = product.isActive ? product.variants.filter((variant) => variant.isActive) : []
    const stock = active.reduce((sum, variant) => sum + BigInt(variant.currentStock), 0n).toString()
    return <article className="inventory-picker-row" key={product.id}>
      <div className="inventory-picker-main"><span className="inventory-picker-photo">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span aria-hidden="true">◇</span>}</span>
        <div className="inventory-picker-identity"><h2>{product.name}</h2><p>{product.category.name}</p><span>{stock} available <span aria-hidden="true">·</span> {active.length} option{active.length === 1 ? '' : 's'}</span></div>
        <span className={`product-status ${product.isActive ? '' : 'is-inactive'}`}>{product.isActive ? 'Active' : 'Inactive'}</span>
        {role === 'OWNER' && product.isActive && <button className="inventory-receive-button" type="button" disabled={blocked} onClick={() => onReceive(product)}>Receive stock</button>}
      </div>
      {product.variants.length === 0 ? <p className="inventory-no-options">No colors or sizes yet.</p> : <details className="inventory-product-tools"><summary>Stock details &amp; other actions</summary><div className="inventory-product-tools-body"><p>Use Receive stock for purchased deliveries. Legacy Restock handles one option; Products +/− controls are count corrections.</p>
        <div className="inventory-option-list">{product.variants.map((variant) => <div className="inventory-option-row" key={variant.id}>
          <div className="inventory-option-name"><strong>{[variant.color, variant.size].filter(Boolean).join(' / ') || 'No color / size'}</strong><small>SKU: {variant.sku}</small>{!variant.isActive && <small>Inactive</small>}</div>
          <div className="inventory-option-figures"><span><small>Current stock</small><strong>{variant.currentStock}</strong></span>{canShowVariantCost(role, variant) && <span><small>Last purchase cost</small><strong>{variant.lastPurchaseCost === null ? 'Not available' : formatMoney(variant.lastPurchaseCost, currency, 4)}</strong></span>}</div>
          <div className="inventory-option-actions">{role === 'OWNER' && product.isActive && variant.isActive && variant.currentStock >= 0 && variant.lastPurchaseCost === null && renderCost(product, variant)}{canRestock(role, product, variant) && <button type="button" className="secondary-action" onClick={() => onRestock(product, variant)}>Legacy Restock</button>}</div>
        </div>)}</div></div></details>}
    </article>
  })}</div>
}
