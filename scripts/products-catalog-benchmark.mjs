// Offline synthetic contract measurement; no database or network access.
import { performance } from 'node:perf_hooks'
import { summarizeProductCatalog } from '../frontend/src/lib/money.js'

for (const options of [8, 40, 200, 2000]) {
  const products = Array.from({ length: 12 }, (_, p) => ({
    id: `product-${p}`, name: `Cotton polo model ${p}`, category: { id: 'shirts', name: 'Shirts' }, isActive: true, imageUrl: null,
    variants: Array.from({ length: options }, (_, i) => ({
      id: `variant-${p}-${i}`, sku: `ITEM-8cbdd002-613e-433b-bcae-${String(i).padStart(12, '0')}`,
      barcode: null, color: `Color ${Math.floor(i / 8)}`, size: ['XS','S','M','L','XL','XXL','3XL','4XL'][i % 8],
      isActive: i % 10 !== 0, currentStock: 5, sellingPrice: '15.00', lastPurchaseCost: null,
    })),
  }))
  const summaries = products.map(({ variants, ...identity }) => {
    const summary = summarizeProductCatalog({ ...identity, variants }, 'USD')
    return { ...identity, catalogSummary: { activeVariantCount: variants.filter(v => v.isActive).length, inactiveVariantCount: variants.filter(v => !v.isActive).length, availableStock: summary.stock, inactiveStock: summary.inactiveStock, priceMin: '15.00', priceMax: '15.00' } }
  })
  const full = JSON.stringify(products), compact = JSON.stringify(summaries)
  const begin = performance.now()
  for (let n = 0; n < 100; n++) for (const product of products) summarizeProductCatalog(product, 'USD')
  const fullWork = performance.now() - begin
  const compactBegin = performance.now()
  for (let n = 0; n < 100; n++) for (const product of summaries) String(product.catalogSummary.availableStock)
  const compactWork = performance.now() - compactBegin
  console.log(JSON.stringify({ products: 12, variantsPerProduct: options, fullBytes: Buffer.byteLength(full), summaryBytes: Buffer.byteLength(compact), reductionPercent: +(100 * (1 - Buffer.byteLength(compact) / Buffer.byteLength(full))).toFixed(2), fullSummaryWorkMs: +fullWork.toFixed(2), compactReadWorkMs: +compactWork.toFixed(2) }))
}
