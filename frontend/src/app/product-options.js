export const clothingSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL']
export function combinationKey(option) {
  return JSON.stringify([option.color, option.size].map(value => String(value ?? '').normalize('NFC').trim().toLowerCase()))
}
export function compareSizes(a, b) {
  const left = String(a.size ?? '').trim().toUpperCase(), right = String(b.size ?? '').trim().toUpperCase()
  const ai = clothingSizes.indexOf(left), bi = clothingSizes.indexOf(right)
  if (ai >= 0 || bi >= 0) return (ai < 0 ? clothingSizes.length : ai) - (bi < 0 ? clothingSizes.length : bi)
  return left.localeCompare(right, 'en', { numeric: true }) || String(a.id ?? a.sku ?? '').localeCompare(String(b.id ?? b.sku ?? ''), 'en')
}
export function operationalState(product, variant, role) {
  if (!product.isActive || !variant.isActive) return 'Inactive'
  if (variant.currentStock <= 0) return 'Out of stock'
  if (variant.sellingPrice === null || variant.sellingPrice === undefined) return role === 'OWNER' ? 'Sale price override needed' : 'Price needed'
  // The sale contract requires a positive price, while zero remains valid catalog data.
  if (/^0(?:\.0+)?$/.test(variant.sellingPrice)) return role === 'OWNER' ? 'Sale price override needed' : 'Positive sale price needed'
  return 'Sellable'
}
