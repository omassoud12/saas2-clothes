import { useMemo, useState } from 'react'
import { cartTotals, discountOptions, money, reservedUnits } from './mock-sales-model.js'
import { MockSalesSheet } from './MockSalesSheet.jsx'

function Stepper({ value, min = 1, max, onChange, label }) {
  return <div className="mock-pos-stepper" aria-label={label}>
    <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
    <output>{value}</output>
    <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
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
          {item.name}<small>{left === 0 ? 'Sold out' : !Number.isSafeInteger(item.priceCents) ? 'No price' : `${left} left · ${money(item.priceCents, currency)}`}</small>
        </button>
      })}
    </div></fieldset>
    <div className="mock-pos-quantity-row"><div><strong>Quantity</strong><small>{size ? `${available} available` : 'Choose a size'}</small></div>
      <Stepper value={quantity} max={Math.max(1, available)} onChange={setQuantity} label={`${product.name} quantity`} />
    </div></>}
    {error && <p className="mock-pos-error" role="alert">{error}</p>}
  </MockSalesSheet>
}

export function CartSheet({ cart, currency = 'USD', discount, payment, onDiscount, onPayment, onQuantity, onClear, onComplete, onClose }) {
  const totals = cartTotals(cart, discount)
  return <MockSalesSheet title="Cart" subtitle={`${cart.reduce((sum, line) => sum + line.quantity, 0)} items`} onClose={onClose}
    className="mock-pos-cart-sheet" footer={<button type="button" className="mock-pos-primary" disabled={!cart.length} onClick={onComplete}>
      Complete sale · {payment}
    </button>}>
    {!cart.length ? <div className="mock-pos-empty"><strong>Your cart is empty</strong><p>Add a product to start a sale.</p></div>
      : <div className="mock-pos-cart-lines">{cart.map(line => <article key={line.key} className="mock-pos-cart-line">
        <div><strong>{line.productName}</strong><span>{line.colorName} · {line.size} · {money(line.priceCents, currency)}</span></div>
        <Stepper value={line.quantity} max={line.stock} onChange={value => onQuantity(line.key, value)} label={`${line.productName} quantity`} />
        <button type="button" className="mock-pos-remove" onClick={() => onQuantity(line.key, 0)}>Remove</button>
      </article>)}</div>}
    <section className="mock-pos-choice-section"><h3>Discount</h3><div className="mock-pos-segmented">
      {discountOptions.map(value => <button key={value} type="button" aria-pressed={discount === value} onClick={() => onDiscount(value)}>{value ? `${value}%` : 'None'}</button>)}
    </div></section>
    <section className="mock-pos-choice-section"><h3>Payment method</h3><div className="mock-pos-segmented is-two">
      {['Cash', 'Card'].map(value => <button key={value} type="button" aria-pressed={payment === value} onClick={() => onPayment(value)}>{value}</button>)}
    </div></section>
    <dl className="mock-pos-totals"><div><dt>Subtotal</dt><dd>{money(totals.subtotalCents, currency)}</dd></div>
      <div><dt>Discount</dt><dd>−{money(totals.discountCents, currency)}</dd></div><div className="is-total"><dt>Total</dt><dd>{money(totals.totalCents, currency)}</dd></div></dl>
    {cart.length > 0 && <button type="button" className="mock-pos-danger-link" onClick={onClear}>Clear cart</button>}
  </MockSalesSheet>
}

export function SalesHistorySheet({ receipts, currency = 'USD', onClose }) {
  return <MockSalesSheet title="Sales history" subtitle="Today" onClose={onClose}>
    {!receipts.length ? <div className="mock-pos-empty"><strong>No sales yet today</strong><p>Completed sales show up here.</p></div>
      : <div className="mock-pos-receipts">{receipts.map(receipt => <article key={receipt.id}>
        <div><strong>Receipt #{receipt.number}</strong><span>{receipt.itemCount} items · {receipt.paymentMethod}</span></div>
        <div><strong>{money(receipt.totalCents, currency)}</strong><time dateTime={receipt.createdAt}>{new Date(receipt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
      </article>)}</div>}
  </MockSalesSheet>
}

export function CategoryManagerSheet({ categories, products, onAdd, onRename, onDelete, onClose }) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState(null)
  const [editName, setEditName] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const count = id => products.filter(product => product.categoryId === id).length

  function validate(name, currentId = null) {
    const clean = name.trim()
    if (!clean) return 'Enter a category name.'
    if (categories.some(category => category.id !== currentId && category.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
      return 'That category already exists. Choose another name.'
    }
    return ''
  }

  async function add() {
    const issue = validate(newName)
    if (issue) { setError(issue); return }
    setPending(true); setError('')
    const result = await onAdd(newName.trim())
    setPending(false)
    if (!result?.ok) { setError(result?.message || 'The category could not be added. Try again.'); return }
    setNewName('')
  }

  async function rename(id) {
    const issue = validate(editName, id)
    if (issue) { setError(issue); return }
    setPending(true); setError('')
    const result = await onRename(id, editName.trim())
    setPending(false)
    if (!result?.ok) { setError(result?.message || 'The category could not be renamed. Try again.'); return }
    setEditing(null)
  }

  async function remove(id) {
    setPending(true); setError('')
    const result = await onDelete(id)
    setPending(false)
    if (!result?.ok) { setError(result?.message || 'This category could not be deleted. Reassign its products and try again.'); return }
    setPendingDelete(null)
  }

  return <MockSalesSheet title="Categories" subtitle="Changes are saved to the store catalog" onClose={onClose}>
    <div className="mock-pos-category-list">{categories.map(category => <article key={category.id}>
      {editing === category.id ? <div className="mock-pos-inline-edit"><input aria-label={`Rename ${category.name}`} value={editName} maxLength={100} disabled={pending}
        onChange={event => { setEditName(event.target.value); setError('') }} /><button type="button" disabled={pending} onClick={() => rename(category.id)}>Save</button></div>
        : <div><strong>{category.name}</strong><span>{count(category.id)} products</span></div>}
      <div className="mock-pos-row-actions">
        <button type="button" disabled={pending} aria-label={`Rename ${category.name}`} onClick={() => { setEditing(category.id); setEditName(category.name); setPendingDelete(null); setError('') }}>Rename</button>
        <button type="button" disabled={pending} className="is-danger" aria-label={`Delete ${category.name}`} onClick={() => setPendingDelete(category.id)}>Delete</button>
      </div>
      {pendingDelete === category.id && <div className="mock-pos-delete-confirm" role="alert">
        <p>{count(category.id) ? 'This category has products. The server will require you to reassign them before deletion.' : 'Delete this empty category?'}</p>
        <div><button type="button" disabled={pending || count(category.id) > 0} className="is-danger" onClick={() => remove(category.id)}>Delete category</button>
          <button type="button" disabled={pending} onClick={() => setPendingDelete(null)}>Keep category</button></div>
      </div>}
    </article>)}</div>
    <form className="mock-pos-add-category" onSubmit={event => { event.preventDefault(); void add() }}>
      <label htmlFor="mock-new-category">Add category</label><div><input id="mock-new-category" value={newName} maxLength={100} disabled={pending} placeholder="Dresses, shoes, accessories…"
        onChange={event => { setNewName(event.target.value); setError('') }} /><button type="submit" disabled={pending}>Add</button></div>
    </form>
    {error && <p className="mock-pos-error" role="alert">{error}</p>}
  </MockSalesSheet>
}

export function ProductCategorySheet({ product, categories, onChange, onClose }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const choices = useMemo(() => categories, [categories])

  async function change(categoryId) {
    setPending(true); setError('')
    const result = await onChange(product.id, categoryId)
    setPending(false)
    if (!result?.ok) { setError(result?.message || 'The product category could not be changed. Try again.'); return }
    onClose()
  }

  return <MockSalesSheet title="Change category" subtitle={product.name} onClose={onClose}>
    <div className="mock-pos-category-picker">{choices.map(category => <button key={category.id} type="button" disabled={pending}
      aria-pressed={product.categoryId === category.id} onClick={() => void change(category.id)}>
      <span>{category.name}</span>{product.categoryId === category.id && <span aria-hidden="true">✓</span>}
    </button>)}</div>
    {error && <p className="mock-pos-error" role="alert">{error}</p>}
  </MockSalesSheet>
}
