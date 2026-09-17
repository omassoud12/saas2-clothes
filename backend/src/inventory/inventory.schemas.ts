import { InventoryMovementType } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseCatalogId } from '../products/product.schemas.js'
import type { HistoryQuery, ReconciliationQuery } from './inventory.types.js'

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const movementTypes = new Set<string>(Object.values(InventoryMovementType))

function invalid(message: string): never {
  throw new HttpError(422, 'INVALID_INVENTORY_FILTER', message)
}

function onlyKeys(query: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(query).some((key) => !allowed.includes(key))) invalid('Unsupported inventory filter')
}

function limit(value: unknown): number {
  if (value === undefined) return 25
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) invalid('limit must be a positive integer')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 100) invalid('limit must be at most 100')
  return parsed
}

function timestamp(value: unknown, name: string): Date | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !timestampPattern.test(value)) invalid(`${name} must be a UTC timestamp`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) invalid(`${name} must be a valid timestamp`)
  const [seconds, fraction = ''] = value.slice(0, -1).split('.')
  if (date.toISOString() !== `${seconds}.${fraction.padEnd(3, '0')}Z`) invalid(`${name} must be a valid timestamp`)
  return date
}

function decodeCursor(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid('Invalid inventory cursor')
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) invalid('Invalid inventory cursor')
    return decoded as Record<string, unknown>
  } catch { return invalid('Invalid inventory cursor') }
}

export function encodeHistoryCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url')
}

export function encodeReconciliationCursor(sku: string): string {
  return Buffer.from(JSON.stringify({ sku })).toString('base64url')
}

export function parseHistoryQuery(query: Record<string, unknown>): HistoryQuery {
  onlyKeys(query, ['productId', 'variantId', 'type', 'from', 'to', 'cursor', 'limit'])
  const from = timestamp(query.from, 'from')
  const to = timestamp(query.to, 'to')
  if (from && to && from > to) invalid('from must not be after to')
  let type: InventoryMovementType | undefined
  if (query.type !== undefined) {
    if (typeof query.type !== 'string' || !movementTypes.has(query.type)) invalid('Invalid movement type')
    type = query.type as InventoryMovementType
  }
  const rawCursor = decodeCursor(query.cursor)
  let cursor: HistoryQuery['cursor']
  if (rawCursor) {
    if (Object.keys(rawCursor).length !== 2 || typeof rawCursor.createdAt !== 'string' || typeof rawCursor.id !== 'string') invalid('Invalid inventory cursor')
    const parsed = timestamp(rawCursor.createdAt, 'cursor timestamp')
    if (!parsed || parsed.toISOString() !== rawCursor.createdAt) invalid('Invalid inventory cursor')
    if (!uuidPattern.test(rawCursor.id)) invalid('Invalid inventory cursor')
    cursor = { createdAt: parsed, id: rawCursor.id.toLowerCase() }
  }
  return {
    ...(query.productId !== undefined ? { productId: parseCatalogId(query.productId, 'productId') } : {}),
    ...(query.variantId !== undefined ? { variantId: parseCatalogId(query.variantId, 'variantId') } : {}),
    ...(type ? { type } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}),
    ...(cursor ? { cursor } : {}), limit: limit(query.limit),
  }
}

export function parseReconciliationQuery(query: Record<string, unknown>): ReconciliationQuery {
  onlyKeys(query, ['productId', 'variantId', 'status', 'cursor', 'limit'])
  if (query.status !== undefined && query.status !== 'RECONCILED' && query.status !== 'MISMATCH') invalid('Invalid reconciliation status')
  const rawCursor = decodeCursor(query.cursor)
  let cursor: string | undefined
  if (rawCursor) {
    if (Object.keys(rawCursor).length !== 1 || typeof rawCursor.sku !== 'string' || !rawCursor.sku || [...rawCursor.sku].length > 100) invalid('Invalid inventory cursor')
    cursor = rawCursor.sku
  }
  return {
    ...(query.productId !== undefined ? { productId: parseCatalogId(query.productId, 'productId') } : {}),
    ...(query.variantId !== undefined ? { variantId: parseCatalogId(query.variantId, 'variantId') } : {}),
    ...(query.status ? { status: query.status as 'RECONCILED' | 'MISMATCH' } : {}),
    ...(cursor ? { cursor } : {}), limit: limit(query.limit),
  }
}
