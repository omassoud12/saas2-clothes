import { HttpError } from '../errors/http-error.js'
import type { ExchangeHistoryQuery } from './exchange.types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

function invalid(message: string): never {
  throw new HttpError(422, 'INVALID_EXCHANGE_HISTORY_FILTER', message)
}

export function parseExchangeId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(422, 'INVALID_EXCHANGE_ID', 'exchangeId must be a UUID')
  }
  return value.toLowerCase()
}

export function encodeExchangeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url')
}

function parseTimestamp(value: unknown, name: string): Date {
  if (typeof value !== 'string' || !timestampPattern.test(value)) invalid(`${name} must be a UTC timestamp`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) invalid(`${name} must be a valid timestamp`)
  const [seconds, fraction = ''] = value.slice(0, -1).split('.')
  if (date.toISOString() !== `${seconds}.${fraction.padEnd(3, '0')}Z`) invalid(`${name} must be a valid timestamp`)
  return date
}

export function parseExchangeHistoryQuery(query: Record<string, unknown>): ExchangeHistoryQuery {
  if (Object.keys(query).some((key) => !['from', 'to', 'cursor', 'limit'].includes(key))) {
    invalid('Unsupported Exchange history filter')
  }
  let limit = 25
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d*$/.test(query.limit)) invalid('limit must be a positive integer')
    limit = Number(query.limit)
    if (!Number.isSafeInteger(limit) || limit > 100) invalid('limit must be at most 100')
  }
  const from = query.from === undefined ? undefined : parseTimestamp(query.from, 'from')
  const to = query.to === undefined ? undefined : parseTimestamp(query.to, 'to')
  if (from && to && from > to) invalid('from must not be after to')

  let cursor: ExchangeHistoryQuery['cursor']
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string' || query.cursor.length > 500 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) {
      invalid('Invalid Exchange cursor')
    }
    try {
      const decoded: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) invalid('Invalid Exchange cursor')
      const state = decoded as Record<string, unknown>
      if (Object.keys(state).length !== 2 || typeof state.id !== 'string' || !uuidPattern.test(state.id)) {
        invalid('Invalid Exchange cursor')
      }
      const createdAt = parseTimestamp(state.createdAt, 'cursor timestamp')
      if (createdAt.toISOString() !== state.createdAt) invalid('Invalid Exchange cursor')
      cursor = { createdAt, id: state.id.toLowerCase() }
    } catch (error) {
      if (error instanceof HttpError) throw error
      invalid('Invalid Exchange cursor')
    }
  }
  return { limit, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(cursor ? { cursor } : {}) }
}
