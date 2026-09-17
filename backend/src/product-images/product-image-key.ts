import { HttpError } from '../errors/http-error.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireUuid(value: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(422, 'PRODUCT_IMAGE_IDENTIFIER_INVALID', 'Image identifier is invalid')
  }
  return value.toLowerCase()
}

export function productImageKey(accountId: string, productId: string): string {
  return `tenants/${requireUuid(accountId)}/products/${requireUuid(productId)}/main.webp`
}

export function requireProductImageKey(
  accountId: string,
  productId: string,
  imageKey: string,
): string {
  const expected = productImageKey(accountId, productId)
  if (imageKey !== expected) {
    throw new HttpError(403, 'PRODUCT_IMAGE_KEY_FORBIDDEN', 'Image key is not authorized')
  }
  return expected
}
