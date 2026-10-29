import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { decimalToCents, loadSalesCatalog, mapCatalogProduct, searchLoadedCatalogByVoice, voiceCatalogSelection } from './sales-catalog.js'

const categoryId = '11111111-1111-4111-8111-111111111111'
const timestamp = '2026-10-14T08:00:00.000Z'
const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'user' }, access_token: 'synthetic-token' } } } } } }

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function product(index, variants = []) {
  return {
    id: `${String(index).padStart(8, '0')}-2222-4222-8222-222222222222`,
    name: `Product ${index}`,
    category: { id: categoryId, name: 'Tops' },
    isActive: true,
    imageUrl: null,
    variants,
  }
}

describe('real Sales catalog adapter', () => {
  test('maps real variants by color and preserves exact variant price, stock, SKU, and ID', () => {
    const mapped = mapCatalogProduct(product(1, [
      { id: 'variant-black-l', sku: 'SKU-BL-L', color: 'Black', size: 'L', sellingPrice: '12.50', currentStock: 4, isActive: true },
      { id: 'variant-black-xl', sku: 'SKU-BL-XL', color: 'Black', size: 'XL', sellingPrice: '14.00', currentStock: 2, isActive: true },
      { id: 'variant-old', sku: 'OLD', color: 'White', size: 'M', sellingPrice: '9.00', currentStock: 8, isActive: false },
    ]))
    assert.equal(mapped.colors.length, 1)
    assert.equal(mapped.colors[0].name, 'Black')
    assert.deepEqual(mapped.colors[0].sizes.map(size => ({ id: size.variantId, price: size.priceCents, stock: size.stock })), [
      { id: 'variant-black-l', price: 1250, stock: 4 },
      { id: 'variant-black-xl', price: 1400, stock: 2 },
    ])
    assert.equal(mapped.priceCents, 1250)
    assert.equal(mapped.priceMaxCents, 1400)
    assert.deepEqual(mapped.skus, ['SKU-BL-L', 'SKU-BL-XL'])
  })

  test('parses catalog Decimal strings without floating point rounding', () => {
    assert.equal(decimalToCents('0.01'), 1)
    assert.equal(decimalToCents('125.5'), 12550)
    assert.equal(decimalToCents('12.345'), null)
    assert.equal(decimalToCents(null), null)
  })

  test('loads every paginated product from authenticated tenant-scoped endpoints', async () => {
    const products = Array.from({ length: 13 }, (_, index) => product(index + 1, [{
      id: `variant-${index + 1}`, sku: `SKU-${index + 1}`, color: 'Blue', size: 'M', sellingPrice: '10.00', currentStock: 1, isActive: true,
    }]))
    const requestedPages = []
    const result = await loadSalesCatalog({ supabase, fetchImpl: async input => {
      const url = new URL(String(input), 'http://local.test')
      if (url.pathname === '/api/categories') return json(200, { categories: [{ id: categoryId, name: 'Tops', createdAt: timestamp, updatedAt: timestamp }] })
      if (url.pathname === '/api/products') {
        const page = Number(url.searchParams.get('page'))
        requestedPages.push(page)
        const start = (page - 1) * 12
        return json(200, { products: products.slice(start, start + 12), total: products.length, page, limit: 12 })
      }
      return json(404, {})
    } })
    assert.equal(result.ok, true)
    assert.equal(result.products.length, 13)
    assert.deepEqual(requestedPages.sort((left, right) => left - right), [1, 2])
    assert.equal(result.complete, true)
  })

  test('turns catalog-first voice discovery into real product filters', () => {
    const result = voiceCatalogSelection({
      discovery: {
        exactVerified: [],
        strongCandidates: [
          { productId: 'product-zara', categoryId: 'category-tshirts' },
          { productId: 'product-zara', categoryId: 'category-tshirts' },
        ],
        alternatives: [],
        categoryResolution: { candidates: [{ categoryId: 'category-tshirts' }] },
      },
      candidates: [], suggestions: [], match: null,
    })
    assert.deepEqual(result.productIds, ['product-zara'])
    assert.deepEqual(result.categoryIds, ['category-tshirts'])
  })

  test('collects independent multi-item voice results without inventing catalog identities', () => {
    const result = voiceCatalogSelection({ items: [
      { result: { match: { productId: 'product-shirt', categoryId: 'category-tops' } } },
      { result: { discovery: { exactVerified: [], strongCandidates: [],
        alternatives: [{ productId: 'product-pants', categoryId: 'category-bottoms' }] } } },
    ] })
    assert.deepEqual(result.productIds, ['product-shirt', 'product-pants'])
    assert.deepEqual(result.categoryIds, ['category-tops', 'category-bottoms'])
  })

  test('finds real mixed-script catalog names when the remote matcher is unavailable', () => {
    const products = [
      { id: 'zara', name: 't chirt zara', categoryName: 't-chirt', colors: [] },
      { id: 'polo', name: 'tchirt polo', categoryName: 't-chirt', colors: [] },
      { id: 'seda', name: 'chemis seda', categoryName: 'chemise', colors: [] },
    ]
    assert.deepEqual(searchLoadedCatalogByVoice('بدي تيشيرت زارا', products), ['zara'])
    assert.deepEqual(searchLoadedCatalogByVoice('تيشيرت بولو', products), ['polo'])
    assert.deepEqual(searchLoadedCatalogByVoice('bdi t chirt polo', products), ['polo'])
    assert.deepEqual(searchLoadedCatalogByVoice('شميز ساده', products), ['seda'])
    assert.deepEqual(searchLoadedCatalogByVoice('قميص', products), ['seda'])
    assert.deepEqual(searchLoadedCatalogByVoice('amis', products), ['seda'])
    assert.deepEqual(searchLoadedCatalogByVoice('تيشيرت unknown', products), [])
  })
})
