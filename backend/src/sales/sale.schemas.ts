import { createHash } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import { SaleStatus } from '../generated/prisma/enums.js'
import type { SaleHistoryQuery, SaleInput, SaleLineInput } from './sale.types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pricePattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
export const maxSaleLines = 100
export const maxSaleQuantity = 1_000_000

function invalidFilter(message: string): never {
  throw new HttpError(422, 'INVALID_SALE_FILTER', message)
}

function parseUuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) invalidFilter(`${name} must be a UUID`)
  return value.toLowerCase()
}

function parseTimestamp(value: unknown, name: string): Date | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !timestampPattern.test(value)) invalidFilter(`${name} must be a UTC timestamp`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) invalidFilter(`${name} must be a valid timestamp`)
  const [seconds, fraction = ''] = value.slice(0, -1).split('.')
  if (date.toISOString() !== `${seconds}.${fraction.padEnd(3, '0')}Z`) invalidFilter(`${name} must be a valid timestamp`)
  return date
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 25
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) invalidFilter('limit must be a positive integer')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 100) invalidFilter('limit must be at most 100')
  return parsed
}

export function encodeSaleCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url')
}

function parseCursor(value: unknown): SaleHistoryQuery['cursor'] {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) invalidFilter('Invalid Sale cursor')
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) invalidFilter('Invalid Sale cursor')
    const cursor = decoded as Record<string, unknown>
    if (Object.keys(cursor).length !== 2 || typeof cursor.createdAt !== 'string') invalidFilter('Invalid Sale cursor')
    const createdAt = parseTimestamp(cursor.createdAt, 'cursor timestamp')
    if (!createdAt || createdAt.toISOString() !== cursor.createdAt) invalidFilter('Invalid Sale cursor')
    return { createdAt, id: parseUuid(cursor.id, 'cursor id') }
  } catch (error) {
    if (error instanceof HttpError) throw error
    return invalidFilter('Invalid Sale cursor')
  }
}

export function parseSaleId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(422, 'INVALID_SALE_ID', 'saleId must be a UUID')
  }
  return value.toLowerCase()
}

export function parseSaleHistoryQuery(query: Record<string, unknown>): SaleHistoryQuery {
  const allowed = ['status', 'soldById', 'from', 'to', 'cursor', 'limit']
  if (Object.keys(query).some((key) => !allowed.includes(key))) invalidFilter('Unsupported Sale filter')
  let status: SaleHistoryQuery['status']
  if (query.status !== undefined) {
    if (query.status !== SaleStatus.COMPLETED && query.status !== SaleStatus.VOIDED) invalidFilter('Invalid Sale status')
    status = query.status
  }
  const from = parseTimestamp(query.from, 'from')
  const to = parseTimestamp(query.to, 'to')
  if (from && to && from > to) invalidFilter('from must not be after to')
  const soldById = query.soldById === undefined ? undefined : parseUuid(query.soldById, 'soldById')
  const cursor = parseCursor(query.cursor)
  return {
    ...(status ? { status } : {}), ...(soldById ? { soldById } : {}),
    ...(from ? { from } : {}), ...(to ? { to } : {}), ...(cursor ? { cursor } : {}),
    limit: parseLimit(query.limit),
  }
}

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
