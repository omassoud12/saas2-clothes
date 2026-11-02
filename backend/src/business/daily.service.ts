// GET /api/business/daily and GET /api/business/daily/invoices (docs/API.md in business-reference).
import { Prisma } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import { shiftDate } from './business-dates.js'
import { dayHours, rangeTotals } from './day-totals.js'
import { fmt, ownerMoney, parseDateParam, paymentSplit, productRows, staffRows, validationError, type ReportContext } from './report-common.js'

export async function dailyReport(ctx: ReportContext, query: Record<string, unknown>) {
  const date = parseDateParam(query.date, 'date', ctx.now.date)
  const live = date === ctx.now.date
  const cut = live ? ctx.now.minute : null
  const today = ctx.now.date
  const [day, previous, lastWeek, hours] = await Promise.all([
    rangeTotals(ctx.prisma, ctx.scope, date, date, { today }),
    rangeTotals(ctx.prisma, ctx.scope, shiftDate(date, -1), shiftDate(date, -1), { today, cutLastDayAt: cut, breakdowns: false }),
    rangeTotals(ctx.prisma, ctx.scope, shiftDate(date, -7), shiftDate(date, -7), { today, cutLastDayAt: cut, breakdowns: false }),
    dayHours(ctx.prisma, ctx.scope, date, null),
  ])
  const totals = day.totals
  // Shop hours: from the first hour with sales (10:00 at the latest) to the last one (21:00 at the earliest),
  // up to the current hour while the day is live.
  const soldHours = [...hours.keys()]
  let first = Math.min(10, ...soldHours)
  let last = Math.max(21, ...soldHours)
  if (live) last = Math.min(last, Math.floor(ctx.now.minute / 60))
  if (first > last) first = last
  const byHour = []
  for (let hour = first; hour <= last; hour += 1) byHour.push({ hour, salesTotal: fmt(hours.get(hour) ?? new Prisma.Decimal(0)) })

  const [byStaff, products] = await Promise.all([staffRows(ctx, day.staff), productRows(ctx, day.variants)])
  return {
    date,
    timezone: ctx.account.timezone,
    currency: ctx.account.baseCurrency,
    exchangeRate: ctx.account.exchangeRate,
    live,
    asOf: live ? ctx.now.hhmm : null,
    closed: day.closed.has(date),
    salesTotal: fmt(totals.salesTotal),
    costTotal: ownerMoney(ctx, totals.costTotal),
    profitTotal: ownerMoney(ctx, totals.salesTotal.sub(totals.costTotal)),
    costComplete: !totals.costMissing,
    invoiceCount: totals.invoiceCount,
    piecesSold: totals.piecesSold,
    discountsTotal: fmt(totals.discountsTotal),
    returns: { count: totals.returnsCount, amountTotal: fmt(totals.returnsTotal) },
    previousDay: { date: shiftDate(date, -1), salesTotal: fmt(previous.totals.salesTotal), invoiceCount: previous.totals.invoiceCount },
    sameWeekdayLastWeek: { date: shiftDate(date, -7), salesTotal: fmt(lastWeek.totals.salesTotal), invoiceCount: lastWeek.totals.invoiceCount },
    paymentSplit: paymentSplit(totals),
    byStaff,
    products,
    byHour,
  }
}

interface InvoiceRow {
  id: string; number: number | null; created_at: Date; items: number; total: string; method: string; status: string
  staff_id: string; staff_name: string; customer: string | null
}

function encodeCursor(row: { created_at: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ c: row.created_at.toISOString(), i: row.id })).toString('base64url')
}

function decodeCursor(cursor: unknown): { c: string; i: string } | null {
  if (cursor === undefined || cursor === null || cursor === '') return null
  try {
    if (typeof cursor !== 'string' || cursor.length > 200) throw new Error('bad')
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { c?: unknown; i?: unknown }
    if (typeof value.c !== 'string' || Number.isNaN(Date.parse(value.c)) || typeof value.i !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.i)) throw new Error('bad')
    return { c: value.c, i: value.i }
  } catch {
    throw validationError('cursor is not valid')
  }
}

/** Invoices of one day, newest first, keyset pagination on (createdAt, id). Never includes cost. */
export async function dailyInvoices(ctx: ReportContext, query: Record<string, unknown>) {
  const date = parseDateParam(query.date, 'date', ctx.now.date)
  const method = query.method === undefined || query.method === '' || query.method === 'all' ? null : query.method
  if (method !== null && method !== 'CASH' && method !== 'WHISH') throw validationError('method must be CASH or WHISH')
  const rawLimit = query.limit === undefined || query.limit === '' ? 10 : Number(query.limit)
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) throw validationError('limit must be between 1 and 50')
  const q = typeof query.q === 'string' ? query.q.trim().replace(/^#/, '') : ''
  if (q.length > 60) throw validationError('q is too long')
  const cursor = decodeCursor(query.cursor)
  const store = ctx.account.stores.find((row) => ctx.scope.storeIds.includes(row.id))
  if (!store) throw new HttpError(403, 'STORE_FORBIDDEN', 'You do not have access to this store')

  const tz = ctx.scope.timezone
  const rows = await ctx.prisma.$queryRaw<InvoiceRow[]>(Prisma.sql`
    SELECT s."id"::text AS id, s."receiptNumber" AS number, s."createdAt" AS created_at,
           (SELECT COALESCE(SUM(si."quantity"), 0)::int FROM "SaleItem" si WHERE si."saleId" = s."id" AND si."accountId" = s."accountId") AS items,
           s."totalAmount"::text AS total, s."paymentMethod"::text AS method, s."status"::text AS status,
           s."soldById"::text AS staff_id, s."sellerNameAtSale" AS staff_name, s."customerName" AS customer
    FROM "Sale" s
    WHERE s."accountId" = ${ctx.scope.accountId}::uuid
      AND s."createdAt" >= ((${date}::date)::timestamp AT TIME ZONE ${tz})
      AND s."createdAt" < ((${date}::date + 1)::timestamp AT TIME ZONE ${tz})
      ${method === 'CASH' ? Prisma.sql`AND s."paymentMethod" = 'CASH'` : method === 'WHISH' ? Prisma.sql`AND s."paymentMethod" = 'WHISH_OMT'` : Prisma.empty}
      ${q ? Prisma.sql`AND (s."receiptNumber"::text LIKE ${`%${q.replace(/[%_\\]/g, '\\$&')}%`} OR s."customerName" ILIKE ${`%${q.replace(/[%_\\]/g, '\\$&')}%`})` : Prisma.empty}
      ${cursor ? Prisma.sql`AND (s."createdAt", s."id") < (${new Date(cursor.c)}::timestamptz, ${cursor.i}::uuid)` : Prisma.empty}
    ORDER BY s."createdAt" DESC, s."id" DESC
    LIMIT ${rawLimit + 1}`)
  const page = rows.slice(0, rawLimit)
  return {
    items: page.map((row) => ({
      id: row.id,
      number: row.number,
      createdAt: row.created_at.toISOString(),
      itemCount: Number(row.items),
      total: new Prisma.Decimal(row.total).toFixed(2),
      paymentMethod: row.method === 'WHISH_OMT' ? 'WHISH' : row.method,
      status: row.status,
      staff: { id: row.staff_id, name: row.staff_name },
      store: { id: store.id, name: store.name },
      customerName: row.customer,
    })),
    nextCursor: rows.length > rawLimit ? encodeCursor(page[page.length - 1]!) : null,
  }
}
