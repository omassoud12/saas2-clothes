// Owner Dashboard: GET /api/dashboard/summary and GET /api/dashboard/best-sellers.
// Every sales, cost and profit number comes from the business day function (business/day-totals.ts):
// completed sales only, voided excluded, net of returns, cost = the snapshot on the sale line. Finished
// days come from the rollups, today is computed live. Cost, profit and expense fields are null without
// VIEW_COST_PROFIT. The account always comes from the session.
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import type { AuthContext } from '../auth/auth.types.js'
import { hasPermission } from '../access/permissions.js'
import { mondayOf, monthDates, shiftDate } from '../business/business-dates.js'
import { ReportCache, AccountRateLimiter } from '../business/business-cache.js'
import { rangeTotals, readOnly } from '../business/day-totals.js'
import { EXPENSE_CATEGORIES, monthExpenses } from '../business/monthly.service.js'
import {
  fmt, forecastFor, forecastHistory, ownerMoney, productRows, reportContext, targetFor, tenantOf, validationError,
  type BusinessOptions, type ReportContext,
} from '../business/report-common.js'

type Money = Prisma.Decimal
const zero = () => new Prisma.Decimal(0)

export const BEST_SELLER_PERIODS = ['today', 'week', 'month'] as const
export const BEST_SELLER_SORTS = ['sales', 'quantity', 'profit'] as const
export type BestSellerPeriod = (typeof BEST_SELLER_PERIODS)[number]
export type BestSellerSort = (typeof BEST_SELLER_SORTS)[number]

/** Change in percent with one decimal, or null when there is nothing to compare with. */
export function percentChange(current: Money, previous: Money): string | null {
  if (previous.isZero()) return null
  return current.sub(previous).div(previous).mul(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toFixed(1)
}

/** Products and variants with no current cost, and what was sold without a cost in the last 30 days. */
export async function missingCostSummary(ctx: ReportContext): Promise<{ productCount: number; variantCount: number; salesAffectedTotal: string }> {
  const since = shiftDate(ctx.now.date, -30)
  const [counts, affected] = await Promise.all([
    ctx.prisma.$queryRaw<{ products: bigint; variants: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT v."productId") AS products, COUNT(*) AS variants
      FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId" AND p."accountId" = v."accountId"
      WHERE v."accountId" = ${ctx.scope.accountId}::uuid AND v."isActive" AND p."isActive" AND v."lastPurchaseCost" IS NULL`),
    // Driven by Sale(accountId, status, createdAt), then SaleItem(saleId, accountId).
    readOnly(ctx.prisma, (tx) => tx.$queryRaw<{ total: string | null }[]>(Prisma.sql`
      SELECT SUM(si."lineTotal")::text AS total
      FROM "Sale" s JOIN "SaleItem" si ON si."saleId" = s."id" AND si."accountId" = s."accountId"
      WHERE s."accountId" = ${ctx.scope.accountId}::uuid AND s."status" = 'COMPLETED'
        AND s."createdAt" >= (${since}::date::timestamp AT TIME ZONE ${ctx.scope.timezone})
        AND si."unitCostAtSale" IS NULL`)),
  ])
  return {
    productCount: Number(counts[0]?.products ?? 0),
    variantCount: Number(counts[0]?.variants ?? 0),
    salesAffectedTotal: fmt(new Prisma.Decimal(affected[0]?.total ?? 0)),
  }
}

/** Expenses entered for a month (not spread over the days), by category, without removed rows. */
export async function recordedExpenses(ctx: ReportContext, month: string): Promise<{ total: string; byCategory: { category: string; label: string; amountTotal: string }[] }> {
  const rows = await ctx.prisma.$queryRaw<{ category: string; amount: string }[]>(Prisma.sql`
    SELECT "category"::text AS category, SUM("amount")::text AS amount FROM "Expense"
    WHERE "accountId" = ${ctx.scope.accountId}::uuid AND "deletedAt" IS NULL
      AND "expenseDate" >= ${`${month}-01`}::date AND "expenseDate" < (${`${month}-01`}::date + interval '1 month')
    GROUP BY "category"`)
  let total = zero()
  const byCategory = EXPENSE_CATEGORIES.map(({ category, label }) => {
    const amount = new Prisma.Decimal(rows.find((row) => row.category === category)?.amount ?? 0)
    total = total.add(amount)
    return { category, label, amountTotal: fmt(amount) }
  })
  return { total: fmt(total), byCategory }
}

export async function dashboardSummary(ctx: ReportContext, auth: AuthContext | undefined, hooks: DashboardHooks) {
  const today = ctx.now.date
  const month = today.slice(0, 7)
  const dates = monthDates(month)
  const yesterday = shiftDate(today, -1)
  if (ctx.isOwner) await hooks.beforeMonthExpenses?.(ctx.scope.accountId, month)
  const [todayTotals, yesterdayByNow, monthTotals, history, target, missingCost, employees, spreadExpenses, recorded] = await Promise.all([
    rangeTotals(ctx.prisma, ctx.scope, today, today, { today, breakdowns: false }),
    rangeTotals(ctx.prisma, ctx.scope, yesterday, yesterday, { today, cutLastDayAt: ctx.now.minute, breakdowns: false }),
    rangeTotals(ctx.prisma, ctx.scope, dates[0]!, today, { today, breakdowns: false }),
    forecastHistory(ctx),
    targetFor(ctx, 'MONTH', `${month}-01`),
    missingCostSummary(ctx),
    hasPermission(auth, 'EMPLOYEES') ? employeeCounts(ctx.prisma, ctx.scope.accountId) : null,
    // The same spread expenses as Business Monthly, so the month's net profit is the same number.
    ctx.isOwner ? monthExpenses(ctx, month) : null,
    ctx.isOwner ? recordedExpenses(ctx, month) : null,
  ])

  const todayDay = todayTotals.totals
  const monthDay = monthTotals.totals
  // Projection: finished days as sold, today at least its usual whole day, the days to come as forecast.
  let projection = zero()
  for (const date of dates) {
    if (date < today) projection = projection.add(monthTotals.days.get(date)?.salesTotal ?? 0)
    else if (date === today) {
      const expected = forecastFor(date, today, history)
      projection = projection.add(Prisma.Decimal.max(todayDay.salesTotal, expected))
    } else projection = projection.add(forecastFor(date, today, history))
  }
  const dayOfMonth = Number(today.slice(8, 10))
  const targetBody = target ? (() => {
    const amount = new Prisma.Decimal(target.salesTotal)
    return {
      amount: fmt(amount),
      progress: amount.isZero() ? null : monthDay.salesTotal.div(amount).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4),
      expectedByToday: fmt(amount.mul(dayOfMonth).div(dates.length).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
    }
  })() : null
  const monthProfit = monthDay.salesTotal.sub(monthDay.costTotal)
  const expensesTotal = spreadExpenses ? [...spreadExpenses.values()].reduce((sum, value) => sum.add(value), zero()) : null

  return {
    live: true,
    asOf: ctx.now.hhmm,
    date: today,
    currentMonth: month,
    timezone: ctx.account.timezone,
    currency: ctx.account.baseCurrency,
    exchangeRate: ctx.account.exchangeRate,
    today: {
      salesTotal: fmt(todayDay.salesTotal),
      invoiceCount: todayDay.invoiceCount,
      piecesSold: todayDay.piecesSold,
      profitTotal: ownerMoney(ctx, todayDay.salesTotal.sub(todayDay.costTotal)),
      costComplete: !todayDay.costMissing,
      vsYesterdaySameTime: {
        salesTotal: fmt(yesterdayByNow.totals.salesTotal),
        invoiceCount: yesterdayByNow.totals.invoiceCount,
        changePercent: percentChange(todayDay.salesTotal, yesterdayByNow.totals.salesTotal),
      },
    },
    month: {
      salesTotal: fmt(monthDay.salesTotal),
      invoiceCount: monthDay.invoiceCount,
      profitTotal: ownerMoney(ctx, monthProfit),
      expensesTotal: expensesTotal ? fmt(expensesTotal) : null,
      netProfit: expensesTotal ? fmt(monthProfit.sub(expensesTotal)) : null,
      costComplete: !monthDay.costMissing,
      target: targetBody,
      projection: fmt(projection),
      daysInMonth: dates.length,
      dayOfMonth,
    },
    missingCost,
    employees,
    expensesThisMonth: recorded,
  }
}

async function employeeCounts(prisma: PrismaClient, accountId: string): Promise<{ active: number; invited: number; deactivated: number }> {
  const rows = await prisma.user.groupBy({ by: ['status'], where: { accountId, role: 'WAREHOUSE' }, _count: { _all: true } })
  const count = (status: string) => rows.find((row) => row.status === status)?._count._all ?? 0
  return { active: count('ACTIVE'), invited: count('INVITED'), deactivated: count('DEACTIVATED') }
}

export function parseBestSellerQuery(query: Record<string, unknown>, canSeeProfit: boolean): { period: BestSellerPeriod; sort: BestSellerSort; limit: number } {
  const period = query.period ?? 'today'
  if (!BEST_SELLER_PERIODS.includes(period as BestSellerPeriod)) throw validationError('period must be today, week or month')
  const sort = query.sort ?? 'sales'
  if (!BEST_SELLER_SORTS.includes(sort as BestSellerSort)) throw validationError('sort must be sales, quantity or profit')
  if (sort === 'profit' && !canSeeProfit) throw new HttpError(403, 'PERMISSION_FORBIDDEN', 'Sorting by profit needs access to cost and profit')
  const limit = query.limit === undefined ? 10 : Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw validationError('limit must be 1 to 50')
  return { period: period as BestSellerPeriod, sort: sort as BestSellerSort, limit }
}

export function periodRange(period: BestSellerPeriod, today: string): { from: string; to: string } {
  if (period === 'today') return { from: today, to: today }
  if (period === 'week') return { from: mondayOf(today), to: today }
  return { from: `${today.slice(0, 7)}-01`, to: today }
}

export async function bestSellers(ctx: ReportContext, query: Record<string, unknown>) {
  const { period, sort, limit } = parseBestSellerQuery(query, ctx.isOwner)
  const { from, to } = periodRange(period, ctx.now.date)
  const range = await rangeTotals(ctx.prisma, ctx.scope, from, to, { today: ctx.now.date })
  const rows = await productRows(ctx, range.variants)
  const key = (row: (typeof rows)[number]) => sort === 'quantity' ? row.quantity : sort === 'profit' ? Number(row.profitTotal ?? 0) : Number(row.salesTotal)
  const sorted = [...rows].sort((a, b) => key(b) - key(a) || Number(b.salesTotal) - Number(a.salesTotal) || a.name.localeCompare(b.name))
  return {
    period, sort, from, to,
    live: true,
    asOf: ctx.now.hhmm,
    currency: ctx.account.baseCurrency,
    productCount: rows.length,
    items: sorted.slice(0, limit),
  }
}

export interface DashboardHooks {
  /** Called before the month's expenses are read (materialises recurring expenses for that month). */
  readonly beforeMonthExpenses?: (accountId: string, month: string) => Promise<void>
}

export interface DashboardDependencies {
  getSummary(auth: AuthContext | undefined, query: Record<string, unknown>): Promise<{ body: object; etag: string }>
  getBestSellers(auth: AuthContext | undefined, query: Record<string, unknown>): Promise<{ body: object; etag: string }>
  takeRateLimit(accountId: string): number | null
}

export interface DashboardOptions extends BusinessOptions, DashboardHooks {
  readonly cache?: ReportCache
  readonly rateLimiter?: AccountRateLimiter
}

export function createDashboardDependencies(prisma: PrismaClient, options: DashboardOptions = {}): DashboardDependencies {
  const cache = options.cache ?? new ReportCache()
  const limiter = options.rateLimiter ?? new AccountRateLimiter(120)
  const inFlight = new Map<string, Promise<{ body: object; etag: string }>>()

  async function cached(kind: string, auth: AuthContext | undefined, query: Record<string, unknown>, build: (ctx: ReportContext) => Promise<object>) {
    const { accountId } = tenantOf(auth)
    const store = typeof query.storeId === 'string' && query.storeId !== '' ? query.storeId : 'all'
    const params = kind === 'best-sellers' ? [query.period, query.sort, query.limit].map((value) => (typeof value === 'string' ? value : '')).join('|') : ''
    // The body depends on what the member may see, so the key carries those permissions.
    const view = `${hasPermission(auth, 'VIEW_COST_PROFIT') ? 'c' : '-'}${hasPermission(auth, 'EMPLOYEES') ? 'e' : '-'}`
    const key = `${accountId}:${store}:dashboard-${kind}:${params}:${view}`
    const hit = cache.get(key)
    if (hit) return hit
    const running = inFlight.get(key)
    if (running) return running
    const work = (async () => {
      const ctx = await reportContext(prisma, auth, query.storeId, options)
      return cache.set(key, accountId, await build(ctx), true)
    })()
    inFlight.set(key, work)
    try { return await work } finally { inFlight.delete(key) }
  }

  return {
    getSummary: (auth, query) => cached('summary', auth, query, (ctx) => dashboardSummary(ctx, auth, options)),
    getBestSellers: (auth, query) => cached('best-sellers', auth, query, (ctx) => bestSellers(ctx, query)),
    takeRateLimit: (accountId) => limiter.take(accountId),
  }
}
