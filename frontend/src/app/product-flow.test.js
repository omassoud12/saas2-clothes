import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildProductPayload, buildProductUpdatePayload, buildVariantPayload, canEditVariantPrice, canShowProductMargin, canShowVariantCost, findVariantDuplicate,
  createProduct, createVariant, getProduct, listProducts, removeProductImage,
  setProductActive, setVariantActive, updateProduct, updateVariant, uploadProductImage, validateImage,
} from './product-flow.js'

const productId = '11111111-1111-4111-8111-111111111111'
const categoryId = '22222222-2222-4222-8222-222222222222'
const supabase = { auth: { async getSession() { return { data: { session: { user: { id: 'u' }, access_token: 'test-token' } } } } } }
const product = { id: productId, name: 'Linen shirt', category: { id: categoryId, name: 'Shirts' }, isActive: true, imageUrl: null, variants: [] }

function json(status, data) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }

describe('Product frontend contract', () => {
  test('WAREHOUSE cannot submit or display OWNER financial fields', () => {
    const built = buildProductPayload({ name: ' Shirt ', categoryId, profitMarginOverride: '0.3', accountId: 'forged' }, 'WAREHOUSE')
    assert.deepEqual(built.payload, { name: 'Shirt', categoryId })
    assert.equal(canShowProductMargin('WAREHOUSE', { profitMarginOverride: '0.3' }), false)
    assert.equal(canShowVariantCost('WAREHOUSE', { lastPurchaseCost: '10.00' }), false)
    assert.equal(canShowProductMargin('OWNER', { profitMarginOverride: null }), true)
    assert.equal(canShowVariantCost('OWNER', { lastPurchaseCost: null }), true)
  })

  test('OWNER may submit margin; required fields and bounds are checked', () => {
    assert.deepEqual(buildProductPayload({ name: ' Shirt ', categoryId, profitMarginOverride: '0.3000' }, 'OWNER').payload,
      { name: 'Shirt', categoryId, profitMarginOverride: '0.3000' })
    assert.equal(buildProductPayload({ name: ' ', categoryId }, 'OWNER').ok, false)
    assert.equal(buildProductPayload({ name: 'Shirt', categoryId: '' }, 'OWNER').ok, false)
    assert.equal(buildProductPayload({ name: 'Shirt', categoryId, profitMarginOverride: '1.2' }, 'OWNER').ok, false)
  })

  test('Product edit omits unchanged category, allowing name edits on historical inactive categories', async () => {
    const draft = { name: ' New linen shirt ', categoryId, profitMarginOverride: '' }
    assert.deepEqual(buildProductUpdatePayload(draft, 'WAREHOUSE', product).payload, { name: 'New linen shirt' })
    let options
    const result = await updateProduct({ supabase, productId, role: 'WAREHOUSE', current: product, draft,
      fetchImpl: async (_url, request) => { options = request; return json(200, { product: { ...product, name: 'New linen shirt' } }) } })
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(options.body), { name: 'New linen shirt' })
  })

  test('OWNER Variant payload contains allowed catalog price, never stock or cost', () => {
    const built = buildVariantPayload({ sku: ' SKU ', barcode: '', color: ' Blue ', size: '', sellingPrice: '12.50', currentStock: 99, lastPurchaseCost: '1' }, 'OWNER')
    assert.deepEqual(built.payload, { sku: 'SKU', barcode: null, color: 'Blue', size: null, sellingPrice: '12.50' })
    assert.equal(buildVariantPayload({ sku: 'SKU', sellingPrice: '-1' }, 'OWNER').ok, false)
  })

  test('WAREHOUSE Variant payload omits OWNER-only selling price and purchase cost', () => {
    const built = buildVariantPayload({ sku: ' SKU ', barcode: '', color: ' Blue ', size: '', sellingPrice: '12.50', lastPurchaseCost: '1' }, 'WAREHOUSE')
    assert.deepEqual(built.payload, { sku: 'SKU', barcode: null, color: 'Blue', size: null })
    assert.equal(Object.hasOwn(built.payload, 'sellingPrice'), false)
    assert.equal(Object.hasOwn(built.payload, 'lastPurchaseCost'), false)
    assert.equal(canEditVariantPrice('WAREHOUSE'), false)
    assert.equal(canEditVariantPrice('OWNER'), true)
  })

  test('obvious duplicate SKU and barcode values are caught before submission', () => {
    const variants = [{ id: 'one', sku: 'SKU-1', barcode: 'BAR-1' }]
    assert.equal(findVariantDuplicate({ sku: ' sku-1 ' }, variants).code, 'VARIANT_SKU_ALREADY_EXISTS')
    assert.equal(findVariantDuplicate({ sku: 'new', barcode: 'bar-1' }, variants).code, 'VARIANT_BARCODE_ALREADY_EXISTS')
    assert.equal(findVariantDuplicate({ sku: 'SKU-1', barcode: 'BAR-1' }, variants, 'one').ok, true)
  })

  test('list uses backend search, active filter, and bounded pagination', async () => {
    let requested
    const result = await listProducts({ supabase, filters: { search: ' SKU ', isActive: 'false', categoryId, page: 2 },
      fetchImpl: async (url) => { requested = new URL(url, 'https://local.test'); return json(200, { products: [{ ...product, isActive: false }], total: 13, page: 2, limit: 12 }) } })
    assert.equal(result.ok, true)
    assert.equal(requested.searchParams.get('search'), 'SKU')
    assert.equal(requested.searchParams.get('isActive'), 'false')
    assert.equal(requested.searchParams.get('categoryId'), categoryId)
    assert.equal(requested.searchParams.get('page'), '2')
    assert.equal(requested.searchParams.get('limit'), '12')
  })

  test('default list omits inactive selector and null image remains null', async () => {
    let requested
    const result = await listProducts({ supabase, fetchImpl: async (url) => { requested = new URL(url, 'https://local.test'); return json(200, { products: [product], total: 1, page: 1, limit: 12 }) } })
    assert.equal(requested.searchParams.has('isActive'), false)
    assert.equal(result.products[0].imageUrl, null)
  })

  test('create Product sends no privileged fields', async () => {
    let options
    const result = await createProduct({ supabase, role: 'WAREHOUSE', draft: { name: 'Shirt', categoryId, accountId: 'forged', imageKey: 'forged' },
      fetchImpl: async (_url, request) => { options = request; return json(201, { product }) } })
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(options.body), { name: 'Shirt', categoryId })
    assert.equal(options.headers.Authorization, 'Bearer test-token')
  })

  test('create Variant sends no stock or cost and maps duplicate errors safely', async () => {
    let options
    const result = await createVariant({ supabase, productId, role: 'OWNER', draft: { sku: 'SKU', currentStock: 7, lastPurchaseCost: '5' },
      fetchImpl: async (_url, request) => { options = request; return json(409, { error: { code: 'VARIANT_SKU_ALREADY_EXISTS', message: 'database details' } }) } })
    assert.deepEqual(JSON.parse(options.body), { sku: 'SKU', barcode: null, color: null, size: null, sellingPrice: null })
    assert.equal(result.message, 'This SKU already exists in your store.')
    assert.doesNotMatch(result.message, /database/)
    const barcode = await createVariant({ supabase, productId, role: 'OWNER', draft: { sku: 'OTHER', barcode: 'CODE' },
      fetchImpl: async () => json(409, { error: { code: 'VARIANT_BARCODE_ALREADY_EXISTS', message: 'database details' } }) })
    assert.equal(barcode.message, 'This barcode already exists in your store.')
  })

  test('WAREHOUSE create request sends the exact non-financial backend payload', async () => {
    let options
    await createVariant({ supabase, productId, role: 'WAREHOUSE', draft: { sku: 'SKU', color: 'Blue', sellingPrice: '99.00', lastPurchaseCost: '20' },
      fetchImpl: async (_url, request) => { options = request; return json(201, { variant: { id: productId } }) } })
    assert.deepEqual(JSON.parse(options.body), { sku: 'SKU', barcode: null, color: 'Blue', size: null })
  })

  test('WAREHOUSE update request also omits selling price authority', async () => {
    let options
    await updateVariant({ supabase, productId, variantId: productId, role: 'WAREHOUSE', draft: { sku: 'SKU', size: 'M', sellingPrice: '99.00' },
      fetchImpl: async (_url, request) => { options = request; return json(200, { variant: { id: productId } }) } })
    assert.deepEqual(JSON.parse(options.body), { sku: 'SKU', barcode: null, color: null, size: 'M' })
  })

  test('rate limiting returns safe retry guidance', async () => {
    const result = await createVariant({ supabase, productId, role: 'OWNER', draft: { sku: 'SKU' },
      fetchImpl: async () => json(429, { error: { code: 'RATE_LIMITED', message: 'internal limiter details' } }) })
    assert.equal(result.message, 'Too many attempts. Please wait a moment and try again.')
    assert.doesNotMatch(result.message, /internal/)
  })

  test('deactivation sends only isActive and detail preserves signed URL in memory', async () => {
    let options
    const update = await setProductActive({ supabase, productId, isActive: false, fetchImpl: async (_url, request) => { options = request; return json(200, { product: { ...product, isActive: false } }) } })
    assert.equal(update.product.isActive, false)
    assert.deepEqual(JSON.parse(options.body), { isActive: false })
    const signed = await getProduct({ supabase, productId, fetchImpl: async () => json(200, { product: { ...product, imageUrl: 'https://signed.example/main.webp' } }) })
    assert.equal(signed.product.imageUrl, 'https://signed.example/main.webp')
  })

  test('Variant deactivation sends only isActive and no hard delete', async () => {
    let options
    const result = await setVariantActive({ supabase, productId, variantId: productId, isActive: false,
      fetchImpl: async (_url, request) => { options = request; return json(200, { variant: { id: productId, isActive: false } }) } })
    assert.equal(result.ok, true)
    assert.equal(options.method, 'PATCH')
    assert.deepEqual(JSON.parse(options.body), { isActive: false })
  })

  test('upload uses multipart image field without JSON Content-Type', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' })
    let options
    const result = await uploadProductImage({ supabase, productId, file, fetchImpl: async (_url, request) => { options = request; return json(200, { product: { ...product, imageUrl: 'https://signed.example/main.webp' } }) } })
    assert.equal(result.ok, true)
    assert.equal(options.body instanceof FormData, true)
    assert.equal(options.body.get('image').name, 'test.png')
    assert.equal(Object.hasOwn(options.headers, 'Content-Type'), false)
    assert.equal(validateImage(new File([new Uint8Array([1])], 'bad.gif', { type: 'image/gif' })).ok, false)
  })

  test('image removal sends no imageKey or request body', async () => {
    let options
    const result = await removeProductImage({ supabase, productId, fetchImpl: async (_url, request) => { options = request; return new Response(null, { status: 204 }) } })
    assert.equal(result.ok, true)
    assert.equal(Object.hasOwn(options, 'body'), false)
  })
})
