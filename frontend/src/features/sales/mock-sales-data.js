export const UNCATEGORIZED_ID = 'uncategorized'

export const seedCategories = Object.freeze([
  Object.freeze({ id: 'tops', name: 'Tops' }),
  Object.freeze({ id: 'bottoms', name: 'Bottoms' }),
])

const size = (name, stock) => Object.freeze({ name, stock })
const color = (id, name, hex, sizes) => Object.freeze({ id, name, hex, sizes: Object.freeze(sizes) })

export const seedProducts = Object.freeze([
  Object.freeze({ id: 'classic-tee', name: 'Classic tee', sku: 'TOP-101', categoryId: 'tops', priceCents: 2400, icon: 'tee', colors: Object.freeze([
    color('black', 'Black', '#202522', [size('S', 4), size('M', 8), size('L', 5), size('XL', 2)]),
    color('cream', 'Cream', '#e9dfc7', [size('S', 3), size('M', 6), size('L', 4), size('XL', 1)]),
    color('sage', 'Sage', '#839681', [size('S', 2), size('M', 4), size('L', 3), size('XL', 0)]),
  ]) }),
  Object.freeze({ id: 'ribbed-top', name: 'Ribbed top', sku: 'TOP-118', categoryId: 'tops', priceCents: 2800, icon: 'top', colors: Object.freeze([
    color('rose', 'Rose', '#bd7d83', [size('XS', 2), size('S', 3), size('M', 2), size('L', 1)]),
    color('white', 'White', '#f1f0e9', [size('XS', 1), size('S', 4), size('M', 0), size('L', 2)]),
  ]) }),
  Object.freeze({ id: 'oxford-shirt', name: 'Oxford shirt', sku: 'TOP-204', categoryId: 'tops', priceCents: 4200, icon: 'shirt', colors: Object.freeze([
    color('sky', 'Sky blue', '#8baeba', [size('S', 1), size('M', 4), size('L', 6), size('XL', 3)]),
    color('white', 'White', '#f1f0e9', [size('S', 0), size('M', 2), size('L', 3), size('XL', 2)]),
  ]) }),
  Object.freeze({ id: 'everyday-hoodie', name: 'Everyday hoodie', sku: 'TOP-260', categoryId: 'tops', priceCents: 5600, icon: 'hoodie', colors: Object.freeze([
    color('forest', 'Forest', '#315941', [size('S', 2), size('M', 3), size('L', 2), size('XL', 1)]),
    color('charcoal', 'Charcoal', '#505753', [size('S', 0), size('M', 2), size('L', 1), size('XL', 1)]),
  ]) }),
  Object.freeze({ id: 'straight-jeans', name: 'Straight jeans', sku: 'BOT-310', categoryId: 'bottoms', priceCents: 6200, icon: 'pants', colors: Object.freeze([
    color('indigo', 'Indigo', '#38566f', [size('28', 1), size('30', 3), size('32', 5), size('34', 2), size('36', 0)]),
    color('washed-black', 'Washed black', '#454947', [size('28', 0), size('30', 2), size('32', 1), size('34', 2), size('36', 1)]),
  ]) }),
  Object.freeze({ id: 'wide-leg-pants', name: 'Wide-leg pants', sku: 'BOT-326', categoryId: 'bottoms', priceCents: 4800, icon: 'pants', colors: Object.freeze([
    color('olive', 'Olive', '#69705a', [size('S', 0), size('M', 0), size('L', 0)]),
    color('sand', 'Sand', '#c8b892', [size('S', 0), size('M', 0), size('L', 0)]),
  ]) }),
  Object.freeze({ id: 'cargo-pants', name: 'Cargo pants', sku: 'BOT-344', categoryId: 'bottoms', priceCents: 5400, icon: 'pants', colors: Object.freeze([
    color('khaki', 'Khaki', '#8e896b', [size('S', 1), size('M', 2), size('L', 1), size('XL', 0)]),
    color('black', 'Black', '#202522', [size('S', 0), size('M', 1), size('L', 0), size('XL', 0)]),
  ]) }),
  Object.freeze({ id: 'lounge-shorts', name: 'Lounge shorts', sku: 'BOT-360', categoryId: 'bottoms', priceCents: 2200, icon: 'shorts', colors: Object.freeze([
    color('navy', 'Navy', '#324357', [size('One size', 7)]),
    color('grey', 'Grey', '#9a9f9b', [size('One size', 5)]),
  ]) }),
])

export function createSeedSalesState() {
  return {
    categories: seedCategories.map(category => ({ ...category })),
    products: seedProducts.map(product => ({ ...product,
      colors: product.colors.map(item => ({ ...item, sizes: item.sizes.map(row => ({ ...row })) })),
    })),
    receipts: [],
  }
}
