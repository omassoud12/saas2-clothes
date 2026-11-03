// OWNER settings the reports read: sales targets and closed days (holidays).
//   PUT    /api/business/targets          { period: WEEK|MONTH, periodStart, amount|null, storeId? }
//   GET    /api/business/closed-days?from&to
//   POST   /api/business/closed-days      { date, reason?, storeId? }
//   DELETE /api/business/closed-days/:date[?storeId]
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import { isCalendarDate, isoWeekday } from './business-dates.js'
import { resolveStoreIds, type AccountContext } from './business-stores.js'
import { validationError } from './report-common.js'

const amountPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/

function body(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw validationError('Body must be an object')
  const value = input as Record<string, unknown>
  const extra = Object.keys(value).find((key) => !allowed.includes(key))
  if (extra) throw validationError(`Unknown field: ${extra}`)
  return value
}

/** null = the whole account; otherwise one of the account's stores (403 otherwise). */
function storeOf(account: AccountContext, storeId: unknown): string | null {
  if (storeId === undefined || storeId === null || storeId === 'all') return null
  return resolveStoreIds(account, storeId)[0]!
}

export async function setTarget(prisma: PrismaClient, account: AccountContext, input: unknown) {
  const value = body(input, ['period', 'periodStart', 'amount', 'storeId'])
  if (value.period !== 'WEEK' && value.period !== 'MONTH') throw validationError('period must be WEEK or MONTH')
  if (!isCalendarDate(value.periodStart)) throw validationError('periodStart must be a date YYYY-MM-DD')
  if (value.period === 'WEEK' && isoWeekday(value.periodStart) !== 1) throw validationError('A weekly target starts on a Monday')
  if (value.period === 'MONTH' && !value.periodStart.endsWith('-01')) throw validationError('A monthly target starts on the 1st')
  if (value.amount !== null && (typeof value.amount !== 'string' || !amountPattern.test(value.amount))) throw validationError('amount must be a decimal string like "17000.00", or null to remove the target')
  const storeId = storeOf(account, value.storeId)
  const keys = Prisma.sql`"accountId" = ${account.accountId}::uuid AND "storeId" IS NOT DISTINCT FROM ${storeId}::uuid
    AND "period" = ${value.period}::"SalesTargetPeriod" AND "periodStart" = ${value.periodStart}::date`
  if (value.amount === null) {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "SalesTarget" WHERE ${keys}`)
    return { target: null }
  }
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "SalesTarget" ("id", "accountId", "storeId", "period", "periodStart", "amount", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${account.accountId}::uuid, ${storeId}::uuid, ${value.period}::"SalesTargetPeriod", ${value.periodStart}::date, ${value.amount}::numeric, now(), now())
    ON CONFLICT ("accountId", "storeId", "period", "periodStart") DO UPDATE SET "amount" = EXCLUDED."amount", "updatedAt" = now()`)
  return { target: { period: value.period, periodStart: value.periodStart, storeId, amount: new Prisma.Decimal(value.amount).toFixed(2) } }
}

export async function listClosedDays(prisma: PrismaClient, account: AccountContext, query: Record<string, unknown>) {
  if (!isCalendarDate(query.from) || !isCalendarDate(query.to) || query.from > query.to) throw validationError('from and to must be dates YYYY-MM-DD, from ≤ to')
  const rows = await prisma.$queryRaw<{ date: string; store: string | null; reason: string | null }[]>(Prisma.sql`
    SELECT "date"::text AS date, "storeId"::text AS store, "reason" FROM "ClosedDay"
    WHERE "accountId" = ${account.accountId}::uuid AND "date" BETWEEN ${query.from}::date AND ${query.to}::date ORDER BY 1`)
  return { items: rows.map((row) => ({ date: row.date, storeId: row.store, reason: row.reason })) }
}

export async function addClosedDay(prisma: PrismaClient, account: AccountContext, input: unknown) {
  const value = body(input, ['date', 'reason', 'storeId'])
  if (!isCalendarDate(value.date)) throw validationError('date must be YYYY-MM-DD')
  if (value.reason !== undefined && value.reason !== null && (typeof value.reason !== 'string' || value.reason.trim().length > 160)) throw validationError('reason must be text of at most 160 characters')
  const reason = typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : null
  const storeId = storeOf(account, value.storeId)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "ClosedDay" ("id", "accountId", "storeId", "date", "reason", "createdAt")
    VALUES (gen_random_uuid(), ${account.accountId}::uuid, ${storeId}::uuid, ${value.date}::date, ${reason}, now())
    ON CONFLICT ("accountId", "storeId", "date") DO UPDATE SET "reason" = EXCLUDED."reason"`)
  return { closedDay: { date: value.date, storeId, reason } }
}

export async function removeClosedDay(prisma: PrismaClient, account: AccountContext, date: string, storeIdParam: unknown) {
  if (!isCalendarDate(date)) throw validationError('date must be YYYY-MM-DD')
  const storeId = storeOf(account, storeIdParam)
  const removed = await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "ClosedDay" WHERE "accountId" = ${account.accountId}::uuid AND "date" = ${date}::date AND "storeId" IS NOT DISTINCT FROM ${storeId}::uuid`)
  if (!removed) throw new HttpError(404, 'CLOSED_DAY_NOT_FOUND', 'This day is not marked closed')
  return { removed: true }
}
