import { createHash } from 'node:crypto'
import { HttpError } from '../errors/http-error.js'
import { canonicalReturnItems, parseReturnInput } from '../returns/return.schemas.js'
import { canonicalSaleItems, parseSaleInput } from '../sales/sale.schemas.js'
import type { ExchangeInput } from './exchange.types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const exchangeChildNamespace = 'd01b1a2c-44b4-5a15-9ad0-c04d8d355fd1'

export function parseExchangeSaleId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(422, 'INVALID_EXCHANGE_SALE_ID', 'saleId must be a UUID')
  }
  return value.toLowerCase()
}

export function parseExchangeIdempotencyKey(headers: Record<string, unknown>, rawHeaders: readonly string[]): string {
  let count = 0
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'idempotency-key') count += 1
  }
  const value = headers['idempotency-key']
  if (count === 0 || value === undefined) {
    throw new HttpError(400, 'EXCHANGE_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required')
  }
  if (count !== 1 || typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(400, 'EXCHANGE_IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be one UUID')
  }
  return value.toLowerCase()
}

export function parseExchangeInput(body: unknown): ExchangeInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'INVALID_EXCHANGE_INPUT', 'Exchange input must be an object')
  }
  const value = body as Record<string, unknown>
  const allowed = ['reason', 'returnItems', 'replacementItems']
  if (Object.keys(value).some((key) => !allowed.includes(key)) ||
      !Object.hasOwn(value, 'returnItems') || !Object.hasOwn(value, 'replacementItems')) {
    throw new HttpError(422, 'INVALID_EXCHANGE_INPUT', 'Only reason, returnItems, and replacementItems are allowed')
  }
  const returned = parseReturnInput({ reason: value.reason, items: value.returnItems })
  const replacement = parseSaleInput({ items: value.replacementItems })
  return { reason: returned.reason, returnItems: returned.items, replacementItems: replacement.items }
}

export function exchangeFingerprint(
  accountId: string,
  actorId: string,
  originalSaleId: string,
  input: ExchangeInput,
): string {
  const canonical = {
    type: 'EXCHANGE',
    accountId: accountId.toLowerCase(),
    actorId: actorId.toLowerCase(),
    originalSaleId: originalSaleId.toLowerCase(),
    reason: input.reason,
    returnItems: canonicalReturnItems(input.returnItems).map((item) => ({
      saleItemId: item.saleItemId.toLowerCase(), quantity: item.quantity,
    })),
    replacementItems: canonicalSaleItems(input.replacementItems).map((item) => ({
      variantId: item.variantId.toLowerCase(), quantity: item.quantity, unitSoldPrice: item.unitSoldPrice,
    })),
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll('-', ''), 'hex')
}

/** RFC 4122 UUIDv5 used only for deterministic internal child operation keys. */
export function deterministicExchangeChildKey(exchangeKey: string, child: 'return' | 'sale'): string {
  const digest = createHash('sha1')
    .update(uuidBytes(exchangeChildNamespace))
    .update(`exchange:${exchangeKey.toLowerCase()}:${child}`, 'utf8')
    .digest()
    .subarray(0, 16)
  digest[6] = (digest[6]! & 0x0f) | 0x50
  digest[8] = (digest[8]! & 0x3f) | 0x80
  const hex = digest.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Signed 64-bit key for PostgreSQL's transaction-scoped advisory lock. */
export function exchangeAdvisoryKey(accountId: string, idempotencyKey: string): bigint {
  return createHash('sha256')
    .update(`${accountId.toLowerCase()}:${idempotencyKey.toLowerCase()}`, 'utf8')
    .digest()
    .readBigInt64BE(0)
}
