import { createHash } from 'node:crypto'
import { HttpError } from '../errors/http-error.js'
import type { ReturnInput, ReturnLineInput } from './return.types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const maxReturnLines = 100
export const maxReturnQuantity = 1_000_000
export const maxReturnReasonCharacters = 2_000

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
