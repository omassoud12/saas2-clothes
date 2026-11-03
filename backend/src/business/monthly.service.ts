// GET /api/business/monthly — every day of the month is the day function; comparisons on the same weekdays.
import { Prisma } from '../generated/prisma/client.js'
import { isCalendarMonth, monthDates, shiftDate, shiftMonth } from './business-dates.js'
import { rangeTotals } from './day-totals.js'
import {
  DEAD_STOCK_BASIS_DAYS, fmt, forecastFor, forecastHistory, ownerMoney, paymentSplit, productRows, staffRows, stockNow, targetFor,
  validationError, type ReportContext,
} from './report-common.js'

export const EXPENSE_CATEGORIES = [
  { category: 'RENT', label: 'Rent' },
  { category: 'SALARIES', label: 'Salaries' },
  { category: 'ELECTRICITY', label: 'Electricity (EDL)' },
  { category: 'GENERATOR', label: 'Generator' },
  { category: 'INTERNET', label: 'Internet' },
  { category: 'OTHER', label: 'Other' },
] as const

/**
 * Expenses of a month by category (Expense.expenseDate in that month). For the current month the monthly
 * amounts are spread evenly over the days of the month, so mid-month net profit is fair.
 */
export async function monthExpenses(ctx: ReportContext, month: string): Promise<Map<string, Prisma.Decimal>> {
  const rows = await ctx.prisma.$queryRaw<{ category: string; amount: string }[]>(Prisma.sql`
    SELECT "category"::text AS category, SUM("amount")::text AS amount FROM "Expense"
    WHERE "accountId" = ${ctx.scope.accountId}::uuid AND "deletedAt" IS NULL AND "expenseDate" >= ${`${month}-01`}::date AND "expenseDate" < (${`${month}-01`}::date + interval '1 month')
    GROUP BY "category"`)
  const dates = monthDates(month)
  const share = month === ctx.now.date.slice(0, 7) ? new Prisma.Decimal(Number(ctx.now.date.slice(8, 10))).div(dates.length) : new Prisma.Decimal(1)
  const out = new Map<string, Prisma.Decimal>()
  for (const { category } of EXPENSE_CATEGORIES) {
    const row = rows.find((item) => item.category === category)
    out.set(category, new Prisma.Decimal(row?.amount ?? 0).mul(share).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP))
  }
  return out
}

/** monthExpenses() for every month of a year in one query: month → category → amount (current month spread). */
export async function yearExpenses(ctx: ReportContext, year: string): Promise<Map<string, Map<string, Prisma.Decimal>>> {
  const rows = await ctx.prisma.$queryRaw<{ m: string; category: string; amount: string }[]>(Prisma.sql`
    SELECT to_char("expenseDate", 'YYYY-MM') AS m, "category"::text AS category, SUM("amount")::text AS amount FROM "Expense"
    WHERE "accountId" = ${ctx.scope.accountId}::uuid AND "deletedAt" IS NULL AND "expenseDate" >= ${`${year}-01-01`}::date AND "expenseDate" < ${`${Number(year) + 1}-01-01`}::date
    GROUP BY 1, 2`)
  const current = ctx.now.date.slice(0, 7)
  const out = new Map<string, Map<string, Prisma.Decimal>>()
  for (let month = 1; month <= 12; month += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}`
    const share = key === current ? new Prisma.Decimal(Number(ctx.now.date.slice(8, 10))).div(monthDates(key).length) : new Prisma.Decimal(1)
    const byCategory = new Map<string, Prisma.Decimal>()
    for (const { category } of EXPENSE_CATEGORIES) {
      const row = rows.find((item) => item.m === key && item.category === category)
      byCategory.set(category, new Prisma.Decimal(row?.amount ?? 0).mul(share).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP))
    }
    out.set(key, byCategory)
  }
  return out
}

export async function monthlyReport(ctx: ReportContext, query: Record<string, unknown>) {
  if (!isCalendarMonth(query.month)) throw validationError('month must be YYYY-MM')
  const month = query.month
  const today = ctx.now.date
  if (month > today.slice(0, 7)) throw validationError('month cannot be in the future')
  const all = monthDates(month)
  const live = month === today.slice(0, 7)
  const cut = live ? ctx.now.minute : null
  const done = all.filter((date) => date <= today)

  // Fair comparisons: while the month runs, the same weekdays (4 weeks back, 5 after day 28; 52 weeks back
  // for last year) with the last day cut at asOf. A finished month: the whole previous month / same month last year.
  const back = done.length <= 28 ? 28 : 35
  const lastMonthRange = live ? [shiftDate(done[0]!, -back), shiftDate(done[done.length - 1]!, -back)] : [monthDates(shiftMonth(month, -1))[0]!, monthDates(shiftMonth(month, -1)).at(-1)!]
  const lastYearRange = live ? [shiftDate(done[0]!, -364), shiftDate(done[done.length - 1]!, -364)] : [monthDates(shiftMonth(month, -12))[0]!, monthDates(shiftMonth(month, -12)).at(-1)!]
  const previousMonth = shiftMonth(month, -1)
  const previousMonthDates = monthDates(previousMonth)

  const [current, lastMonth, lastYear, previousFull, history, target] = await Promise.all([
    rangeTotals(ctx.prisma, ctx.scope, all[0]!, all[all.length - 1]!, { today }),
    rangeTotals(ctx.prisma, ctx.scope, lastMonthRange[0]!, lastMonthRange[1]!, { today, cutLastDayAt: cut, breakdowns: false }),
    rangeTotals(ctx.prisma, ctx.scope, lastYearRange[0]!, lastYearRange[1]!, { today, cutLastDayAt: cut, breakdowns: false }),
    rangeTotals(ctx.prisma, ctx.scope, previousMonthDates[0]!, previousMonthDates[previousMonthDates.length - 1]!, { today, breakdowns: false }),
    live ? forecastHistory(ctx) : null,
    targetFor(ctx, 'MONTH', `${month}-01`),
  ])

  const days = all.map((date) => {
    const closed = current.closed.has(date)
    if (date > today) {
      return { date, salesTotal: null, costTotal: null, profitTotal: null, invoiceCount: 0, closed, forecastSalesTotal: fmt(closed ? new Prisma.Decimal(0) : forecastFor(date, today, history!)) }
    }
    const day = current.days.get(date)!
    return {
      date,
      salesTotal: fmt(day.salesTotal),
      costTotal: ownerMoney(ctx, day.costTotal),
      profitTotal: ownerMoney(ctx, day.salesTotal.sub(day.costTotal)),
      invoiceCount: day.invoiceCount,
      closed,
      // today: the expected whole day, so the UI can project the month
      forecastSalesTotal: date === today ? fmt(closed ? new Prisma.Decimal(0) : forecastFor(date, today, history!)) : null,
    }
  })

  const totals = current.totals
  const [byStaff, products, expenses, stock] = await Promise.all([
    staffRows(ctx, current.staff),
    productRows(ctx, current.variants),
    ctx.isOwner ? monthExpenses(ctx, month) : null,
    live ? stockNow(ctx, 0) : null,
  ])
  return {
    month,
    timezone: ctx.account.timezone,
    exchangeRate: ctx.account.exchangeRate,
    live,
    asOf: live ? ctx.now.hhmm : null,
    asOfDate: live ? today : null,
    totals: {
      salesTotal: fmt(totals.salesTotal),
      costTotal: ownerMoney(ctx, totals.costTotal),
      profitTotal: ownerMoney(ctx, totals.salesTotal.sub(totals.costTotal)),
      invoiceCount: totals.invoiceCount,
      piecesSold: totals.piecesSold,
      discountsTotal: fmt(totals.discountsTotal),
      returns: { count: totals.returnsCount, amountTotal: fmt(totals.returnsTotal) },
    },
    costComplete: !totals.costMissing,
    days,
    comparisons: {
      sameWeekdaysLastMonth: { from: lastMonthRange[0], to: lastMonthRange[1], salesTotal: fmt(lastMonth.totals.salesTotal), invoiceCount: lastMonth.totals.invoiceCount },
      sameWeekdaysLastYear: { from: lastYearRange[0], to: lastYearRange[1], salesTotal: fmt(lastYear.totals.salesTotal), invoiceCount: lastYear.totals.invoiceCount },
      previousMonthFull: { month: previousMonth, salesTotal: fmt(previousFull.totals.salesTotal) },
    },
    target,
    expenses: expenses ? EXPENSE_CATEGORIES.map(({ category, label }) => ({ category, label, amountTotal: fmt(expenses.get(category)!) })) : null,
    paymentSplit: paymentSplit(totals),
    byStaff,
    products,
    inventory: stock ? {
      basisDays: DEAD_STOCK_BASIS_DAYS,
      stockUnits: stock.stockUnits,
      stockValue: stock.stockValue,
      deadStockValue: stock.deadStockValue,
      piecesSoldThisMonth: totals.piecesSold,
      deadStock: stock.items,
    } : null,
  }
}
