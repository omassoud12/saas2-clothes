import { createHash } from 'node:crypto'
import { HttpError } from '../errors/http-error.js'
import type { ReturnHistoryQuery, ReturnInput, ReturnLineInput } from './return.types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const maxReturnLines = 100
export const maxReturnQuantity = 1_000_000
export const maxReturnReasonCharacters = 2_000

function invalidHistoryFilter(message: string): never {
  throw new HttpError(422, 'INVALID_RETURN_HISTORY_FILTER', message)
}

export function encodeReturnCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url')
}

export function parseReturnHistoryQuery(query: Record<string, unknown>): ReturnHistoryQuery {
  if (Object.keys(query).some((key) => key !== 'cursor' && key !== 'limit')) {
    invalidHistoryFilter('Unsupported Return history filter')
  }
  let limit = 25
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d*$/.test(query.limit)) {
      invalidHistoryFilter('limit must be a positive integer')
    }
    limit = Number(query.limit)
    if (!Number.isSafeInteger(limit) || limit > 100) invalidHistoryFilter('limit must be at most 100')
  }
  if (query.cursor === undefined) return { limit }
  if (typeof query.cursor !== 'string' || query.cursor.length > 500 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) {
    invalidHistoryFilter('Invalid Return cursor')
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) invalidHistoryFilter('Invalid Return cursor')
    const cursor = decoded as Record<string, unknown>
    if (Object.keys(cursor).length !== 2 || typeof cursor.createdAt !== 'string' ||
        typeof cursor.id !== 'string' || !uuidPattern.test(cursor.id)) {
      invalidHistoryFilter('Invalid Return cursor')
    }
    const createdAt = new Date(cursor.createdAt)
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== cursor.createdAt) {
      invalidHistoryFilter('Invalid Return cursor')
    }
    return { limit, cursor: { createdAt, id: cursor.id.toLowerCase() } }
  } catch (error) {
    if (error instanceof HttpError) throw error
    return invalidHistoryFilter('Invalid Return cursor')
  }
}

export function parseReturnIdempotencyKey(headers: Record<string, unknown>, rawHeaders: readonly string[]): string {
  let count = 0
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'idempotency-key') count += 1
  }
  const value = headers['idempotency-key']
  if (count === 0 || value === undefined) {
    throw new HttpError(400, 'RETURN_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required')
  }
  if (count !== 1 || typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(400, 'RETURN_IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be one UUID')
  }
  return value.toLowerCase()
}

export function parseReturnSaleId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(422, 'INVALID_RETURN_SALE_ID', 'saleId must be a UUID')
  }
  return value.toLowerCase()
}

function parseReason(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new HttpError(422, 'INVALID_RETURN_REASON', 'reason must be a string or null')
  }
  const reason = value.normalize('NFC').trim() || null
  if (reason !== null && [...reason].length > maxReturnReasonCharacters) {
    throw new HttpError(422, 'INVALID_RETURN_REASON', `reason must not exceed ${maxReturnReasonCharacters} characters`)
  }
  return reason
}

function parseLine(value: unknown): ReturnLineInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, 'INVALID_RETURN_ITEM', 'Each Return item must be an object')
  }
  const item = value as Record<string, unknown>
  const allowed = ['saleItemId', 'quantity']
  if (Object.keys(item).some((key) => !allowed.includes(key)) || allowed.some((key) => !Object.hasOwn(item, key))) {
    throw new HttpError(422, 'INVALID_RETURN_ITEM', 'Only saleItemId and quantity are allowed')
  }
  if (typeof item.saleItemId !== 'string' || !uuidPattern.test(item.saleItemId)) {
    throw new HttpError(422, 'INVALID_RETURN_SALE_ITEM_ID', 'saleItemId must be a UUID')
  }
  if (typeof item.quantity !== 'number' || !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 || item.quantity > maxReturnQuantity) {
    throw new HttpError(422, 'INVALID_RETURN_QUANTITY', `quantity must be an integer from 1 to ${maxReturnQuantity}`)
  }
  return { saleItemId: item.saleItemId.toLowerCase(), quantity: item.quantity }
}

export function parseReturnInput(body: unknown): ReturnInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'INVALID_RETURN_INPUT', 'Return input must be an object')
  }
  const input = body as Record<string, unknown>
  if (Object.keys(input).some((key) => !['reason', 'items'].includes(key)) ||
      !Object.hasOwn(input, 'items') || !Array.isArray(input.items)) {
    throw new HttpError(422, 'INVALID_RETURN_INPUT', 'Only reason and an items array are allowed')
  }
  if (input.items.length === 0) {
    throw new HttpError(422, 'RETURN_ITEMS_EMPTY', 'Return must contain at least one item')
  }
  if (input.items.length > maxReturnLines) {
    throw new HttpError(422, 'RETURN_ITEMS_TOO_LARGE', `Return must not exceed ${maxReturnLines} items`)
  }
  const items = input.items.map(parseLine)
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.saleItemId)) {
      throw new HttpError(422, 'RETURN_DUPLICATE_SALE_ITEM', 'Each SaleItem may appear only once in a Return')
    }
    seen.add(item.saleItemId)
  }
  return { reason: parseReason(input.reason), items }
}

export function canonicalReturnItems(items: readonly ReturnLineInput[]): readonly ReturnLineInput[] {
  return [...items].sort((left, right) => left.saleItemId.localeCompare(right.saleItemId))
}

export function returnFingerprint(accountId: string, processedById: string, saleId: string, input: ReturnInput): string {
  const canonical = {
    type: 'RETURN',
    accountId: accountId.toLowerCase(),
    processedById: processedById.toLowerCase(),
    saleId: saleId.toLowerCase(),
    items: canonicalReturnItems(input.items).map((item) => ({
      saleItemId: item.saleItemId.toLowerCase(),
      quantity: item.quantity,
    })),
    reason: input.reason,
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}
