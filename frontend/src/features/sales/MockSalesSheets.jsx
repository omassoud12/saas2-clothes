import { useState } from 'react'
import { formatMoneyCompact, minorUnitsToDecimal } from '../../lib/money.js'
import { cartTotals, lineUnitCents, money, plural, reservedUnits } from './mock-sales-model.js'
import { lineIssueText, receiptLabel } from './pos-checkout.js'
import { PAYMENT_METHODS, validatePayment } from './payment.js'
import { calculateChange, parseLbpAmount, parseUsdAmount, usdCentsToLbp } from '../../lib/currency.js'
import { MockSalesSheet } from './MockSalesSheet.jsx'
import { useI18n } from '../../i18n/I18nContext.js'

function Stepper({ value, min = 1, max, onChange, label, disabled = false }) {
  const { t } = useI18n()
  return <div className="mock-pos-stepper" aria-label={t(label)}>
    <button type="button" aria-label={t('Decrease {label}', { label })} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>−</button>
    <output>{value}</output>
    <button type="button" aria-label={t('Increase {label}', { label })} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</button>
  </div>
}

function pickerPrice(product, currency) {
  if (!Number.isSafeInteger(product.priceCents)) return 'Price missing'
  return product.priceMaxCents !== product.priceCents
    ? `${money(product.priceCents, currency)}–${money(product.priceMaxCents, currency)}`
    : money(product.priceCents, currency)
}

export function ProductPickerSheet({ product, cart, currency = 'USD', onClose, onAdd }) {
  const { t } = useI18n()
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
    if (!size) { setError(t('Choose a size before adding this product.')); return }
    if (!Number.isSafeInteger(size.priceCents)) { setError(t('This option has no selling price. Ask an owner to set one and try again.')); return }
    const result = onAdd(product, color, size, quantity)
    if (!result.ok) { setError(result.message); return }
    onClose()
  }

  const selectedTotal = Number.isSafeInteger(size?.priceCents) ? money(size.priceCents * quantity, currency) : 'Price missing'
  return <MockSalesSheet title={product.name} subtitle={pickerPrice(product, currency)} onClose={onClose}
    footer={<button type="button" className="mock-pos-primary" disabled={!size || available < 1 || !Number.isSafeInteger(size.priceCents)} onClick={add}>
      {size ? t('Add to cart · {selectedTotal}', { selectedTotal }) : t('Add to cart · {pickerPrice}', { pickerPrice: pickerPrice(product, currency) })}
    </button>}>
    {!product.colors.length && <div className="mock-pos-empty"><strong>{t('No sellable options')}</strong><p>{t('Add an active product variant before selling this product.')}</p></div>}
    {product.colors.length > 0 && <><fieldset className="mock-pos-fieldset"><legend>{t('Color')}</legend><div className="mock-pos-swatches">
      {product.colors.map(item => <button key={item.id} type="button" className="mock-pos-swatch" aria-pressed={item.id === color.id}
        aria-label={item.name} title={item.name} onClick={() => selectColor(item.id)}>
        <span style={{ '--swatch': item.hex }} /><small>{item.name}</small>
      </button>)}
    </div></fieldset>
    <fieldset className="mock-pos-fieldset"><legend>{t('Size')}</legend><div className="mock-pos-sizes">
      {color.sizes.map(item => {
        const left = Math.max(0, item.stock - reservedUnits(cart, product.id, color.id, item.name, item.variantId))
        const unavailable = left === 0 || !Number.isSafeInteger(item.priceCents)
        return <button key={item.variantId} type="button" aria-pressed={item.variantId === variantId} disabled={unavailable}
          className={left === 0 ? 'is-empty' : ''} onClick={() => { setVariantId(item.variantId); setQuantity(1); setError('') }}>
          {item.name}{left === 0 ? <small>{t('Sold out')}</small> : !Number.isSafeInteger(item.priceCents) ? <small>{t('No price')}</small>
          : <><small>{t('{left} left', { left })}</small><small>{money(item.priceCents, currency)}</small></>}
        </button>
      })}
    </div></fieldset>
    <div className="mock-pos-quantity-row"><div><strong>{t('Quantity')}</strong><small>{size ? t('{available} available', { available }) : t('Choose a size')}</small></div>
      <Stepper value={quantity} max={Math.max(1, available)} onChange={setQuantity} label={t('{name} quantity', { name: product.name })} />
    </div></>}
    {error && <p className="mock-pos-error" role="alert">{error}</p>}
  </MockSalesSheet>
}

const plainPrice = cents => minorUnitsToDecimal(BigInt(cents)).replace(/\.00$/, '')

// The owner's final price for one piece. Empty means the catalog price; anything else must be a price above zero.
function LinePrice({ line, currency, disabled, onPrice, onInvalid }) {
  const { t } = useI18n()
  const [text, setText] = useState(() => Number.isSafeInteger(line.finalPriceCents) ? plainPrice(line.finalPriceCents) : '')
  const parsed = parseUsdAmount(text)
  const invalid = parsed === null || (text.trim() !== '' && parsed <= 0)
  function change(value) {
    setText(value)
    const cents = parseUsdAmount(value)
    const bad = cents === null || (value.trim() !== '' && cents <= 0)
    onInvalid(line.key, bad)
    if (!bad) onPrice(line.key, value.trim() === '' ? null : cents)
  }
  return <div className="mock-pos-line-price">
    <label htmlFor={`price-${line.key}`}>{t('Final price each ({currency})', { currency })}</label>
    <input id={`price-${line.key}`} inputMode="decimal" autoComplete="off" placeholder={plainPrice(line.priceCents)} value={text} disabled={disabled} aria-invalid={invalid}
      onChange={event => change(event.target.value)} />
    {invalid ? <small className="is-error" role="alert">{t('Enter a price greater than zero.')}</small>
      : <small>{Number.isSafeInteger(line.finalPriceCents) ? t('Catalog price {price}', { price: money(line.priceCents, currency) }) : t('Leave empty for the catalog price.')}</small>}
  </div>
}

function formatLbp(value) { return formatMoneyCompact(String(value), 'LBP', 0) }

// What the customer hands over, in dollars and/or pounds, against the total: shows what is still due or the change to give back.
function CashCalculator({ totalCents, currency, rate, disabled }) {
  const { t } = useI18n()
  const [usd, setUsd] = useState('')
  const [lbp, setLbp] = useState('')
  const usdCents = parseUsdAmount(usd)
  const lbpAmount = parseLbpAmount(lbp)
  const invalid = usdCents === null || lbpAmount === null
  const result = invalid ? null : calculateChange({ totalCents, rate, receivedUsdCents: usdCents, receivedLbp: lbpAmount })
  const diff = result?.difference
  const both = diff ? (diff.lbp !== null ? `${formatLbp(diff.lbp)} (≈ ${money(diff.usdCents, currency)})` : money(diff.usdCents, currency)) : ''
  return <div className="mock-pos-cash">
    <div className="mock-pos-cash-fields">
      <label htmlFor="pos-received-usd">{t('Received ({currency})', { currency })}</label>
      <input id="pos-received-usd" inputMode="decimal" autoComplete="off" placeholder="0" value={usd} disabled={disabled} aria-invalid={usdCents === null}
        onChange={event => setUsd(event.target.value)} />
      {rate && <>
        <label htmlFor="pos-received-lbp">{t('Received (LBP)')}</label>
        <input id="pos-received-lbp" inputMode="numeric" autoComplete="off" placeholder="0" value={lbp} disabled={disabled} aria-invalid={lbpAmount === null}
          onChange={event => setLbp(event.target.value)} />
      </>}
    </div>
    {invalid && <p className="mock-pos-error" role="alert">{t('Enter the amounts as numbers.')}</p>}
    {result?.status === 'short' && <p className="mock-pos-cash-result is-short" role="status">{t('Still due: {both}', { both })}</p>}
    {result?.status === 'exact' && <p className="mock-pos-cash-result is-exact" role="status">{t('Exact amount. No change.')}</p>}
    {result?.status === 'change' && <p className="mock-pos-cash-result is-change" role="status">{t('Change to give back: {both}', { both })}</p>}
  </div>
}

export function CartSheet({ cart, currency = 'USD', discount, canDiscount, onPrice = () => {}, payment, onPayment, rate = null, busy = false, locked = false, message = '', issues = [], blocked = false,
  onQuantity, onRemove, onClear, onComplete, onDiscard, onHistory, onClose }) {
  const { t } = useI18n()
  const totals = cartTotals(cart, discount)
  const lbpTotal = rate && currency === 'USD' ? usdCentsToLbp(totals.totalCents, rate) : null
  const paymentCheck = validatePayment(payment)
  const [nameTouched, setNameTouched] = useState(false)
  const [badPrices, setBadPrices] = useState(() => new Set())
  const priceBlocked = cart.some(line => badPrices.has(line.key))
  function markPrice(key, bad) { setBadPrices(current => { const next = new Set(current); if (bad) next.add(key); else next.delete(key); return next }) }
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const frozen = busy || locked
  const issueByKey = new Map(issues.map(issue => [issue.key, issue]))
  return <MockSalesSheet title={t('Cart')} subtitle={plural(cart.reduce((sum, line) => sum + line.quantity, 0), 'item', t)} onClose={onClose}
    className="mock-pos-cart-sheet" footer={<>
      {cart.length > 0 && <dl className="mock-pos-totals">
        {totals.discountCents > 0 && <>
          <div><dt>{t('Subtotal')}</dt><dd>{money(totals.subtotalCents, currency)}</dd></div>
          <div><dt>{discount > 0 ? t('Discount ({discount}%)', { discount }) : t('Discount')}</dt><dd>−{money(totals.discountCents, currency)}</dd></div>
        </>}
        <div className="is-total"><dt>{t('Total')}</dt><dd>{money(totals.totalCents, currency)}</dd></div>
        {lbpTotal !== null && <div className="is-lbp"><dt>{t('Total (LBP)')}</dt><dd>{formatLbp(lbpTotal)}</dd></div>}
      </dl>}
      <button type="button" className="mock-pos-primary" aria-busy={busy}
        disabled={!cart.length || busy || (!locked && (blocked || !paymentCheck.ok || priceBlocked))} onClick={onComplete}>
        {busy ? <><span className="mock-pos-spinner is-inline" aria-hidden="true" />{t('Completing sale…')}</>
          : locked ? t('Try again') : cart.length ? t('Complete sale · {money}', { money: money(totals.totalCents, currency) }) : t('Complete sale')}
      </button>
    </>}>
    {message && <p className={`mock-pos-checkout-message${locked ? ' is-pending' : ''}`} role="alert">{t(message)}</p>}
    {locked && !busy && <div className="mock-pos-checkout-actions">
      <button type="button" onClick={onHistory}>{t('Check sales history')}</button>
      {!confirmingDiscard && <button type="button" className="is-danger" onClick={() => setConfirmingDiscard(true)}>{t('Cancel this sale')}</button>}
    </div>}
    {locked && confirmingDiscard && <div className="mock-pos-delete-confirm" role="alert">
      <p>{t('Only cancel if Sales history does not show this sale. If it went through, selling again would charge the customer twice.')}</p>
      <div><button type="button" className="is-danger" onClick={() => { setConfirmingDiscard(false); onDiscard() }}>{t('Cancel this sale')}</button>
        <button type="button" onClick={() => setConfirmingDiscard(false)}>{t('Keep it')}</button></div>
    </div>}
    {!cart.length ? <div className="mock-pos-empty"><strong>{t('Your cart is empty')}</strong><p>{t('Add a product to start a sale.')}</p></div>
      : <div className="mock-pos-cart-lines">{cart.map(line => {
        const issue = issueByKey.get(line.key)
        return <article key={line.key} className="mock-pos-cart-line">
          <div><strong>{line.productName}</strong><span>{line.colorName} · {line.size} · {money(lineUnitCents(line, discount), currency)}</span></div>
          <Stepper value={line.quantity} max={line.stock} disabled={frozen} onChange={value => onQuantity(line.key, value)} label={t('{productName} quantity', { productName: line.productName })} />
          {canDiscount && <LinePrice line={line} currency={currency} disabled={frozen} onPrice={onPrice} onInvalid={markPrice} />}
          {issue && <p className="mock-pos-line-issue" role="alert">{lineIssueText(issue, currency)}</p>}
          <button type="button" className="mock-pos-remove" disabled={frozen} onClick={() => onRemove(line.key)}>{t('Remove')}</button>
        </article>
      })}</div>}
    {cart.length > 0 && <section className="mock-pos-choice-section"><h3>{t('Payment')}</h3>
      <div className="mock-pos-segmented" role="group" aria-label={t('Payment method')}>
        {PAYMENT_METHODS.map(item => <button key={item.id} type="button" aria-pressed={payment.method === item.id} disabled={frozen}
          onClick={() => onPayment({ ...payment, method: item.id })}>{t(item.label)}</button>)}
      </div>
      {payment.method === 'DEBT' && <div className="mock-pos-payment-fields">
        <label htmlFor="pos-customer-name">{t('Customer name')}</label>
        <input id="pos-customer-name" autoComplete="off" maxLength={120} value={payment.customerName} disabled={frozen}
          aria-invalid={nameTouched && paymentCheck.field === 'customerName'} aria-describedby="pos-customer-hint"
          onBlur={() => setNameTouched(true)} onChange={event => onPayment({ ...payment, customerName: event.target.value })} />
        <label htmlFor="pos-customer-phone">{t('Phone (optional)')}</label>
        <input id="pos-customer-phone" type="tel" inputMode="tel" autoComplete="off" maxLength={30} value={payment.customerPhone} disabled={frozen}
          aria-invalid={paymentCheck.field === 'customerPhone'} onChange={event => onPayment({ ...payment, customerPhone: event.target.value })} />
        <p id="pos-customer-hint" className={`mock-pos-note${!paymentCheck.ok && (nameTouched || paymentCheck.field === 'customerPhone') ? ' is-error' : ''}`}
          role={!paymentCheck.ok && nameTouched ? 'alert' : undefined}>
          {!paymentCheck.ok && (nameTouched || paymentCheck.field === 'customerPhone') ? t(paymentCheck.message) : t('The debt stays open until you mark it as paid in Sales history.')}</p>
      </div>}
      {payment.method === 'CASH' && <CashCalculator key={`${totals.totalCents}|${rate}`} totalCents={totals.totalCents} currency={currency} rate={rate} disabled={frozen} />}
    </section>}
    {cart.length > 0 && !frozen && !confirmingClear && <button type="button" className="mock-pos-danger-link" onClick={() => setConfirmingClear(true)}>{t('Clear cart')}</button>}
    {cart.length > 0 && !frozen && confirmingClear && <div className="mock-pos-delete-confirm" role="alert">
      <p>{t('Remove')} {cart.reduce((sum, line) => sum + line.quantity, 0) === 1 ? t('the item') : t('all items')} {t('from the cart?')}</p>
      <div><button type="button" className="is-danger" onClick={onClear}>{t('Clear cart')}</button>
        <button type="button" onClick={() => setConfirmingClear(false)}>{t('Keep cart')}</button></div>
    </div>}
  </MockSalesSheet>
}

export function SalesHistorySheet({ state, role, currency = 'USD', onRetry, onClose }) {
  const { t, locale } = useI18n()
  return <MockSalesSheet title={t('Sales history')} subtitle={t('Today')} onClose={onClose}>
    {state.kind === 'loading' && <div className="mock-pos-empty" role="status"><span className="mock-pos-spinner" /><p>{t('Loading today\'s sales…')}</p></div>}
    {state.kind === 'error' && <div className="mock-pos-empty" role="alert"><strong>{t('Sales could not load')}</strong><p>{t(state.message)}</p>
      <button type="button" onClick={onRetry}>{t('Try again')}</button></div>}
    {state.kind === 'ready' && !state.sales.length && <div className="mock-pos-empty"><strong>{t('No sales yet today')}</strong><p>{t('Completed sales show up here.')}</p></div>}
    {state.kind === 'ready' && state.sales.length > 0 && <div className="mock-pos-receipts">{state.sales.map(sale => <article key={sale.id}>
      <div><strong>{receiptLabel(sale)}</strong><span>{sale.totalUnits} {sale.totalUnits === 1 ? 'item' : 'items'}{sale.status === 'VOIDED' ? t(' · Voided') : ''}</span></div>
      <div>{role === 'OWNER' && <strong>{formatMoneyCompact(sale.totalAmount, sale.currency || currency)}</strong>}
        <time dateTime={sale.createdAt}>{new Date(sale.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time></div>
    </article>)}</div>}
    {state.kind === 'ready' && state.truncated && <p className="mock-pos-note">{t('Showing the latest 500 sales of today.')}</p>}
  </MockSalesSheet>
}
