import { combinationKey } from './product-options.js'
import { authenticatedApiRequest } from '../auth/owner-flow.js'

export const PRODUCT_PAGE_SIZE = 12
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const messages = {
  INSUFFICIENT_STOCK: 'Stock is already zero. Refresh this option.',
  STOCK_LIMIT_REACHED: 'Stock has reached the supported limit.',
  QUICK_STOCK_CONFLICT: 'This stock update conflicts with another request. Review Inventory before continuing.',
  VARIANT_COMBINATION_ALREADY_EXISTS: 'This color and size already exist. Edit the existing option.',
  BULK_PRICE_TARGET_UNAVAILABLE: 'One of the selected options changed. Refresh and review your selection.',
  INVALID_BULK_PRICE: 'Choose options and enter a nonnegative price with at most two decimals.',
  PRODUCT_NOT_FOUND: 'This product is no longer available. Refresh the catalog.',
  VARIANT_NOT_FOUND: 'This variant is no longer available. Refresh the product.',
  CATEGORY_NOT_FOUND: 'Choose an active category and try again.',
  PRODUCT_INACTIVE: 'Reactivate this product before adding variants.',
  INVALID_CATALOG_ID: 'This catalog item is invalid. Refresh and try again.',
  INVALID_CATALOG_FIELD: 'Check the catalog fields and try again.',
  INVALID_CATALOG_PRICE: 'Enter a nonnegative price with at most two decimals.',
  INVALID_PRODUCT_INPUT: 'Check the product fields and try again.',
  INVALID_VARIANT_INPUT: 'Check the variant fields and try again.',
  INVALID_PRODUCT_FILTER: 'Check the search filters and try again.',
  VARIANT_SKU_ALREADY_EXISTS: 'This SKU already exists in your store.',
  VARIANT_BARCODE_ALREADY_EXISTS: 'This barcode already exists in your store.',
  VARIANT_IDENTIFIER_ALREADY_EXISTS: 'This SKU or barcode already exists in your store.',
  PRODUCT_IMAGE_TOO_LARGE: 'Choose an image smaller than 10 MiB.',
  PRODUCT_IMAGE_DIMENSIONS_TOO_LARGE: 'The image dimensions are too large.',
  PRODUCT_IMAGE_UNSUPPORTED: 'Choose a JPEG, PNG, or static WebP image.',
  PRODUCT_IMAGE_ANIMATED: 'Animated images are not supported.',
  PRODUCT_IMAGE_INVALID: 'This image could not be read. Choose another file.',
  PRODUCT_IMAGE_UPLOAD_INVALID: 'Choose one JPEG, PNG, or WebP image.',
  PRODUCT_IMAGE_UPLOAD_FAILED: 'Image storage is temporarily unavailable. Try again.',
  PRODUCT_IMAGE_DELETE_FAILED: 'The image could not be fully removed. Try again later.',
  PRODUCT_IMAGE_URL_FAILED: 'The image could not be loaded. Refresh and try again.',
  IMAGE_STORAGE_UNAVAILABLE: 'Image storage is temporarily unavailable.',
}

function error(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

function mapFailure(result) {
  if (result.ok) return result
  if (result.code === 'SESSION_REQUIRED' || result.status === 401) {
    return error(result.code, 'Your session has expired. Sign in again.', { requiresLogin: true })
  }
  if (result.status === 403 && ['ACCOUNT_PENDING', 'ACCOUNT_REJECTED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_NOT_ACTIVE'].includes(result.code)) {
    return error(result.code, 'Your store is not currently active.', { requiresAccountReview: true })
  }
  if (result.status === 403) return error(result.code, 'You are not authorized for this action.')
  if (result.status === 429) return error(result.code, 'Too many attempts. Please wait a moment and try again.')
  return error(result.code, messages[result.code] || 'Something went wrong. Please try again.', { uncertain: result.code === 'API_UNAVAILABLE' || result.status >= 500 })
}

function validProduct(value) {
  return value && typeof value.id === 'string' && typeof value.name === 'string' &&
    value.category && typeof value.category.id === 'string' && typeof value.category.name === 'string' &&
    typeof value.isActive === 'boolean' && (value.imageUrl === null || typeof value.imageUrl === 'string') &&
    Array.isArray(value.variants)
}

function validSummary(product) {
 const summary = product?.catalogSummary
 return product && typeof product.id === 'string' && typeof product.name === 'string' && typeof product.category?.name === 'string' && typeof product.isActive === 'boolean' && (product.imageUrl===null||typeof product.imageUrl==='string') && summary && Number.isInteger(summary.activeVariantCount) && Number.isInteger(summary.inactiveVariantCount) && /^\d+$/.test(summary.availableStock) && /^\d+$/.test(summary.inactiveStock) && [summary.priceMin,summary.priceMax].every(value=>value===null||/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value))
}

export function canShowProductMargin(role, product) {
  return role === 'OWNER' && Object.hasOwn(product, 'profitMarginOverride')
}

export function canShowVariantCost(role, variant) {
  return role === 'OWNER' && Object.hasOwn(variant, 'lastPurchaseCost')
}

export function canEditVariantPrice(role) {
  return role === 'OWNER'
}

function productResponse(result, status) {
  if (!result.ok) return mapFailure(result)
  if (result.status !== status || !validProduct(result.data?.product)) {
    return error('INVALID_PRODUCT_RESPONSE', 'The product response was invalid. Refresh and try again.', { uncertain: true })
  }
  return { ok: true, product: result.data.product }
}

function variantResponse(result, status) {
  if (!result.ok) return mapFailure(result)
  if (result.status !== status || typeof result.data?.variant?.id !== 'string') {
    return error('INVALID_VARIANT_RESPONSE', 'The variant response was invalid. Refresh and try again.', { uncertain: true })
  }
  return { ok: true, variant: result.data.variant }
}

function request({ supabase, fetchImpl = globalThis.fetch, path, method = 'GET', payload, requestBody }) {
  return authenticatedApiRequest({
    supabase, fetchImpl, path, method, payload, requestBody,
    fallbackMessage: 'The catalog is unavailable. Please try again.',
  })
}

export function buildProductPayload(draft, role, { editing = false } = {}) {
  const name = typeof draft?.name === 'string' ? draft.name.trim() : ''
  if (!name || [...name].length > 150) return error('INVALID_PRODUCT_NAME', 'Enter a product name of 1–150 characters.')
  if (typeof draft?.categoryId !== 'string' || !draft.categoryId) return error('INVALID_PRODUCT_CATEGORY', 'Choose a category.')
  const payload = { name, categoryId: draft.categoryId }
  if (role === 'OWNER') {
    const margin = String(draft.profitMarginOverride ?? '').trim()
    if (margin && (!/^(?:0|1)(?:\.\d{1,4})?$/.test(margin) || Number(margin) > 1)) {
      return error('INVALID_PROFIT_MARGIN', 'Margin override must be between 0 and 1, with up to four decimals.')
    }
    if (editing || margin) payload.profitMarginOverride = margin || null
  }
  return { ok: true, payload }
}

export function buildProductUpdatePayload(draft, role, current) {
  const built = buildProductPayload(draft, role, { editing: true })
  if (!built.ok) return built
  const payload = {}
  if (built.payload.name !== current.name) payload.name = built.payload.name
  if (built.payload.categoryId !== current.category.id) payload.categoryId = built.payload.categoryId
  if (role === 'OWNER' && built.payload.profitMarginOverride !== (current.profitMarginOverride ?? null)) {
    payload.profitMarginOverride = built.payload.profitMarginOverride
  }
  return Object.keys(payload).length ? { ok: true, payload } : { ok: true, unchanged: true }
}

export function buildVariantPayload(draft, role) {
  const sku = typeof draft?.sku === 'string' ? draft.sku.trim() : ''
  if (!sku || [...sku].length > 100) return error('INVALID_VARIANT_SKU', 'Enter a SKU of 1–100 characters.')
  const payload = { sku }
  for (const field of ['barcode', 'color', 'size']) {
    const value = String(draft[field] ?? '').trim()
    if ([...value].length > 100) return error('INVALID_VARIANT_FIELD', `${field} must be 100 characters or fewer.`)
    payload[field] = value || null
  }
  if (role === 'OWNER') {
    const price = String(draft.sellingPrice ?? '').trim()
    if (price && !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(price)) {
      return error('INVALID_VARIANT_PRICE', 'Enter a nonnegative price with at most two decimals.')
    }
    payload.sellingPrice = price || null
  }
  return { ok: true, payload }
}

export function findVariantDuplicate(draft, variants, editingId = null) {
  const sku = String(draft?.sku ?? '').trim().toLowerCase()
  const barcode = String(draft?.barcode ?? '').trim().toLowerCase()
  const candidates = Array.isArray(variants) ? variants : []
  for (const variant of candidates) {
    if (variant.id === editingId) continue
    if (sku && String(variant.sku ?? '').trim().toLowerCase() === sku) {
      return error('VARIANT_SKU_ALREADY_EXISTS', messages.VARIANT_SKU_ALREADY_EXISTS)
    }
    if (barcode && String(variant.barcode ?? '').trim().toLowerCase() === barcode) {
      return error('VARIANT_BARCODE_ALREADY_EXISTS', messages.VARIANT_BARCODE_ALREADY_EXISTS)
    }
    if (combinationKey(draft) === combinationKey(variant)) return error('VARIANT_COMBINATION_ALREADY_EXISTS', messages.VARIANT_COMBINATION_ALREADY_EXISTS)
  }
  return { ok: true }
}

export function validateImage(file) {
  if (!file) return error('PRODUCT_IMAGE_REQUIRED', 'Choose an image to upload.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return error('PRODUCT_IMAGE_UNSUPPORTED', messages.PRODUCT_IMAGE_UNSUPPORTED)
  }
  if (file.size > MAX_IMAGE_BYTES) return error('PRODUCT_IMAGE_TOO_LARGE', messages.PRODUCT_IMAGE_TOO_LARGE)
  return { ok: true }
}

export async function listProducts({ supabase, fetchImpl, filters = {}, summary = false }) {
  const query = new URLSearchParams({ page: String(filters.page || 1), limit: String(PRODUCT_PAGE_SIZE) })
  if (summary) query.set('view','summary')
  if (filters.isActive === 'false' || filters.isActive === 'all') query.set('isActive', filters.isActive)
  if (filters.categoryId) query.set('categoryId', filters.categoryId)
  if (filters.search?.trim()) query.set('search', filters.search.trim())
  const result = await request({ supabase, fetchImpl, path: `/api/products?${query}` })
  if (!result.ok) return mapFailure(result)
  const data = result.data
  if (result.status !== 200 || !Array.isArray(data?.products) || !data.products.every(summary ? validSummary : validProduct) ||
      !Number.isInteger(data.total) || data.total < 0 || !Number.isInteger(data.page) || !Number.isInteger(data.limit)) {
    return error('INVALID_PRODUCTS_RESPONSE', 'The catalog response was invalid. Refresh and try again.')
  }
  return { ok: true, products: data.products, total: data.total, page: data.page, limit: data.limit }
}

export async function getProduct({ supabase, fetchImpl, productId }) {
  return productResponse(await request({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}` }), 200)
}

export async function createProduct({ supabase, fetchImpl, draft, role }) {
  const built = buildProductPayload(draft, role)
  if (!built.ok) return built
  return productResponse(await request({ supabase, fetchImpl, path: '/api/products', method: 'POST', payload: built.payload }), 201)
}

export async function updateProduct({ supabase, fetchImpl, productId, draft, role, current }) {
  const built = buildProductUpdatePayload(draft, role, current)
  if (!built.ok) return built
  if (built.unchanged) return { ok: true, unchanged: true, product: current }
  return productResponse(await request({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}`, method: 'PATCH', payload: built.payload }), 200)
}

export async function setProductActive({ supabase, fetchImpl, productId, isActive }) {
  return productResponse(await request({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}`, method: 'PATCH', payload: { isActive } }), 200)
}

export async function createVariant({ supabase, fetchImpl, productId, draft, role }) {
  const built = buildVariantPayload(draft, role)
  if (!built.ok) return built
  if (role === 'OWNER' && draft.openingStock === true) built.payload.openingStock = true
  return variantResponse(await request({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}/variants`, method: 'POST', payload: built.payload }), 201)
}

export async function updateVariant({ supabase, fetchImpl, productId, variantId, draft, role }) {
  const built = buildVariantPayload(draft, role)
  if (!built.ok) return built
  return variantResponse(await request({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`, method: 'PATCH', payload: built.payload }), 200)
}

export async function setVariantActive({ supabase, fetchImpl, productId, variantId, isActive }) {
  return variantResponse(await request({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`, method: 'PATCH', payload: { isActive } }), 200)
}

export async function uploadProductImage({ supabase, fetchImpl, productId, file }) {
  const valid = validateImage(file)
  if (!valid.ok) return valid
  const body = new FormData()
  body.set('image', file)
  return productResponse(await request({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}/image`, method: 'POST', requestBody: body }), 200)
}

export async function removeProductImage({ supabase, fetchImpl, productId }) {
  const result = await request({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}/image`, method: 'DELETE' })
  if (!result.ok) return mapFailure(result)
  return result.status === 204 ? { ok: true } : error('INVALID_IMAGE_RESPONSE', 'Image removal could not be confirmed. Refresh and try again.')
}

export async function setOpeningCost({ supabase, fetchImpl, productId, variantId, unitCost }) {
  return variantResponse(await request({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/opening-cost`, method: 'PUT', payload: { unitCost } }), 200)
}

export async function quickAddStock({ supabase, fetchImpl, productId, variantId, operationId, delta = 1 }) {
  return variantResponse(await authenticatedApiRequest({ supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/quick-stock`, method: 'POST', payload: { delta }, headers: { 'Idempotency-Key': operationId }, fallbackMessage: 'Stock could not be confirmed. Press the same stock button again to retry safely.' }), 200)
}

export async function createProductSetup({ supabase, fetchImpl, draft, role }) {
  const product = buildProductPayload(draft, role)
  if (!product.ok) return product
  const variants = []
  for (const option of draft.options) {
    const variant = buildVariantPayload(option, role)
    if (!variant.ok) return variant
    if (role === 'OWNER' && option.openingStock === true) variant.payload.openingStock = true
    variants.push(variant.payload)
  }
  return productResponse(await request({ supabase, fetchImpl, path: '/api/products/setup', method: 'POST', payload: { product: product.payload, variants } }), 201)
}

export async function applyVariantPrice({supabase, fetchImpl, productId, variantIds, sellingPrice}) {
 return productResponse(await request({supabase, fetchImpl, path: `/api/products/${encodeURIComponent(productId)}/variant-prices`, method:'POST', payload:{variantIds, sellingPrice}}),200)
}
