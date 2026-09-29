import { HttpError } from '../errors/http-error.js'
import type {
  ProductCreateInput,
  ProductListInput,
  ProductUpdateInput,
  VariantCreateInput,
  VariantUpdateInput,
} from './product.types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(code: string, message: string): never {
  throw new HttpError(422, code, message)
}

function forbidden(message: string): never {
  throw new HttpError(403, 'SENSITIVE_FIELD_FORBIDDEN', message)
}

export function parseCatalogId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(400, 'INVALID_CATALOG_ID', `${name} must be a valid UUID`)
  }
  return value.toLowerCase()
}

function objectWithKeys(body: unknown, allowed: readonly string[], code: string): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid(code, 'Invalid catalog input')
  const input = body as Record<string, unknown>
  if (Object.keys(input).length === 0 || Object.keys(input).some((key) => !allowed.includes(key))) {
    invalid(code, 'Only approved catalog fields may be supplied')
  }
  return input
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') invalid('INVALID_CATALOG_FIELD', `${field} must be a string`)
  const text = value.trim()
  if (!text || [...text].length > max) invalid('INVALID_CATALOG_FIELD', `${field} must contain 1 to ${max} characters`)
  return text
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string') invalid('INVALID_CATALOG_FIELD', `${field} must be a string or null`)
  const text = value.trim()
  if (!text) return null
  if ([...text].length > max) invalid('INVALID_CATALOG_FIELD', `${field} is too long`)
  return text
}

function decimal(value: unknown, field: string, scale: number, maxIntegerDigits: number): string | null {
  if (value === null) return null
  if (typeof value !== 'number' && typeof value !== 'string') invalid('INVALID_CATALOG_PRICE', `${field} must be a decimal or null`)
  const text = String(value)
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,${maxIntegerDigits - 1}})(?:\\.\\d{1,${scale}})?$`)
  if (!pattern.test(text)) invalid('INVALID_CATALOG_PRICE', `${field} must be a nonnegative decimal with at most ${scale} places`)
  return text
}

function margin(value: unknown): string | null {
  const text = decimal(value, 'profitMarginOverride', 4, 1)
  if (text !== null && Number(text) > 1) invalid('INVALID_PROFIT_MARGIN', 'profitMarginOverride must be between 0 and 1')
  return text
}

function active(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid('INVALID_CATALOG_FIELD', 'isActive must be a boolean')
  return value
}

export function parseProductCreate(body: unknown, isOwner: boolean): ProductCreateInput {
  const input = objectWithKeys(body, ['categoryId', 'name', 'profitMarginOverride'], 'INVALID_PRODUCT_INPUT')
  if (!Object.hasOwn(input, 'categoryId') || !Object.hasOwn(input, 'name')) invalid('INVALID_PRODUCT_INPUT', 'categoryId and name are required')
  if (!isOwner && Object.hasOwn(input, 'profitMarginOverride')) invalid('SENSITIVE_FIELD_FORBIDDEN', 'profitMarginOverride is OWNER-only')
  return {
    categoryId: parseCatalogId(input.categoryId, 'categoryId'),
    name: requiredText(input.name, 'name', 150),
    ...(Object.hasOwn(input, 'profitMarginOverride') ? { profitMarginOverride: margin(input.profitMarginOverride) } : {}),
  }
}

export function parseProductUpdate(body: unknown, isOwner: boolean): ProductUpdateInput {
  const input = objectWithKeys(body, ['categoryId', 'name', 'profitMarginOverride', 'isActive'], 'INVALID_PRODUCT_INPUT')
  if (!isOwner && Object.hasOwn(input, 'profitMarginOverride')) invalid('SENSITIVE_FIELD_FORBIDDEN', 'profitMarginOverride is OWNER-only')
  return {
    ...(Object.hasOwn(input, 'categoryId') ? { categoryId: parseCatalogId(input.categoryId, 'categoryId') } : {}),
    ...(Object.hasOwn(input, 'name') ? { name: requiredText(input.name, 'name', 150) } : {}),
    ...(Object.hasOwn(input, 'profitMarginOverride') ? { profitMarginOverride: margin(input.profitMarginOverride) } : {}),
    ...(Object.hasOwn(input, 'isActive') ? { isActive: active(input.isActive) } : {}),
  }
}

export function parseVariantCreate(body: unknown, isOwner: boolean): VariantCreateInput {
  const input = objectWithKeys(body, ['sku', 'barcode', 'color', 'size', 'sellingPrice', 'openingStock'], 'INVALID_VARIANT_INPUT')
  if (!Object.hasOwn(input, 'sku')) invalid('INVALID_VARIANT_INPUT', 'sku is required')
  if (!isOwner && Object.hasOwn(input, 'sellingPrice')) forbidden('sellingPrice is OWNER-only')
  if (!isOwner && Object.hasOwn(input, 'openingStock')) forbidden('Opening stock is OWNER-only')
  return {
    ...(Object.hasOwn(input, 'openingStock') ? { openingStock: active(input.openingStock) } : {}),
    sku: requiredText(input.sku, 'sku', 100),
    ...(Object.hasOwn(input, 'barcode') ? { barcode: optionalText(input.barcode, 'barcode', 100) } : {}),
    ...(Object.hasOwn(input, 'color') ? { color: optionalText(input.color, 'color', 100) } : {}),
    ...(Object.hasOwn(input, 'size') ? { size: optionalText(input.size, 'size', 100) } : {}),
    ...(Object.hasOwn(input, 'sellingPrice') ? { sellingPrice: decimal(input.sellingPrice, 'sellingPrice', 2, 16) } : {}),
  }
}

export function parseVariantUpdate(body: unknown, isOwner: boolean): VariantUpdateInput {
  const input = objectWithKeys(body, ['sku', 'barcode', 'color', 'size', 'sellingPrice', 'isActive'], 'INVALID_VARIANT_INPUT')
  if (!isOwner && Object.hasOwn(input, 'sellingPrice')) forbidden('sellingPrice is OWNER-only')
  return {
    ...(Object.hasOwn(input, 'sku') ? { sku: requiredText(input.sku, 'sku', 100) } : {}),
    ...(Object.hasOwn(input, 'barcode') ? { barcode: optionalText(input.barcode, 'barcode', 100) } : {}),
    ...(Object.hasOwn(input, 'color') ? { color: optionalText(input.color, 'color', 100) } : {}),
    ...(Object.hasOwn(input, 'size') ? { size: optionalText(input.size, 'size', 100) } : {}),
    ...(Object.hasOwn(input, 'sellingPrice') ? { sellingPrice: decimal(input.sellingPrice, 'sellingPrice', 2, 16) } : {}),
    ...(Object.hasOwn(input, 'isActive') ? { isActive: active(input.isActive) } : {}),
  }
}

export function parseProductList(query: Record<string, unknown>): ProductListInput {
  const allowed = ['isActive', 'categoryId', 'search', 'page', 'limit']
  if (Object.keys(query).some((key) => !allowed.includes(key))) invalid('INVALID_PRODUCT_FILTER', 'Unsupported Product filter')
  let isActive: boolean | undefined = true
  if (query.isActive !== undefined) {
    if (query.isActive === 'all') isActive = undefined
    else if (query.isActive === 'true') isActive = true
    else if (query.isActive === 'false') isActive = false
    else invalid('INVALID_PRODUCT_FILTER', 'isActive must be true, false, or all')
  }
  const search = query.search === undefined ? undefined : requiredText(query.search, 'search', 100)
  const parseIntInRange = (value: unknown, defaultValue: number, max: number): number => {
    if (value === undefined) return defaultValue
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) invalid('INVALID_PRODUCT_FILTER', 'Pagination must be positive integers')
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number > max) invalid('INVALID_PRODUCT_FILTER', 'Pagination exceeds allowed range')
    return number
  }
  return {
    isActive,
    categoryId: query.categoryId === undefined ? undefined : parseCatalogId(query.categoryId, 'categoryId'),
    search,
    page: parseIntInRange(query.page, 1, 10_000),
    limit: parseIntInRange(query.limit, 20, 100),
  }
}

export function parseProductSetup(body: unknown, isOwner: boolean) {
  const input = objectWithKeys(body, ['product', 'variants'], 'INVALID_PRODUCT_SETUP')
  const product = parseProductCreate(input.product, isOwner)
  if (!Array.isArray(input.variants) || input.variants.length < 1 || input.variants.length > 200) invalid('INVALID_PRODUCT_SETUP', 'Choose 1 to 200 color/size options')
  const variants = input.variants.map(variant => parseVariantCreate(variant, isOwner))
  const skus = new Set<string>(), barcodes = new Set<string>()
  for (const variant of variants) {
    if (skus.has(variant.sku) || (variant.barcode && barcodes.has(variant.barcode))) invalid('INVALID_PRODUCT_SETUP', 'Each option needs unique identifiers')
    skus.add(variant.sku)
    if (variant.barcode) barcodes.add(variant.barcode)
  }
  return { product, variants }
}
