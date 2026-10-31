import { formatMoneyCompact, minorUnitsToDecimal } from '../../lib/money.js'
import { plainTranslate } from '../../lib/interpolate.js'

export const UNCATEGORIZED_ID = 'uncategorized'

export const discountOptions = Object.freeze([0, 5, 10, 20])

// Compact point-of-sale format from lib/money.js, e.g. "$12" or "$12.50".
export function money(cents, currency = 'USD') {
  if (!Number.isSafeInteger(cents) || cents < 0) return 'Price missing'
  return formatMoneyCompact(minorUnitsToDecimal(BigInt(cents)), currency)
}

const LOW_STOCK_LIMIT = 5

// What the product list shows for the stock that can still be sold: normal, low (warning) or out (red).
export function stockBadge(available, translate = plainTranslate) {
  if (available <= 0) return Object.freeze({ tone: 'is-out', text: translate('Out of stock') })
  if (available <= LOW_STOCK_LIMIT) return Object.freeze({ tone: 'is-low', text: translate('Low · {count} left', { count: available }) })
  return Object.freeze({ tone: 'is-ok', text: translate('{count} in stock', { count: available }) })
}

// "1 color", "2 colors" (regular nouns only).
// "1 item" / "3 items". With a translate function the phrase is looked up as "{count} item" / "{count} items".
export function plural(count, noun, translate = null) {
  const phrase = `{count} ${noun}${count === 1 ? '' : 's'}`
  return translate ? translate(phrase, { count }) : phrase.replace('{count}', String(count))
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

// The discount is applied to each unit price (rounded half up to the cent) because that is the price the Sale records.
export function discountedUnitCents(unitCents, discountPercent = 0) {
  return Math.floor((unitCents * (100 - discountPercent) + 50) / 100)
}

export function cartTotals(cart, discountPercent = 0) {
  const subtotalCents = cart.reduce((total, line) => total + line.priceCents * line.quantity, 0)
  const totalCents = cart.reduce((total, line) => total + discountedUnitCents(line.priceCents, discountPercent) * line.quantity, 0)
  return Object.freeze({ subtotalCents, discountCents: subtotalCents - totalCents, totalCents })
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

// Applies a confirmed sale to the loaded catalog right away; a fresh product fetch then confirms the real stock.
export function decrementCatalogStock(products, lines) {
  const sold = new Map(lines.map(line => [line.variantId, line.quantity]))
  return products.map(product => ({ ...product, colors: product.colors.map(color => ({ ...color,
    sizes: color.sizes.map(size => sold.has(size.variantId) ? { ...size, stock: Math.max(0, size.stock - sold.get(size.variantId)) } : size),
  })) }))
}
