import { createHash } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import type { SaleInput, SaleLineInput } from './sale.types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pricePattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/
export const maxSaleLines = 100
export const maxSaleQuantity = 1_000_000

export function parseSaleIdempotencyKey(headers: Record<string, unknown>, rawHeaders: readonly string[]): string {
  let count = 0
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'idempotency-key') count += 1
  }
  const value = headers['idempotency-key']
  if (count === 0 || value === undefined) {
    throw new HttpError(400, 'SALE_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required')
  }
  if (count !== 1 || typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(400, 'SALE_IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be one UUID')
  }
  return value.toLowerCase()
}

function parseLine(value: unknown): SaleLineInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, 'INVALID_SALE_ITEM', 'Each Sale item must be an object')
  }
  const item = value as Record<string, unknown>
  const allowed = ['variantId', 'quantity', 'unitSoldPrice']
  if (Object.keys(item).some((key) => !allowed.includes(key)) || allowed.some((key) => !Object.hasOwn(item, key))) {
    throw new HttpError(422, 'INVALID_SALE_ITEM', 'Only variantId, quantity, and unitSoldPrice are allowed')
  }
  if (typeof item.variantId !== 'string' || !uuidPattern.test(item.variantId)) {
    throw new HttpError(422, 'INVALID_SALE_VARIANT_ID', 'variantId must be a UUID')
  }
  if (typeof item.quantity !== 'number' || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > maxSaleQuantity) {
    throw new HttpError(422, 'INVALID_SALE_QUANTITY', `quantity must be an integer from 1 to ${maxSaleQuantity}`)
  }
  if (typeof item.unitSoldPrice !== 'string' || !pricePattern.test(item.unitSoldPrice)) {
    throw new HttpError(422, 'INVALID_SALE_PRICE', 'unitSoldPrice must be a positive decimal string with at most two places')
  }
  const price = new Prisma.Decimal(item.unitSoldPrice)
  if (!price.gt(0)) {
    throw new HttpError(422, 'INVALID_SALE_PRICE', 'unitSoldPrice must be greater than zero')
  }
  return {
    variantId: item.variantId.toLowerCase(),
    quantity: item.quantity,
    unitSoldPrice: price.toFixed(2),
  }
}

export function parseSaleInput(body: unknown): SaleInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'INVALID_SALE_INPUT', 'Sale input must be an object')
  }
  const input = body as Record<string, unknown>
  if (Object.keys(input).some((key) => key !== 'items') || !Object.hasOwn(input, 'items') || !Array.isArray(input.items)) {
    throw new HttpError(422, 'INVALID_SALE_INPUT', 'Only an items array is allowed')
  }
  if (input.items.length === 0) {
    throw new HttpError(422, 'SALE_CART_EMPTY', 'Sale cart must contain at least one item')
  }
  if (input.items.length > maxSaleLines) {
    throw new HttpError(422, 'SALE_CART_TOO_LARGE', `Sale cart must not exceed ${maxSaleLines} items`)
  }
  const items = input.items.map(parseLine)
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.variantId)) {
      throw new HttpError(422, 'SALE_DUPLICATE_VARIANT', 'Each Variant may appear only once in a Sale')
    }
    seen.add(item.variantId)
  }
  return { items }
}

export function canonicalSaleItems(items: readonly SaleLineInput[]): readonly SaleLineInput[] {
  return [...items].sort((left, right) => left.variantId.localeCompare(right.variantId))
}

export function saleFingerprint(accountId: string, soldById: string, items: readonly SaleLineInput[]): string {
  const canonical = {
    accountId: accountId.toLowerCase(),
    soldById: soldById.toLowerCase(),
    items: canonicalSaleItems(items).map((item) => ({
      variantId: item.variantId.toLowerCase(),
      quantity: item.quantity,
      unitSoldPrice: item.unitSoldPrice,
    })),
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}
