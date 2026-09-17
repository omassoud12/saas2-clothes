import { createHash } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import type { RestockInput } from './restock.types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const costPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/
const maxQuantity = 1_000_000
const maxNoteCharacters = 500

export function parseIdempotencyKey(headers: Record<string, unknown>, rawHeaders: readonly string[]): string {
  let count = 0
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'idempotency-key') count += 1
  }
  const value = headers['idempotency-key']
  if (count === 0 || value === undefined) {
    throw new HttpError(400, 'RESTOCK_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required')
  }
  if (count !== 1 || typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(400, 'RESTOCK_IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be one UUID')
  }
  return value.toLowerCase()
}

export function parseRestockInput(body: unknown): RestockInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'INVALID_RESTOCK_INPUT', 'Restock input must be an object')
  }
  const input = body as Record<string, unknown>
  if (Object.keys(input).some((key) => !['quantity', 'unitCost', 'note'].includes(key)) ||
      !Object.hasOwn(input, 'quantity') || !Object.hasOwn(input, 'unitCost')) {
    throw new HttpError(422, 'INVALID_RESTOCK_INPUT', 'Only quantity, unitCost, and note are allowed')
  }
  const quantity = input.quantity
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > maxQuantity) {
    throw new HttpError(422, 'INVALID_RESTOCK_QUANTITY', `quantity must be an integer from 1 to ${maxQuantity}`)
  }
  if (typeof input.unitCost !== 'string' || !costPattern.test(input.unitCost)) {
    throw new HttpError(422, 'INVALID_RESTOCK_UNIT_COST', 'unitCost must be a positive decimal string with at most four places')
  }
  const cost = new Prisma.Decimal(input.unitCost)
  if (!cost.gt(0)) {
    throw new HttpError(422, 'INVALID_RESTOCK_UNIT_COST', 'unitCost must be greater than zero')
  }
  let note: string | null = null
  if (Object.hasOwn(input, 'note') && input.note !== null) {
    if (typeof input.note !== 'string') {
      throw new HttpError(422, 'INVALID_RESTOCK_NOTE', 'note must be a string or null')
    }
    note = input.note.normalize('NFC').trim() || null
    if (note !== null && [...note].length > maxNoteCharacters) {
      throw new HttpError(422, 'INVALID_RESTOCK_NOTE', `note must not exceed ${maxNoteCharacters} characters`)
    }
  }
  return { quantity, unitCost: cost.toFixed(4), note }
}

export function restockFingerprint(accountId: string, performedById: string, variantId: string, input: RestockInput): string {
  const canonical = {
    type: 'RESTOCK',
    accountId: accountId.toLowerCase(),
    performedById: performedById.toLowerCase(),
    variantId: variantId.toLowerCase(),
    quantity: input.quantity,
    unitCost: input.unitCost,
    note: input.note,
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}
