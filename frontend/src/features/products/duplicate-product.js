// "Duplicate product": the new product starts from an existing one (category, price, colors and sizes) and only needs a name.
// The copy is handed to the New product page through sessionStorage and used once.

const STORAGE_KEY = 'saas2.duplicate-product'

function newSku() { return `ITEM-${globalThis.crypto.randomUUID()}` }

// The most common selling price among the active variants ('' when none is priced).
function commonPrice(variants) {
  const counts = new Map()
  for (const variant of variants) {
    if (typeof variant.sellingPrice === 'string' && variant.sellingPrice) counts.set(variant.sellingPrice, (counts.get(variant.sellingPrice) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [price, count] of counts) if (count > bestCount) { best = price; bestCount = count }
  return best
}

export function buildDuplicateDraft(product, { owner = true, uuidFactory = () => globalThis.crypto.randomUUID() } = {}) {
  const active = (product?.variants ?? []).filter((variant) => variant.isActive)
  const colors = []
  for (const variant of active) {
    const name = variant.color || ''
    if (!name) continue
    let entry = colors.find((color) => color.color.toLowerCase() === name.toLowerCase())
    if (!entry) { entry = { id: uuidFactory(), color: name, customSize: '', options: [] }; colors.push(entry) }
    const size = variant.size || ''
    if (size && !entry.options.some((option) => option.size === size)) entry.options.push({ sku: newSku(), barcode: '', size, selected: true })
  }
  return Object.freeze({
    name: '',
    categoryId: product?.category?.id ?? '',
    sellingPrice: owner ? commonPrice(active) : '',
    colors: colors.filter((color) => color.options.length > 0),
  })
}

export function saveDuplicateDraft(storage, product, options) {
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ sourceName: String(product?.name ?? ''), draft: buildDuplicateDraft(product, options) }))
    return true
  } catch { return false }
}

// Reads the copy once; it is removed so a later visit starts with an empty form.
export function takeDuplicateDraft(storage) {
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    storage.removeItem(STORAGE_KEY)
    const saved = JSON.parse(raw)
    const draft = saved?.draft
    if (!draft || typeof draft.name !== 'string' || typeof draft.categoryId !== 'string' || typeof draft.sellingPrice !== 'string' || !Array.isArray(draft.colors)) return null
    const valid = draft.colors.every((color) => typeof color?.id === 'string' && typeof color.color === 'string' && Array.isArray(color.options)
      && color.options.every((option) => typeof option?.sku === 'string' && typeof option.size === 'string' && typeof option.selected === 'boolean'))
    return valid ? Object.freeze({ sourceName: typeof saved.sourceName === 'string' ? saved.sourceName : '', draft }) : null
  } catch { return null }
}
