export const UNCATEGORIZED_ID = 'uncategorized'

export const discountOptions = Object.freeze([0, 5, 10, 20])

export function money(cents, currency = 'USD') {
  if (!Number.isSafeInteger(cents)) return 'Price missing'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

export function variantKey(productId, colorId, size, variantId = '') {
  return variantId || `${productId}::${colorId}::${size}`
}

export function productStock(product) {
  return product.colors.reduce((total, color) => total + color.sizes.reduce((sum, size) => sum + size.stock, 0), 0)
}

export function cartUnits(cart) {
  return cart.reduce((total, line) => total + line.quantity, 0)
}

export function reservedUnits(cart, productId, colorId, size, variantId = '') {
  return cart.find(line => line.key === variantKey(productId, colorId, size, variantId))?.quantity ?? 0
}

export function cartTotals(cart, discountPercent = 0) {
  const subtotalCents = cart.reduce((total, line) => total + line.priceCents * line.quantity, 0)
  const discountCents = Math.round(subtotalCents * discountPercent / 100)
  return Object.freeze({ subtotalCents, discountCents, totalCents: subtotalCents - discountCents })
}

export function addCartSelection(cart, product, color, size, quantity) {
  const key = variantKey(product.id, color.id, size.name, size.variantId)
  const current = cart.find(line => line.key === key)
  const nextQuantity = (current?.quantity ?? 0) + quantity
  if (!Number.isInteger(quantity) || quantity < 1 || nextQuantity > size.stock) {
    return { ok: false, message: `Only ${Math.max(0, size.stock - (current?.quantity ?? 0))} more are available. Reduce the quantity and try again.` }
  }
  const priceCents = Number.isSafeInteger(size.priceCents) ? size.priceCents : product.priceCents
  if (!Number.isSafeInteger(priceCents)) return { ok: false, message: 'This option has no selling price. Ask an owner to set one before adding it.' }
  const line = { key, variantId: size.variantId || null, productId: product.id, productName: product.name, colorId: color.id, colorName: color.name,
    size: size.name, sku: size.sku || product.sku, priceCents, quantity, stock: size.stock }
  return { ok: true, cart: current
    ? cart.map(row => row.key === key ? { ...row, quantity: nextQuantity } : row)
    : [...cart, line] }
}

export function setMockCartQuantity(cart, key, quantity) {
  const line = cart.find(row => row.key === key)
  if (!line) return cart
  if (quantity < 1) return cart.filter(row => row.key !== key)
  if (quantity > line.stock) return cart
  return cart.map(row => row.key === key ? { ...row, quantity } : row)
}

// A restored cart can be older than the catalog: refresh each line from the live catalog and drop what can no longer be sold.
export function reconcileMockCart(cart, products) {
  const variants = new Map()
  for (const product of products) {
    for (const color of product.colors) {
      for (const size of color.sizes) variants.set(size.variantId, { product, color, size })
    }
  }
  let changed = false
  const next = []
  for (const line of cart) {
    const found = variants.get(line.variantId)
    const priceCents = found && (Number.isSafeInteger(found.size.priceCents) ? found.size.priceCents : found.product.priceCents)
    if (!found || !Number.isSafeInteger(priceCents) || found.size.stock < 1) { changed = true; continue }
    const quantity = Math.min(line.quantity, found.size.stock)
    const row = { ...line, productName: found.product.name, colorName: found.color.name, size: found.size.name,
      sku: found.size.sku || found.product.sku, priceCents, quantity, stock: found.size.stock }
    if (row.quantity !== line.quantity || row.priceCents !== line.priceCents || row.stock !== line.stock) changed = true
    next.push(row)
  }
  return Object.freeze({ cart: next, changed })
}

// Restores a removed line at its old position unless it was added back in the meantime.
export function restoreMockCartLine(cart, line, index) {
  if (cart.some(row => row.key === line.key)) return cart
  const next = [...cart]
  next.splice(Math.min(index, next.length), 0, line)
  return next
}

export function deleteMockCategory(state, categoryId) {
  return { ...state,
    categories: state.categories.filter(category => category.id !== categoryId),
    products: state.products.map(product => product.categoryId === categoryId
      ? { ...product, categoryId: UNCATEGORIZED_ID } : product),
  }
}

export function completeMockSale(state, cart, discountPercent, paymentMethod, now = new Date()) {
  if (!cart.length) return { ok: false, message: 'The cart is empty. Add a product before completing the sale.' }
  for (const line of cart) {
    const product = state.products.find(row => row.id === line.productId)
    const color = product?.colors.find(row => row.id === line.colorId)
    const size = color?.sizes.find(row => line.variantId ? row.variantId === line.variantId : row.name === line.size)
    if (!size || size.stock < line.quantity) return { ok: false,
      message: `${line.productName} no longer has enough stock. Reduce its quantity and try again.` }
  }
  const products = state.products.map(product => ({ ...product, colors: product.colors.map(color => ({ ...color,
    sizes: color.sizes.map(size => {
      const line = cart.find(row => row.productId === product.id && row.colorId === color.id &&
        (row.variantId ? row.variantId === size.variantId : row.size === size.name))
      return line ? { ...size, stock: size.stock - line.quantity } : size
    }),
  })) }))
  const totals = cartTotals(cart, discountPercent)
  const receipt = { id: `receipt-${now.getTime()}`, number: String(state.receipts.length + 1).padStart(4, '0'),
    itemCount: cartUnits(cart), paymentMethod, createdAt: now.toISOString(), ...totals }
  return { ok: true, state: { ...state, products, receipts: [receipt, ...state.receipts] }, receipt }
}
