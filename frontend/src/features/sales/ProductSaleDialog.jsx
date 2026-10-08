import { useRef, useState } from 'react'
import { addVariantToCart, calculateCart, setCartPrice, setCartQuantity } from './sale-flow.js'
import { decimalToMinorUnits, formatMoney } from '../../lib/money.js'
import { SalesProductImage } from './SalesCatalog.jsx'
import { SaleDialog } from './SaleDialog.jsx'

export function ProductSaleDialog({ product, role, currency, cart, busy, refreshing, onClose, onSell, onAdd }) {
  const variants = product.variants.filter((variant) => variant.isActive)
  const colors = [...new Set(variants.map((variant) => variant.color || ''))]
  const [color, setColor] = useState(colors.length === 1 ? colors[0] : null)
  const [variantId, setVariantId] = useState(variants.length === 1 ? variants[0].id : '')
  const [quantity, setQuantity] = useState('1')
  const [price, setPrice] = useState(variants.length === 1 ? cart.find((line) => line.variantId === variants[0].id)?.unitSoldPrice || variants[0].sellingPrice || '' : '')
  const [feedback, setFeedback] = useState(null)
  const [retryPending, setRetryPending] = useState(false)
  const frozenLines = useRef(null)
  const variant = variants.find((item) => item.id === variantId)
  const reserved = cart.find((line) => line.variantId === variantId)?.quantity || 0
  const available = Math.max(0, (variant?.currentStock || 0) - reserved)
  const unitPrice = role === 'OWNER' ? price : variant?.sellingPrice || ''
  const selectedQuantity = /^\d+$/.test(quantity) ? Number(quantity) : 0
  const preview = calculateCart(variant ? [{ unitSoldPrice: unitPrice, quantity: selectedQuantity }] : [])
  const validPrice = (decimalToMinorUnits(unitPrice) ?? 0n) > 0n && /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(unitPrice)
  const valid = Boolean(product.isActive && variant && selectedQuantity > 0 && selectedQuantity <= available && selectedQuantity <= 1_000_000 && validPrice && currency && preview.valid)
  const locked = busy || retryPending
  const choicesLocked = locked || refreshing

  function chooseVariant(item) {
    setVariantId(item.id); setQuantity('1'); setPrice(cart.find((line) => line.variantId === item.id)?.unitSoldPrice || item.sellingPrice || ''); setFeedback(null)
  }

  function buildLines() {
    if (!valid) return { ok: false, message: 'Choose an available size, a valid quantity, and a selling price.' }
    let result = addVariantToCart([], product, variant, role)
    if (result.ok) result = setCartQuantity(result.cart, variant.id, selectedQuantity)
    if (result.ok && role === 'OWNER') result = setCartPrice(result.cart, variant.id, price, role)
    return result
  }

  async function sell(event) {
    event.preventDefault()
    if (busy || (!retryPending && cart.length > 0)) return
    const built = retryPending ? { ok: true, cart: frozenLines.current } : buildLines()
    if (!built.ok) { setFeedback(built.message); return }
    frozenLines.current = built.cart
    const result = await onSell(built.cart)
    if (!result || result.ok || result.skipped) return
    setFeedback(result.message)
    setRetryPending(Boolean(result.retryable))
  }

  function add() {
    const built = buildLines()
    if (!built.ok) { setFeedback(built.message); return }
    const result = onAdd(built.cart[0], product, variant)
    if (!result.ok) setFeedback(result.message)
  }

  return <SaleDialog titleId="quick-sale-title" onClose={onClose} locked={locked} className="sale-product-dialog">
    <header className="sale-dialog-header"><div className="sale-dialog-product"><div className="sale-dialog-thumbnail"><SalesProductImage product={product} /></div><div className="sale-dialog-copy"><span className="eyebrow">Product details</span><h2 id="quick-sale-title">{product.name}</h2><p>{product.category.name}</p></div></div><button type="button" className="secondary-action sale-close" disabled={locked} onClick={onClose} aria-label="Close product details">×</button></header>
    <form className="sale-quick-form" onSubmit={sell} noValidate>
      <div className="sale-dialog-body"><div className="sale-detail-photo"><SalesProductImage product={product} /></div>
        <div className="sale-options">
          {variants.length === 0 ? <p className="sale-option-notice">No active options are available for this product.</p> : <>
            <fieldset disabled={choicesLocked} className="sale-choice-group"><legend>1. Choose color</legend><div className="sale-choice-list">{colors.map((value) => <button key={value} type="button" className="sale-choice" aria-pressed={color === value} onClick={() => {
              setColor(value); setVariantId(''); setQuantity('1'); setPrice(''); setFeedback(null)
              const options = variants.filter((item) => (item.color || '') === value)
              if (options.length === 1) chooseVariant(options[0])
            }}>{value || 'Standard'}</button>)}</div></fieldset>
            <fieldset disabled={choicesLocked || color === null} className="sale-choice-group"><legend>2. Choose size</legend>{color === null ? <p className="sale-hint">Select a color to see its sizes.</p> : <div className="sale-choice-list">{variants.filter((item) => (item.color || '') === color).map((item) => {
              const priced = (decimalToMinorUnits(item.sellingPrice) ?? 0n) > 0n
              const left = Math.max(0, item.currentStock - (cart.find((line) => line.variantId === item.id)?.quantity || 0))
              return <button key={item.id} type="button" className="sale-choice sale-size-choice" aria-pressed={variantId === item.id}
                disabled={left <= 0 || (role === 'WAREHOUSE' && !priced)} onClick={() => chooseVariant(item)}>
                <strong>{item.size || 'Standard'}</strong><small>{left <= 0 ? 'Sold out' : role === 'WAREHOUSE' && !priced ? 'No price' : `${left} available`}</small>
                {variants.filter((option) => (option.color || '') === color && option.size === item.size).length > 1 && <small>{item.sku}</small>}
              </button>
            })}</div>}</fieldset>
            {variant && <div className="sale-selected-code"><span>Selected code</span><strong>{variant.sku}</strong><span>{variant.currentStock} in stock{reserved > 0 ? ` · ${reserved} in cart` : ''}</span></div>}
            <div className="sale-purchase-fields"><div><label htmlFor="quick-sale-quantity">3. Quantity</label><div className="sale-quantity-input"><button type="button" aria-label="Decrease quantity" disabled={choicesLocked || !variant || selectedQuantity <= 1} onClick={() => { setQuantity(String(selectedQuantity - 1)); setFeedback(null) }}>−</button><input id="quick-sale-quantity" inputMode="numeric" value={quantity} disabled={choicesLocked || !variant} aria-invalid={Boolean(variant && (selectedQuantity <= 0 || selectedQuantity > available || selectedQuantity > 1_000_000))} onChange={(event) => { if (/^\d{0,7}$/.test(event.target.value)) { setQuantity(event.target.value); setFeedback(null) } }} /><button type="button" aria-label="Increase quantity" disabled={choicesLocked || !variant || selectedQuantity >= Math.min(available, 1_000_000)} onClick={() => { setQuantity(String(selectedQuantity + 1)); setFeedback(null) }}>+</button></div></div>
              <div><label htmlFor={role === 'OWNER' ? 'quick-sale-price' : undefined}>Unit price{currency ? ` (${currency})` : ''}</label>{role === 'OWNER' ? <input id="quick-sale-price" inputMode="decimal" value={price} disabled={choicesLocked || !variant} aria-invalid={Boolean(variant && !validPrice)} onChange={(event) => { if (/^\d{0,16}(?:\.\d{0,2})?$/.test(event.target.value)) { setPrice(event.target.value); setFeedback(null) } }} /> : <strong className="sale-read-price">{variant && validPrice ? formatMoney(unitPrice, currency) : '—'}</strong>}</div>
            </div>
            {variant && available > 0 && (selectedQuantity <= 0 || selectedQuantity > Math.min(available, 1_000_000)) && <p className="error-message">Choose 1–{Math.min(available, 1_000_000)} pieces.</p>}
            {variant && !validPrice && <p className="sale-hint">{role === 'OWNER' ? 'Enter a price greater than zero to sell this item.' : 'This option needs an owner-set price.'}</p>}
          </>}
          {!currency && <p className="error-message" role="alert">Account currency is unavailable. Sale is disabled.</p>}
          {!product.isActive && <p className="error-message" role="alert">This product is no longer available to sell.</p>}
          {reserved > 0 && role === 'OWNER' && <p className="sale-hint">This option is already in your cart. Its selected unit price applies to the combined quantity.</p>}
          {refreshing && !retryPending && <p role="status" className="sale-hint">Refreshing stock and prices…</p>}
          {feedback && <p className="error-message sale-option-notice" role="alert">{feedback}</p>}
          {retryPending && <p className="sale-hint">Retry the same sale to confirm its result. Your selection is kept unchanged to prevent a duplicate sale.</p>}
        </div></div>
      <footer className="sale-dialog-footer"><div className="sale-quick-total" role="status" aria-live="polite" aria-atomic="true"><span>{variant ? `${quantity || '0'} piece${selectedQuantity === 1 ? '' : 's'}` : 'Select an option'}<small>Total</small></span><strong>{variant && preview.valid && validPrice ? formatMoney(preview.total, currency) : '—'}</strong></div>
        <div className="sale-quick-actions">{cart.length === 0 || retryPending ? <><button type="submit" disabled={busy || (!retryPending && (refreshing || !valid))}>{busy ? 'Confirming sale…' : retryPending ? 'Retry same sale' : 'Sell now'}</button><button type="button" className="secondary-action sale-add-cart" disabled={choicesLocked || !valid} onClick={add}>Add to cart</button></> : <><p className="sale-hint">Add this item to your current sale.</p><button type="button" disabled={choicesLocked || !valid} onClick={add}>Add to cart</button></>}</div>
      </footer>
    </form>
  </SaleDialog>
}
