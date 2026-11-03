// GET /api/business/weekly — Monday to Sunday in the shop timezone. Totals are the sum of the day function.
import { Prisma } from '../generated/prisma/client.js'
import { dateRange, isCalendarDate, mondayOf, shiftDate } from './business-dates.js'
import { rangeTotals } from './day-totals.js'
import {
  DEAD_STOCK_BASIS_DAYS, fmt, forecastFor, forecastHistory, ownerMoney, paymentSplit, productRows, staffRows, stockNow, targetFor,
  validationError, type ReportContext,
} from './report-common.js'

export async function weeklyReport(ctx: ReportContext, query: Record<string, unknown>) {
  if (!isCalendarDate(query.week)) throw validationError('week must be a date YYYY-MM-DD (its Monday is used)')
  const weekStart = mondayOf(query.week)
  const today = ctx.now.date
  if (weekStart > today) throw validationError('week cannot be in the future')
  const weekEnd = shiftDate(weekStart, 6)
  const dates = dateRange(weekStart, weekEnd)
  const live = dates.includes(today)
  const cut = live ? ctx.now.minute : null

  // This week up to today; last week in full (finished, from the rollups), and today's counterpart cut at asOf.
  const [current, previousFull, previousCut, history, target] = await Promise.all([
    rangeTotals(ctx.prisma, ctx.scope, weekStart, weekEnd, { today }),
    rangeTotals(ctx.prisma, ctx.scope, shiftDate(weekStart, -7), shiftDate(weekEnd, -7), { today, breakdowns: false }),
    live ? rangeTotals(ctx.prisma, ctx.scope, shiftDate(today, -7), shiftDate(today, -7), { today, cutLastDayAt: cut, breakdowns: false }) : null,
    live ? forecastHistory(ctx) : null,
    targetFor(ctx, 'WEEK', weekStart),
  ])

  let previousSales = new Prisma.Decimal(0)
  let previousCount = 0
  const days = dates.map((date) => {
    const lastWeekDate = shiftDate(date, -7)
    const lastWeekDay = date === today && previousCut ? previousCut.totals : previousFull.days.get(lastWeekDate)
    const closed = current.closed.has(date)
    if (date > today) {
      return {
        date, salesTotal: null, costTotal: null, profitTotal: null, invoiceCount: 0, closed,
        previousSalesTotal: fmt(lastWeekDay?.salesTotal ?? new Prisma.Decimal(0)),
        forecastSalesTotal: fmt(closed ? new Prisma.Decimal(0) : forecastFor(date, today, history!)),
      }
    }
    const day = current.days.get(date)!
    previousSales = previousSales.add(lastWeekDay?.salesTotal ?? 0)
    previousCount += lastWeekDay?.invoiceCount ?? 0
    return {
      date,
      salesTotal: fmt(day.salesTotal),
      costTotal: ownerMoney(ctx, day.costTotal),
      profitTotal: ownerMoney(ctx, day.salesTotal.sub(day.costTotal)),
      invoiceCount: day.invoiceCount,
      closed,
      previousSalesTotal: fmt(lastWeekDay?.salesTotal ?? new Prisma.Decimal(0)),
      forecastSalesTotal: null,
    }
  })

  const totals = current.totals
  const [byStaff, products, stock] = await Promise.all([
    staffRows(ctx, current.staff),
    productRows(ctx, current.variants),
    live ? stockNow(ctx, 2) : null,
  ])
  return {
    weekStart,
    weekEnd,
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
    },
    costComplete: !totals.costMissing,
    previousWeek: { salesTotal: fmt(previousSales), invoiceCount: previousCount },
    target,
    days,
    paymentSplit: paymentSplit(totals),
    byStaff,
    products,
    slowMovers: stock ? stock.items : null,
    slowMoversBasisDays: DEAD_STOCK_BASIS_DAYS,
  }
}
