import { useState } from 'react'
import { formatMoneyCompact } from '../../lib/money.js'
import { cartTotals, discountOptions, money, plural, reservedUnits } from './mock-sales-model.js'
import { lineIssueText, receiptNumber } from './pos-checkout.js'
import { MockSalesSheet } from './MockSalesSheet.jsx'

function Stepper({ value, min = 1, max, onChange, label, disabled = false }) {
  return <div className="mock-pos-stepper" aria-label={label}>
    <button type="button" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>−</button>
    <output>{value}</output>
    <button type="button" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</button>
  </div>
}

function pickerPrice(product, currency) {
  if (!Number.isSafeInteger(product.priceCents)) return 'Price missing'
  return product.priceMaxCents !== product.priceCents
    ? `${money(product.priceCents, currency)}–${money(product.priceMaxCents, currency)}`
    : money(product.priceCents, currency)
}

export function ProductPickerSheet({ product, cart, currency = 'USD', onClose, onAdd }) {
  const [colorId, setColorId] = useState(product.colors[0]?.id ?? '')
  const color = product.colors.find(row => row.id === colorId) ?? product.colors[0]
  const initialSize = color?.sizes.length === 1 ? color.sizes[0].variantId : ''
  const [variantId, setVariantId] = useState(initialSize)
  const [quantity, setQuantity] = useState(1)
  const [error, setError] = useState('')
  const size = color?.sizes.find(row => row.variantId === variantId)
  const available = size ? Math.max(0, size.stock - reservedUnits(cart, product.id, color.id, size.name, size.variantId)) : 0

  function selectColor(next) {
    const choice = product.colors.find(row => row.id === next)
    setColorId(next); setVariantId(choice?.sizes.length === 1 ? choice.sizes[0].variantId : ''); setQuantity(1); setError('')
  }

  function add() {
    if (!size) { setError('Choose a size before adding this product.'); return }
    if (!Number.isSafeInteger(size.priceCents)) { setError('This option has no selling price. Ask an owner to set one and try again.'); return }
    const result = onAdd(product, color, size, quantity)
    if (!result.ok) { setError(result.message); return }
    onClose()
  }

  const selectedTotal = Number.isSafeInteger(size?.priceCents) ? money(size.priceCents * quantity, currency) : 'Price missing'
  return <MockSalesSheet title={product.name} subtitle={pickerPrice(product, currency)} onClose={onClose}
    footer={<button type="button" className="mock-pos-primary" disabled={!size || available < 1 || !Number.isSafeInteger(size.priceCents)} onClick={add}>
      {size ? `Add to cart · ${selectedTotal}` : `Add to cart · ${pickerPrice(product, currency)}`}
    </button>}>
    {!product.colors.length && <div className="mock-pos-empty"><strong>No sellable options</strong><p>Add an active product variant before selling this product.</p></div>}
    {product.colors.length > 0 && <><fieldset className="mock-pos-fieldset"><legend>Color</legend><div className="mock-pos-swatches">
      {product.colors.map(item => <button key={item.id} type="button" className="mock-pos-swatch" aria-pressed={item.id === color.id}
        aria-label={item.name} title={item.name} onClick={() => selectColor(item.id)}>
        <span style={{ '--swatch': item.hex }} /><small>{item.name}</small>
      </button>)}
    </div></fieldset>
    <fieldset className="mock-pos-fieldset"><legend>Size</legend><div className="mock-pos-sizes">
      {color.sizes.map(item => {
        const left = Math.max(0, item.stock - reservedUnits(cart, product.id, color.id, item.name, item.variantId))
        const unavailable = left === 0 || !Number.isSafeInteger(item.priceCents)
        return <button key={item.variantId} type="button" aria-pressed={item.variantId === variantId} disabled={unavailable}
          className={left === 0 ? 'is-empty' : ''} onClick={() => { setVariantId(item.variantId); setQuantity(1); setError('') }}>
          {item.name}{left === 0 ? <small>Sold out</small> : !Number.isSafeInteger(item.priceCents) ? <small>No price</small>
          : <><small>{left} left</small><small>{money(item.priceCents, currency)}</small></>}
        </button>
      })}
    </div></fieldset>
    <div className="mock-pos-quantity-row"><div><strong>Quantity</strong><small>{size ? `${available} available` : 'Choose a size'}</small></div>
      <Stepper value={quantity} max={Math.max(1, available)} onChange={setQuantity} label={`${product.name} quantity`} />
    </div></>}
    {error && <p className="mock-pos-error" role="alert">{error}</p>}
  </MockSalesSheet>
}

export function CartSheet({ cart, currency = 'USD', discount, canDiscount, onDiscount, busy = false, locked = false, message = '', issues = [], blocked = false,
  onQuantity, onRemove, onClear, onComplete, onDiscard, onHistory, onClose }) {
  const totals = cartTotals(cart, discount)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const frozen = busy || locked
  const issueByKey = new Map(issues.map(issue => [issue.key, issue]))
  return <MockSalesSheet title="Cart" subtitle={plural(cart.reduce((sum, line) => sum + line.quantity, 0), 'item')} onClose={onClose}
    className="mock-pos-cart-sheet" footer={<>
      {cart.length > 0 && <dl className="mock-pos-totals">
        {discount > 0 && totals.discountCents > 0 && <>
          <div><dt>Subtotal</dt><dd>{money(totals.subtotalCents, currency)}</dd></div>
          <div><dt>Discount ({discount}%)</dt><dd>−{money(totals.discountCents, currency)}</dd></div>
        </>}
        <div className="is-total"><dt>Total</dt><dd>{money(totals.totalCents, currency)}</dd></div>
      </dl>}
      <button type="button" className="mock-pos-primary" aria-busy={busy}
        disabled={!cart.length || busy || (!locked && blocked)} onClick={onComplete}>
        {busy ? <><span className="mock-pos-spinner is-inline" aria-hidden="true" />Completing sale…</>
          : locked ? 'Try again' : cart.length ? `Complete sale · ${money(totals.totalCents, currency)}` : 'Complete sale'}
      </button>
    </>}>
    {message && <p className={`mock-pos-checkout-message${locked ? ' is-pending' : ''}`} role="alert">{message}</p>}
    {locked && !busy && <div className="mock-pos-checkout-actions">
      <button type="button" onClick={onHistory}>Check sales history</button>
      {!confirmingDiscard && <button type="button" className="is-danger" onClick={() => setConfirmingDiscard(true)}>Cancel this sale</button>}
    </div>}
    {locked && confirmingDiscard && <div className="mock-pos-delete-confirm" role="alert">
      <p>Only cancel if Sales history does not show this sale. If it went through, selling again would charge the customer twice.</p>
      <div><button type="button" className="is-danger" onClick={() => { setConfirmingDiscard(false); onDiscard() }}>Cancel this sale</button>
        <button type="button" onClick={() => setConfirmingDiscard(false)}>Keep it</button></div>
    </div>}
    {!cart.length ? <div className="mock-pos-empty"><strong>Your cart is empty</strong><p>Add a product to start a sale.</p></div>
      : <div className="mock-pos-cart-lines">{cart.map(line => {
        const issue = issueByKey.get(line.key)
        return <article key={line.key} className="mock-pos-cart-line">
          <div><strong>{line.productName}</strong><span>{line.colorName} · {line.size} · {money(line.priceCents, currency)}</span></div>
          <Stepper value={line.quantity} max={line.stock} disabled={frozen} onChange={value => onQuantity(line.key, value)} label={`${line.productName} quantity`} />
          {issue && <p className="mock-pos-line-issue" role="alert">{lineIssueText(issue, currency)}</p>}
          <button type="button" className="mock-pos-remove" disabled={frozen} onClick={() => onRemove(line.key)}>Remove</button>
        </article>
      })}</div>}
    {canDiscount && <section className="mock-pos-choice-section"><h3>Discount</h3><div className="mock-pos-segmented">
      {discountOptions.map(value => <button key={value} type="button" aria-pressed={discount === value} disabled={frozen} onClick={() => onDiscount(value)}>{value ? `${value}%` : 'None'}</button>)}
    </div></section>}
    {cart.length > 0 && !frozen && !confirmingClear && <button type="button" className="mock-pos-danger-link" onClick={() => setConfirmingClear(true)}>Clear cart</button>}
    {cart.length > 0 && !frozen && confirmingClear && <div className="mock-pos-delete-confirm" role="alert">
      <p>Remove {cart.reduce((sum, line) => sum + line.quantity, 0) === 1 ? 'the item' : 'all items'} from the cart?</p>
      <div><button type="button" className="is-danger" onClick={onClear}>Clear cart</button>
        <button type="button" onClick={() => setConfirmingClear(false)}>Keep cart</button></div>
    </div>}
  </MockSalesSheet>
}

export function SalesHistorySheet({ state, role, currency = 'USD', onRetry, onClose }) {
  return <MockSalesSheet title="Sales history" subtitle="Today" onClose={onClose}>
    {state.kind === 'loading' && <div className="mock-pos-empty" role="status"><span className="mock-pos-spinner" /><p>Loading today's sales…</p></div>}
    {state.kind === 'error' && <div className="mock-pos-empty" role="alert"><strong>Sales could not load</strong><p>{state.message}</p>
      <button type="button" onClick={onRetry}>Try again</button></div>}
    {state.kind === 'ready' && !state.sales.length && <div className="mock-pos-empty"><strong>No sales yet today</strong><p>Completed sales show up here.</p></div>}
    {state.kind === 'ready' && state.sales.length > 0 && <div className="mock-pos-receipts">{state.sales.map(sale => <article key={sale.id}>
      <div><strong>{receiptNumber(sale.id)}</strong><span>{sale.totalUnits} {sale.totalUnits === 1 ? 'item' : 'items'}{sale.status === 'VOIDED' ? ' · Voided' : ''}</span></div>
      <div>{role === 'OWNER' && <strong>{formatMoneyCompact(sale.totalAmount, sale.currency || currency)}</strong>}
        <time dateTime={sale.createdAt}>{new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
    </article>)}</div>}
    {state.kind === 'ready' && state.truncated && <p className="mock-pos-note">Showing the latest 500 sales of today.</p>}
  </MockSalesSheet>
}
