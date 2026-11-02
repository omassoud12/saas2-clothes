// THE one definition of a business day's numbers. Daily, Weekly, Monthly and Yearly all read this module:
//   * computeDays()  — raw sales → per-day numbers (one SQL per breakdown, grouped by shop-local date);
//   * rollupDays()   — stores computeDays() for finished days in the rollup tables (idempotent);
//   * liveDay()      — one day straight from raw sales, optionally cut at a time of day ("by this time");
//   * rangeTotals()  — finished days from the rollups + today (or a cut day) from liveDay().
//
// A day is [date 00:00, date+1 00:00) in the account timezone, computed in Postgres with AT TIME ZONE
// (DST safe). Completed sales only (voided excluded). Money is net of returns made that day, and the cost
// of returned goods is removed too. Cost = quantity × unit cost at time of sale (SaleItem.unitCostAtSale).
// costMissing when any line counted that day has no cost. Pieces = quantity sold (gross).
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { dateRange, shiftDate } from './business-dates.js'

type Db = PrismaClient | Prisma.TransactionClient
const Decimal = Prisma.Decimal
type Money = Prisma.Decimal
const zero = (): Money => new Decimal(0)

export interface DayNumbers {
  readonly date: string
  salesTotal: Money
  costTotal: Money
  invoiceCount: number
  piecesSold: number
  discountsTotal: Money
  returnsCount: number
  returnsTotal: Money
  cashTotal: Money
  cashCount: number
  whishTotal: Money
  whishCount: number
  costMissing: boolean
}

export interface StaffNumbers { salesTotal: Money; costTotal: Money; invoiceCount: number }
export interface VariantNumbers { quantity: number; salesTotal: Money; costTotal: Money }

export interface DaysBreakdown {
  /** Every date from..to (zeros when nothing happened). */
  readonly days: Map<string, DayNumbers>
  /** date → userId → numbers */
  readonly staff: Map<string, Map<string, StaffNumbers>>
  /** date → variantId → numbers */
  readonly variants: Map<string, Map<string, VariantNumbers>>
  /** local hour → sales (only when asked, for one day). */
  readonly hours: Map<number, Money> | null
}

export interface BusinessScope {
  readonly accountId: string
  readonly timezone: string
  /** Store ids the report covers (every store of the account when the report is for "all"). */
  readonly storeIds: readonly string[]
}

export function emptyDay(date: string): DayNumbers {
  return {
    date, salesTotal: zero(), costTotal: zero(), invoiceCount: 0, piecesSold: 0, discountsTotal: zero(),
    returnsCount: 0, returnsTotal: zero(), cashTotal: zero(), cashCount: 0, whishTotal: zero(), whishCount: 0, costMissing: false,
  }
}

const money = (value: string | null | undefined): Money => new Decimal(value ?? '0')
const round2 = (value: Money): Money => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

// --------------------------------------------------------------------------------------------- raw SQL

/**
 * Window [from 00:00, to+1 00:00) in the shop timezone, or [from 00:00, to cutMinute+1) when the last day
 * is cut at a time of day (the minute itself is included, like "up to 19:31").
 */
function windowCte(timezone: string, from: string, to: string, cutMinute: number | null): Prisma.Sql {
  const end = cutMinute === null
    ? Prisma.sql`((${to}::date + 1)::timestamp AT TIME ZONE ${timezone})`
    : Prisma.sql`(((${to}::date)::timestamp + make_interval(mins => ${Math.min(cutMinute + 1, 1440)}::int)) AT TIME ZONE ${timezone})`
  return Prisma.sql`b AS (SELECT ((${from}::date)::timestamp AT TIME ZONE ${timezone}) AS start_at, ${end} AS end_at)`
}

/** Completed sales (s), their lines (i) and the returns made in the window (r), with shop-local date/hour. */
function baseCtes(accountId: string, timezone: string, from: string, to: string, cutMinute: number | null): Prisma.Sql {
  return Prisma.sql`WITH ${windowCte(timezone, from, to, cutMinute)},
  s AS (
    SELECT sa."id", sa."soldById", sa."paymentMethod", sa."totalAmount", sa."discountAmount",
           (sa."createdAt" AT TIME ZONE ${timezone})::date AS d,
           EXTRACT(HOUR FROM sa."createdAt" AT TIME ZONE ${timezone})::int AS h
    FROM "Sale" sa CROSS JOIN b
    WHERE sa."accountId" = ${accountId}::uuid AND sa."status" = 'COMPLETED'
      AND sa."createdAt" >= b.start_at AND sa."createdAt" < b.end_at
  ),
  i AS (
    SELECT s.d, s."soldById", si."variantId", si."quantity", si."lineTotal", si."unitCostAtSale" AS unit_cost
    FROM s JOIN "SaleItem" si ON si."saleId" = s."id" AND si."accountId" = ${accountId}::uuid
  ),
  r AS (
    SELECT sr."id" AS rid, (sr."createdAt" AT TIME ZONE ${timezone})::date AS d,
           EXTRACT(HOUR FROM sr."createdAt" AT TIME ZONE ${timezone})::int AS h,
           sri."variantId", sri."quantity", sri."refundAmount", si."unitCostAtSale" AS unit_cost,
           os."soldById", os."paymentMethod"
    FROM "SaleReturn" sr
    JOIN "SaleReturnItem" sri ON sri."returnId" = sr."id" AND sri."saleId" = sr."saleId" AND sri."accountId" = sr."accountId"
    JOIN "SaleItem" si ON si."id" = sri."saleItemId" AND si."accountId" = sri."accountId"
    JOIN "Sale" os ON os."id" = sr."saleId" AND os."accountId" = sr."accountId"
    CROSS JOIN b
    WHERE sr."accountId" = ${accountId}::uuid AND os."status" = 'COMPLETED'
      AND sr."createdAt" >= b.start_at AND sr."createdAt" < b.end_at
  )`
}

interface RawDay {
  d: string; sales: string; invoices: number; discounts: string; cash: string; cash_n: number; whish: string; whish_n: number
  pieces: number; cost: string; miss: boolean; returns_n: number; returns_amount: string; returns_cost: string; returns_miss: boolean
  returns_cash: string; returns_whish: string
}
interface RawStaff { d: string; u: string; sales: string; cost: string; n: number }
interface RawVariant { d: string; v: string; qty: number; sales: string; cost: string }
interface RawHour { h: number; sales: string }

/**
 * Raw sales → per-day numbers for from..to (inclusive), the last day optionally cut at `cutMinute`.
 * `withHours` adds sales by local hour (one-day reports only).
 */
export async function computeDays(
  db: Db,
  accountId: string,
  timezone: string,
  from: string,
  to: string,
  options: { cutMinute?: number | null; withHours?: boolean } = {},
): Promise<DaysBreakdown> {
  const cut = options.cutMinute ?? null
  const base = () => baseCtes(accountId, timezone, from, to, cut)

  const dayRows = await db.$queryRaw<RawDay[]>(Prisma.sql`${base()},
  sd AS (
    SELECT d, SUM("totalAmount") AS sales, COUNT(*)::int AS invoices, SUM("discountAmount") AS discounts,
           COALESCE(SUM("totalAmount") FILTER (WHERE "paymentMethod" = 'CASH'), 0) AS cash,
           (COUNT(*) FILTER (WHERE "paymentMethod" = 'CASH'))::int AS cash_n,
           COALESCE(SUM("totalAmount") FILTER (WHERE "paymentMethod" = 'WHISH_OMT'), 0) AS whish,
           (COUNT(*) FILTER (WHERE "paymentMethod" = 'WHISH_OMT'))::int AS whish_n
    FROM s GROUP BY d
  ),
  id AS (
    SELECT d, SUM("quantity")::int AS pieces, COALESCE(SUM("quantity" * unit_cost), 0) AS cost, BOOL_OR(unit_cost IS NULL) AS miss
    FROM i GROUP BY d
  ),
  rd AS (
    SELECT d, COUNT(DISTINCT rid)::int AS n, SUM("refundAmount") AS amount, COALESCE(SUM("quantity" * unit_cost), 0) AS cost,
           BOOL_OR(unit_cost IS NULL) AS miss,
           COALESCE(SUM("refundAmount") FILTER (WHERE "paymentMethod" = 'CASH'), 0) AS cash,
           COALESCE(SUM("refundAmount") FILTER (WHERE "paymentMethod" = 'WHISH_OMT'), 0) AS whish
    FROM r GROUP BY d
  )
  SELECT COALESCE(sd.d, rd.d)::text AS d,
         COALESCE(sd.sales, 0)::text AS sales, COALESCE(sd.invoices, 0) AS invoices, COALESCE(sd.discounts, 0)::text AS discounts,
         COALESCE(sd.cash, 0)::text AS cash, COALESCE(sd.cash_n, 0) AS cash_n, COALESCE(sd.whish, 0)::text AS whish, COALESCE(sd.whish_n, 0) AS whish_n,
         COALESCE(id.pieces, 0) AS pieces, COALESCE(id.cost, 0)::text AS cost, COALESCE(id.miss, false) AS miss,
         COALESCE(rd.n, 0) AS returns_n, COALESCE(rd.amount, 0)::text AS returns_amount, COALESCE(rd.cost, 0)::text AS returns_cost,
         COALESCE(rd.miss, false) AS returns_miss, COALESCE(rd.cash, 0)::text AS returns_cash, COALESCE(rd.whish, 0)::text AS returns_whish
  FROM sd LEFT JOIN id ON id.d = sd.d FULL JOIN rd ON rd.d = sd.d`)

  const staffRows = await db.$queryRaw<RawStaff[]>(Prisma.sql`${base()},
  ss AS (SELECT d, "soldById" AS u, SUM("totalAmount") AS sales, COUNT(*)::int AS n FROM s GROUP BY 1, 2),
  sc AS (SELECT d, "soldById" AS u, COALESCE(SUM("quantity" * unit_cost), 0) AS cost FROM i GROUP BY 1, 2),
  sr AS (SELECT d, "soldById" AS u, SUM("refundAmount") AS amount, COALESCE(SUM("quantity" * unit_cost), 0) AS cost FROM r GROUP BY 1, 2)
  SELECT COALESCE(ss.d, sr.d)::text AS d, COALESCE(ss.u, sr.u)::text AS u,
         (COALESCE(ss.sales, 0) - COALESCE(sr.amount, 0))::text AS sales,
         (COALESCE(sc.cost, 0) - COALESCE(sr.cost, 0))::text AS cost,
         COALESCE(ss.n, 0) AS n
  FROM ss LEFT JOIN sc ON sc.d = ss.d AND sc.u = ss.u FULL JOIN sr ON sr.d = ss.d AND sr.u = ss.u`)

  const variantRows = await db.$queryRaw<RawVariant[]>(Prisma.sql`${base()},
  vs AS (SELECT d, "variantId" AS v, SUM("quantity")::int AS qty, SUM("lineTotal") AS sales, COALESCE(SUM("quantity" * unit_cost), 0) AS cost FROM i GROUP BY 1, 2),
  vr AS (SELECT d, "variantId" AS v, SUM("refundAmount") AS amount, COALESCE(SUM("quantity" * unit_cost), 0) AS cost FROM r GROUP BY 1, 2)
  SELECT COALESCE(vs.d, vr.d)::text AS d, COALESCE(vs.v, vr.v)::text AS v, COALESCE(vs.qty, 0) AS qty,
         (COALESCE(vs.sales, 0) - COALESCE(vr.amount, 0))::text AS sales,
         (COALESCE(vs.cost, 0) - COALESCE(vr.cost, 0))::text AS cost
  FROM vs FULL JOIN vr ON vr.d = vs.d AND vr.v = vs.v`)

  let hours: Map<number, Money> | null = null
  if (options.withHours) {
    const hourRows = await db.$queryRaw<RawHour[]>(Prisma.sql`${base()},
    hs AS (SELECT h, SUM("totalAmount") AS sales FROM s GROUP BY h),
    hr AS (SELECT h, SUM("refundAmount") AS amount FROM r GROUP BY h)
    SELECT COALESCE(hs.h, hr.h) AS h, (COALESCE(hs.sales, 0) - COALESCE(hr.amount, 0))::text AS sales
    FROM hs FULL JOIN hr ON hr.h = hs.h ORDER BY 1`)
    hours = new Map(hourRows.map((row) => [Number(row.h), round2(money(row.sales))]))
  }

  const days = new Map<string, DayNumbers>()
  for (const date of dateRange(from, to)) days.set(date, emptyDay(date))
  for (const row of dayRows) {
    const day = days.get(row.d)
    if (!day) continue
    day.salesTotal = round2(money(row.sales).sub(money(row.returns_amount)))
    day.costTotal = round2(money(row.cost).sub(money(row.returns_cost)))
    day.invoiceCount = Number(row.invoices)
    day.piecesSold = Number(row.pieces)
    day.discountsTotal = round2(money(row.discounts))
    day.returnsCount = Number(row.returns_n)
    day.returnsTotal = round2(money(row.returns_amount))
    day.cashTotal = round2(money(row.cash).sub(money(row.returns_cash)))
    day.cashCount = Number(row.cash_n)
    day.whishTotal = round2(money(row.whish).sub(money(row.returns_whish)))
    day.whishCount = Number(row.whish_n)
    day.costMissing = Boolean(row.miss) || Boolean(row.returns_miss)
  }

  const staff = new Map<string, Map<string, StaffNumbers>>()
  for (const row of staffRows) {
    const perDay = staff.get(row.d) ?? new Map<string, StaffNumbers>()
    perDay.set(row.u, { salesTotal: round2(money(row.sales)), costTotal: round2(money(row.cost)), invoiceCount: Number(row.n) })
    staff.set(row.d, perDay)
  }
  const variants = new Map<string, Map<string, VariantNumbers>>()
  for (const row of variantRows) {
    const perDay = variants.get(row.d) ?? new Map<string, VariantNumbers>()
    perDay.set(row.v, { quantity: Number(row.qty), salesTotal: round2(money(row.sales)), costTotal: round2(money(row.cost)) })
    variants.set(row.d, perDay)
  }
  return { days, staff, variants, hours }
}

// ----------------------------------------------------------------------------------------------- rollups

/**
 * Recomputes the finished days from..to (only days before `today`) from raw sales and replaces their rows
 * in the three rollup tables, in one transaction. Idempotent. Every listed day gets a DailySalesRollup row,
 * zeros included, so "no row" always means "not computed yet".
 */
export async function rollupDays(
  prisma: PrismaClient,
  scope: { accountId: string; timezone: string; storeId: string },
  from: string,
  to: string,
  today: string,
  options: { lockAccount?: boolean } = {},
): Promise<number> {
  const lastFinished = shiftDate(today, -1)
  const end = to > lastFinished ? lastFinished : to
  if (from > end) return 0
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '60s'`
    // One rollup per account at a time: two reports (or a report and the nightly job) rolling up the same
    // days would otherwise both insert the same rows. The nightly job skips a busy account instead of waiting.
    const lockKey = `business-rollup:${scope.accountId}`
    if (options.lockAccount) {
      const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS ok`
      if (!lock?.ok) return -1
    } else {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked`
    }
    const result = await computeDays(tx, scope.accountId, scope.timezone, from, end)
    const where = { accountId: scope.accountId, storeId: scope.storeId, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) } }
    await tx.dailyProductRollup.deleteMany({ where })
    await tx.dailyStaffRollup.deleteMany({ where })
    await tx.dailySalesRollup.deleteMany({ where })
    const keys = (date: string) => ({ accountId: scope.accountId, storeId: scope.storeId, date: new Date(`${date}T00:00:00Z`) })
    await tx.dailySalesRollup.createMany({
      data: [...result.days.values()].map((day) => ({
        ...keys(day.date),
        salesTotal: day.salesTotal, costTotal: day.costTotal, invoiceCount: day.invoiceCount, piecesSold: day.piecesSold,
        discountsTotal: day.discountsTotal, returnsCount: day.returnsCount, returnsTotal: day.returnsTotal,
        cashTotal: day.cashTotal, cashCount: day.cashCount, whishTotal: day.whishTotal, whishCount: day.whishCount, costMissing: day.costMissing,
      })),
    })
    const productRows = [...result.variants.entries()].flatMap(([date, perDay]) => [...perDay.entries()].map(([variantId, value]) => ({
      ...keys(date), variantId, quantity: value.quantity, salesTotal: value.salesTotal, costTotal: value.costTotal,
    })))
    if (productRows.length) await tx.dailyProductRollup.createMany({ data: productRows })
    const staffRows = [...result.staff.entries()].flatMap(([date, perDay]) => [...perDay.entries()].map(([userId, value]) => ({
      ...keys(date), userId, salesTotal: value.salesTotal, costTotal: value.costTotal, invoiceCount: value.invoiceCount,
    })))
    if (staffRows.length) await tx.dailyStaffRollup.createMany({ data: staffRows })
    return result.days.size
  }, { timeout: 120_000, maxWait: 10_000 })
}

// ------------------------------------------------------------------------------------------------ ranges

export interface RangeTotals {
  /** Every date from..to that is not in the future, each = the day function. */
  readonly days: Map<string, DayNumbers>
  readonly totals: DayNumbers
  readonly staff: Map<string, StaffNumbers>
  readonly variants: Map<string, VariantNumbers>
  readonly closed: ReadonlySet<string>
}

export function addDay(target: DayNumbers, day: DayNumbers): DayNumbers {
  target.salesTotal = target.salesTotal.add(day.salesTotal)
  target.costTotal = target.costTotal.add(day.costTotal)
  target.invoiceCount += day.invoiceCount
  target.piecesSold += day.piecesSold
  target.discountsTotal = target.discountsTotal.add(day.discountsTotal)
  target.returnsCount += day.returnsCount
  target.returnsTotal = target.returnsTotal.add(day.returnsTotal)
  target.cashTotal = target.cashTotal.add(day.cashTotal)
  target.cashCount += day.cashCount
  target.whishTotal = target.whishTotal.add(day.whishTotal)
  target.whishCount += day.whishCount
  target.costMissing ||= day.costMissing
  return target
}

function addStaff(target: Map<string, StaffNumbers>, userId: string, value: StaffNumbers) {
  const current = target.get(userId) ?? { salesTotal: zero(), costTotal: zero(), invoiceCount: 0 }
  target.set(userId, { salesTotal: current.salesTotal.add(value.salesTotal), costTotal: current.costTotal.add(value.costTotal), invoiceCount: current.invoiceCount + value.invoiceCount })
}

function addVariant(target: Map<string, VariantNumbers>, variantId: string, value: VariantNumbers) {
  const current = target.get(variantId) ?? { quantity: 0, salesTotal: zero(), costTotal: zero() }
  target.set(variantId, { quantity: current.quantity + value.quantity, salesTotal: current.salesTotal.add(value.salesTotal), costTotal: current.costTotal.add(value.costTotal) })
}

export async function closedDates(db: Db, scope: BusinessScope, from: string, to: string): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ d: string }[]>(Prisma.sql`
    SELECT DISTINCT "date"::text AS d FROM "ClosedDay"
    WHERE "accountId" = ${scope.accountId}::uuid AND "date" BETWEEN ${from}::date AND ${to}::date
      AND ("storeId" IS NULL OR "storeId" = ANY(${[...scope.storeIds]}::uuid[]))`)
  return new Set(rows.map((row) => row.d))
}

interface RollupDayRow {
  d: string; sales: string; cost: string; invoices: number; pieces: number; discounts: string; returns_n: number; returns: string
  cash: string; cash_n: number; whish: string; whish_n: number; miss: boolean; stores: number
}

/**
 * Days from..to. Finished days come from the rollups (missing ones are rolled up first); today — or the last
 * day when `cutLastDayAt` is given — comes straight from raw sales. Future days are left out.
 */
export async function rangeTotals(
  prisma: PrismaClient,
  scope: BusinessScope,
  from: string,
  to: string,
  options: { today: string; cutLastDayAt?: number | null; breakdowns?: boolean },
): Promise<RangeTotals> {
  const { today } = options
  const cut = options.cutLastDayAt ?? null
  const last = to > today ? today : to
  const days = new Map<string, DayNumbers>()
  const staff = new Map<string, StaffNumbers>()
  const variants = new Map<string, VariantNumbers>()
  const totals = emptyDay(from)
  if (from > last) return { days, totals, staff, variants, closed: await closedDates(prisma, scope, from, to) }

  // Live part: today, or the last day when it is cut at a time of day.
  const liveDate = last === today || cut !== null ? last : null
  const rollupTo = liveDate ? shiftDate(liveDate, -1) : last

  if (from <= rollupTo) {
    await ensureRollups(prisma, scope, from, rollupTo, today)
    await readOnly(prisma, async (tx) => {
    const rows = await tx.$queryRaw<RollupDayRow[]>(Prisma.sql`
      SELECT "date"::text AS d, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost, SUM("invoiceCount")::int AS invoices,
             SUM("piecesSold")::int AS pieces, SUM("discountsTotal")::text AS discounts, SUM("returnsCount")::int AS returns_n,
             SUM("returnsTotal")::text AS returns, SUM("cashTotal")::text AS cash, SUM("cashCount")::int AS cash_n,
             SUM("whishTotal")::text AS whish, SUM("whishCount")::int AS whish_n, BOOL_OR("costMissing") AS miss, COUNT(*)::int AS stores
      FROM "DailySalesRollup"
      WHERE "accountId" = ${scope.accountId}::uuid AND "storeId" = ANY(${[...scope.storeIds]}::uuid[])
        AND "date" BETWEEN ${from}::date AND ${rollupTo}::date
      GROUP BY "date" ORDER BY "date"`)
    for (const row of rows) {
      days.set(row.d, {
        date: row.d, salesTotal: money(row.sales), costTotal: money(row.cost), invoiceCount: Number(row.invoices), piecesSold: Number(row.pieces),
        discountsTotal: money(row.discounts), returnsCount: Number(row.returns_n), returnsTotal: money(row.returns), cashTotal: money(row.cash),
        cashCount: Number(row.cash_n), whishTotal: money(row.whish), whishCount: Number(row.whish_n), costMissing: Boolean(row.miss),
      })
    }
    if (options.breakdowns !== false) {
      const staffRows = await tx.$queryRaw<{ u: string; sales: string; cost: string; n: number }[]>(Prisma.sql`
        SELECT "userId"::text AS u, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost, SUM("invoiceCount")::int AS n
        FROM "DailyStaffRollup"
        WHERE "accountId" = ${scope.accountId}::uuid AND "storeId" = ANY(${[...scope.storeIds]}::uuid[])
          AND "date" BETWEEN ${from}::date AND ${rollupTo}::date
        GROUP BY "userId"`)
      for (const row of staffRows) addStaff(staff, row.u, { salesTotal: money(row.sales), costTotal: money(row.cost), invoiceCount: Number(row.n) })
      const variantRows = await tx.$queryRaw<{ v: string; qty: number; sales: string; cost: string }[]>(Prisma.sql`
        SELECT "variantId"::text AS v, SUM("quantity")::int AS qty, SUM("salesTotal")::text AS sales, SUM("costTotal")::text AS cost
        FROM "DailyProductRollup"
        WHERE "accountId" = ${scope.accountId}::uuid AND "storeId" = ANY(${[...scope.storeIds]}::uuid[])
          AND "date" BETWEEN ${from}::date AND ${rollupTo}::date
        GROUP BY "variantId"`)
      for (const row of variantRows) addVariant(variants, row.v, { quantity: Number(row.qty), salesTotal: money(row.sales), costTotal: money(row.cost) })
    }
    })
  }

  if (liveDate) {
    const live = await liveDay(prisma, scope, liveDate, liveDate === today && cut === null ? null : cut)
    days.set(liveDate, live.day)
    for (const [userId, value] of live.staff) addStaff(staff, userId, value)
    for (const [variantId, value] of live.variants) addVariant(variants, variantId, value)
  }

  for (const date of dateRange(from, last)) {
    const day = days.get(date) ?? emptyDay(date)
    days.set(date, day)
    addDay(totals, day)
  }
  const ordered = new Map([...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
  return { days: ordered, totals, staff, variants, closed: await closedDates(prisma, scope, from, to) }
}

/** Rolls up the finished days from..to that have no rollup row yet (for every store of the scope). */
async function ensureRollups(prisma: PrismaClient, scope: BusinessScope, from: string, to: string, today: string) {
  const present = await prisma.$queryRaw<{ s: string; d: string }[]>(Prisma.sql`
    SELECT "storeId"::text AS s, "date"::text AS d FROM "DailySalesRollup"
    WHERE "accountId" = ${scope.accountId}::uuid AND "storeId" = ANY(${[...scope.storeIds]}::uuid[])
      AND "date" BETWEEN ${from}::date AND ${to}::date`)
  const have = new Set(present.map((row) => `${row.s}|${row.d}`))
  const dates = dateRange(from, to)
  for (const storeId of scope.storeIds) {
    const missing = dates.filter((date) => !have.has(`${storeId}|${date}`))
    if (!missing.length) continue
    await rollupDays(prisma, { accountId: scope.accountId, timezone: scope.timezone, storeId }, missing[0]!, missing[missing.length - 1]!, today)
  }
}

/** Sales by shop-local hour for one day (raw sales, net of returns made in that hour), cut when given. */
export async function dayHours(prisma: PrismaClient, scope: BusinessScope, date: string, untilMinute: number | null): Promise<Map<number, Money>> {
  const rows = await readOnly(prisma, (tx) => tx.$queryRaw<RawHour[]>(Prisma.sql`${baseCtes(scope.accountId, scope.timezone, date, date, untilMinute)},
  hs AS (SELECT h, SUM("totalAmount") AS sales FROM s GROUP BY h),
  hr AS (SELECT h, SUM("refundAmount") AS amount FROM r GROUP BY h)
  SELECT COALESCE(hs.h, hr.h) AS h, (COALESCE(hs.sales, 0) - COALESCE(hr.amount, 0))::text AS sales
  FROM hs FULL JOIN hr ON hr.h = hs.h ORDER BY 1`))
  return new Map(rows.map((row) => [Number(row.h), round2(money(row.sales))]))
}

export interface LiveDay {
  readonly day: DayNumbers
  readonly staff: Map<string, StaffNumbers>
  readonly variants: Map<string, VariantNumbers>
  readonly hours: Map<number, Money>
}

/** One day straight from raw sales, cut at `untilMinute` (minutes after local midnight) when given. */
export async function liveDay(prisma: PrismaClient, scope: BusinessScope, date: string, untilMinute: number | null): Promise<LiveDay> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`
    return computeDays(tx, scope.accountId, scope.timezone, date, date, { cutMinute: untilMinute, withHours: true })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  return {
    day: result.days.get(date) ?? emptyDay(date),
    staff: result.staff.get(date) ?? new Map(),
    variants: result.variants.get(date) ?? new Map(),
    hours: result.hours ?? new Map(),
  }
}

/** Read-only work for a report: one consistent snapshot, and no single query may run longer than 5 s. */
export async function readOnly<T>(prisma: PrismaClient, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`
    return run(tx)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
