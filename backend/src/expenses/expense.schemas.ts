import { Prisma } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import type { ExpenseHistoryQuery, ExpenseInput } from './expense.types.js'

const amountPattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const maxExpenseDescriptionCharacters = 2_000

function invalidInput(code: string, message: string): never {
  throw new HttpError(422, code, message)
}

function invalidFilter(message: string): never {
  throw new HttpError(422, 'INVALID_EXPENSE_FILTER', message)
}

function parseDate(value: unknown, name: string, invalid: (message: string) => never): Date {
  if (typeof value !== 'string' || !datePattern.test(value)) {
    return invalid(`${name} must use YYYY-MM-DD`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return invalid(`${name} must be a valid calendar date`)
  }
  return date
}

export function formatExpenseDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function parseExpenseInput(body: unknown): ExpenseInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalidInput('INVALID_EXPENSE_INPUT', 'Expense input must be an object')
  }
  const input = body as Record<string, unknown>
  const allowed = ['amount', 'description', 'expenseDate']
  if (Object.keys(input).some((key) => !allowed.includes(key)) ||
      allowed.some((key) => !Object.hasOwn(input, key))) {
    invalidInput('INVALID_EXPENSE_INPUT', 'Only amount, description, and expenseDate are allowed')
  }
  if (typeof input.amount !== 'string' || !amountPattern.test(input.amount)) {
    invalidInput('INVALID_EXPENSE_AMOUNT', 'amount must be a positive decimal string with at most two places')
  }
  const amount = new Prisma.Decimal(input.amount)
  if (!amount.gt(0)) {
    invalidInput('INVALID_EXPENSE_AMOUNT', 'amount must be greater than zero')
  }
  if (typeof input.description !== 'string') {
    invalidInput('INVALID_EXPENSE_DESCRIPTION', 'description must be a string')
  }
  const description = input.description.normalize('NFC').trim()
  if (!description) {
    invalidInput('INVALID_EXPENSE_DESCRIPTION', 'description must not be blank')
  }
  if ([...description].length > maxExpenseDescriptionCharacters) {
    invalidInput(
      'INVALID_EXPENSE_DESCRIPTION',
      `description must not exceed ${maxExpenseDescriptionCharacters} characters`,
    )
  }
  const expenseDate = parseDate(
    input.expenseDate,
    'expenseDate',
    (message) => invalidInput('INVALID_EXPENSE_DATE', message),
  )
  return { amount: amount.toFixed(2), description, expenseDate }
}

export function encodeExpenseCursor(expenseDate: Date, id: string): string {
  return Buffer.from(JSON.stringify({ expenseDate: formatExpenseDate(expenseDate), id })).toString('base64url')
}

function parseCursor(value: unknown): ExpenseHistoryQuery['cursor'] {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    invalidFilter('Invalid Expense cursor')
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) invalidFilter('Invalid Expense cursor')
    const cursor = decoded as Record<string, unknown>
    if (Object.keys(cursor).length !== 2 || typeof cursor.id !== 'string' || !uuidPattern.test(cursor.id)) {
      invalidFilter('Invalid Expense cursor')
    }
    return {
      expenseDate: parseDate(cursor.expenseDate, 'cursor expenseDate', invalidFilter),
      id: cursor.id.toLowerCase(),
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    return invalidFilter('Invalid Expense cursor')
  }
}

export function parseExpenseHistoryQuery(query: Record<string, unknown>): ExpenseHistoryQuery {
  if (Object.keys(query).some((key) => !['from', 'to', 'cursor', 'limit'].includes(key))) {
    invalidFilter('Unsupported Expense filter')
  }
  let limit = 25
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d*$/.test(query.limit)) {
      invalidFilter('limit must be a positive integer')
    }
    limit = Number(query.limit)
    if (!Number.isSafeInteger(limit) || limit > 100) invalidFilter('limit must be at most 100')
  }
  const from = query.from === undefined ? undefined : parseDate(query.from, 'from', invalidFilter)
  const to = query.to === undefined ? undefined : parseDate(query.to, 'to', invalidFilter)
  if (from && to && from > to) invalidFilter('from must not be after to')
  const cursor = parseCursor(query.cursor)
  return {
    limit,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(cursor ? { cursor } : {}),
  }
}
