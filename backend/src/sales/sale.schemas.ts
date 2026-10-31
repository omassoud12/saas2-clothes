import { createHash } from 'node:crypto'
import { Prisma } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import { SaleStatus } from '../generated/prisma/enums.js'
import type { PaymentMethodValue, SaleCustomerInput, SaleHistoryQuery, SaleInput, SaleLineInput, SalePayInput, SaleVoidInput } from './sale.types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pricePattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
export const maxSaleLines = 100
export const maxSaleQuantity = 1_000_000
export const maxSaleVoidReasonCharacters = 2_000
export const maxCustomerNameCharacters = 120
export const maxCustomerPhoneCharacters = 30
export const PAYMENT_METHODS: readonly PaymentMethodValue[] = ['CASH', 'CARD', 'WHISH_OMT', 'DEBT']
const percentPattern = /^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/
const phonePattern = /^[+()\d][\d\s().-]*$/

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

export function parseSaleVoidInput(body: unknown): SaleVoidInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'INVALID_SALE_VOID_INPUT', 'Sale Void input must be an object')
  }
  const input = body as Record<string, unknown>
  if (Object.keys(input).some((key) => key !== 'reason') || !Object.hasOwn(input, 'reason')) {
    throw new HttpError(422, 'INVALID_SALE_VOID_INPUT', 'Only reason is allowed')
  }
  if (typeof input.reason !== 'string') {
    throw new HttpError(422, 'INVALID_SALE_VOID_REASON', 'reason must be a string')
  }
  const reason = input.reason.normalize('NFC').trim()
  if (!reason) {
    throw new HttpError(422, 'INVALID_SALE_VOID_REASON', 'reason must not be blank')
  }
  if ([...reason].length > maxSaleVoidReasonCharacters) {
    throw new HttpError(422, 'INVALID_SALE_VOID_REASON', `reason must not exceed ${maxSaleVoidReasonCharacters} characters`)
  }
  return { reason }
}

export function parseSaleHistoryQuery(query: Record<string, unknown>): SaleHistoryQuery {
  const allowed = ['status', 'soldById', 'from', 'to', 'cursor', 'limit', 'returned', 'paymentMethod', 'unpaid']
  if (Object.keys(query).some((key) => !allowed.includes(key))) invalidFilter('Unsupported Sale filter')
  if (query.returned !== undefined && query.returned !== 'true') invalidFilter('returned must be true')
  if (query.unpaid !== undefined && query.unpaid !== 'true') invalidFilter('unpaid must be true')
  let paymentMethod: PaymentMethodValue | undefined
  if (query.paymentMethod !== undefined) {
    if (typeof query.paymentMethod !== 'string' || !PAYMENT_METHODS.includes(query.paymentMethod as PaymentMethodValue)) invalidFilter('Invalid payment method')
    paymentMethod = query.paymentMethod as PaymentMethodValue
  }
  if (query.unpaid === 'true') {
    if (paymentMethod && paymentMethod !== 'DEBT') invalidFilter('unpaid only applies to DEBT sales')
    if (query.status === SaleStatus.VOIDED) invalidFilter('unpaid only applies to COMPLETED sales')
  }
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
    ...(query.returned === 'true' ? { returned: true as const } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(query.unpaid === 'true' ? { unpaid: true as const } : {}),
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

function parseCustomer(value: unknown): SaleCustomerInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, 'INVALID_SALE_CUSTOMER', 'customer must be an object')
  }
  const customer = value as Record<string, unknown>
  if (Object.keys(customer).some((key) => key !== 'name' && key !== 'phone')) {
    throw new HttpError(422, 'INVALID_SALE_CUSTOMER', 'Only name and phone are allowed')
  }
  if (typeof customer.name !== 'string') throw new HttpError(422, 'INVALID_SALE_CUSTOMER', 'customer name must be a string')
  const name = customer.name.normalize('NFC').trim()
  if (!name || [...name].length > maxCustomerNameCharacters) {
    throw new HttpError(422, 'INVALID_SALE_CUSTOMER', `customer name must be 1 to ${maxCustomerNameCharacters} characters`)
  }
  let phone: string | null = null
  if (customer.phone !== undefined && customer.phone !== null && customer.phone !== '') {
    if (typeof customer.phone !== 'string') throw new HttpError(422, 'INVALID_SALE_CUSTOMER', 'customer phone must be a string')
    const trimmed = customer.phone.trim()
    if ([...trimmed].length > maxCustomerPhoneCharacters || !phonePattern.test(trimmed)) {
      throw new HttpError(422, 'INVALID_SALE_CUSTOMER', 'customer phone is not a valid phone number')
    }
    phone = trimmed
  }
  return { name, phone }
}

export function parseSaleInput(body: unknown): SaleInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'INVALID_SALE_INPUT', 'Sale input must be an object')
  }
  const input = body as Record<string, unknown>
  const allowedKeys = ['items', 'paymentMethod', 'customer', 'discountPercent']
  if (Object.keys(input).some((key) => !allowedKeys.includes(key)) || !Object.hasOwn(input, 'items') || !Array.isArray(input.items)) {
    throw new HttpError(422, 'INVALID_SALE_INPUT', 'Only items, paymentMethod, customer and discountPercent are allowed')
  }
  let paymentMethod: PaymentMethodValue = 'CASH'
  if (input.paymentMethod !== undefined) {
    if (typeof input.paymentMethod !== 'string' || !PAYMENT_METHODS.includes(input.paymentMethod as PaymentMethodValue)) {
      throw new HttpError(422, 'INVALID_SALE_PAYMENT_METHOD', 'paymentMethod must be CASH, CARD, WHISH_OMT or DEBT')
    }
    paymentMethod = input.paymentMethod as PaymentMethodValue
  }
  const customer = input.customer === undefined || input.customer === null ? undefined : parseCustomer(input.customer)
  if (paymentMethod === 'DEBT' && !customer) {
    throw new HttpError(422, 'SALE_DEBT_CUSTOMER_REQUIRED', 'A debt sale needs the customer name')
  }
  let discountPercent: string | undefined
  if (input.discountPercent !== undefined) {
    if (typeof input.discountPercent !== 'string' || !percentPattern.test(input.discountPercent)) {
      throw new HttpError(422, 'INVALID_SALE_DISCOUNT', 'discountPercent must be a decimal string from 0 to 100 with at most two places')
    }
    const percent = new Prisma.Decimal(input.discountPercent)
    if (percent.gt(0)) discountPercent = percent.toFixed(2)
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
  return {
    items,
    ...(paymentMethod !== 'CASH' ? { paymentMethod } : {}),
    ...(customer ? { customer } : {}),
    ...(discountPercent ? { discountPercent } : {}),
  }
}

export function parseSalePayInput(body: unknown): SalePayInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, 'INVALID_SALE_PAY_INPUT', 'Sale payment input must be an object')
  }
  const input = body as Record<string, unknown>
  if (Object.keys(input).some((key) => key !== 'confirm') || input.confirm !== true) {
    throw new HttpError(422, 'INVALID_SALE_PAY_INPUT', 'Only confirm: true is allowed')
  }
  return { confirm: true }
}

export function canonicalSaleItems(items: readonly SaleLineInput[]): readonly SaleLineInput[] {
  return [...items].sort((left, right) => left.variantId.localeCompare(right.variantId))
}

// The commercial extras join the fingerprint only when they are not the default (CASH, no customer, no discount), so
// the fingerprint of a plain cash Sale is the same as before these fields existed.
export function saleFingerprint(
  accountId: string,
  soldById: string,
  items: readonly SaleLineInput[],
  extras: Pick<SaleInput, 'paymentMethod' | 'customer' | 'discountPercent'> = {},
): string {
  const canonical = {
    accountId: accountId.toLowerCase(),
    soldById: soldById.toLowerCase(),
    items: canonicalSaleItems(items).map((item) => ({
      variantId: item.variantId.toLowerCase(),
      quantity: item.quantity,
      unitSoldPrice: item.unitSoldPrice,
    })),
    ...(extras.paymentMethod && extras.paymentMethod !== 'CASH' ? { paymentMethod: extras.paymentMethod } : {}),
    ...(extras.customer ? { customer: { name: extras.customer.name, phone: extras.customer.phone } } : {}),
    ...(extras.discountPercent ? { discountPercent: extras.discountPercent } : {}),
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}
