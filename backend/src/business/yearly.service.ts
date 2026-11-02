// GET /api/business/yearly — OWNER only. Each month is the sum of the day function (from the rollups).
import { Prisma } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import { isCalendarYear, monthDates, shiftDate } from './business-dates.js'
import { monthTotals } from './day-totals.js'
import { yearExpenses } from './monthly.service.js'
import { fmt, validationError, type ReportContext } from './report-common.js'

export async function yearlyReport(ctx: ReportContext, query: Record<string, unknown>) {
  if (!ctx.isOwner) throw new HttpError(403, 'OWNER_ONLY', 'The yearly report is for the owner only')
  if (!isCalendarYear(query.year)) throw validationError('year must be YYYY')
  const year = query.year
  const today = ctx.now.date
  if (year > today.slice(0, 4)) throw validationError('year cannot be in the future')
  const lastMonth = year === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12
  const months = Array.from({ length: lastMonth }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
  const yearEnd = months[months.length - 1] === today.slice(0, 7) ? today : monthDates(months[months.length - 1]!).at(-1)!
  // Same months last year, up to the same day.
  const lastYearEnd = `${Number(yearEnd.slice(0, 4)) - 1}${yearEnd.slice(4)}`

  const [thisYear, previousYear, purchases, expensesByMonth] = await Promise.all([
    monthTotals(ctx.prisma, ctx.scope, `${year}-01-01`, yearEnd, { today }),
    monthTotals(ctx.prisma, ctx.scope, `${Number(year) - 1}-01-01`, lastYearEnd.endsWith('-02-29') ? shiftDate(lastYearEnd, -1) : lastYearEnd, { today }),
    // Stock bought: stock receipts (quantity × unit cost) by shop-local month.
    ctx.prisma.$queryRaw<{ m: string; amount: string }[]>(Prisma.sql`
      SELECT to_char(r."createdAt" AT TIME ZONE ${ctx.scope.timezone}, 'YYYY-MM') AS m, SUM(i."quantity" * i."unitCost")::text AS amount
      FROM "StockReceipt" r JOIN "StockReceiptItem" i ON i."receiptId" = r."id" AND i."accountId" = r."accountId"
      WHERE r."accountId" = ${ctx.scope.accountId}::uuid
        AND r."createdAt" >= ((${`${year}-01-01`}::date)::timestamp AT TIME ZONE ${ctx.scope.timezone})
        AND r."createdAt" < ((${`${Number(year) + 1}-01-01`}::date)::timestamp AT TIME ZONE ${ctx.scope.timezone})
      GROUP BY 1`),
    yearExpenses(ctx, year),
  ])
  const purchasesBy = new Map(purchases.map((row) => [row.m, new Prisma.Decimal(row.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)]))

  const rows = []
  for (const month of months) {
    const totals = thisYear.get(month)
    const sales = totals?.salesTotal ?? new Prisma.Decimal(0)
    const cost = totals?.costTotal ?? new Prisma.Decimal(0)
    const invoices = totals?.invoiceCount ?? 0
    const expenses = expensesByMonth.get(month)!
    const rent = expenses.get('RENT')!
    const other = [...expenses.entries()].filter(([category]) => category !== 'RENT').reduce((sum, [, amount]) => sum.add(amount), new Prisma.Decimal(0))
    rows.push({
      month,
      salesTotal: fmt(sales),
      cogsTotal: fmt(cost),
      purchasesTotal: fmt(purchasesBy.get(month) ?? new Prisma.Decimal(0)),
      rentTotal: fmt(rent),
      otherExpensesTotal: fmt(other),
      invoiceCount: invoices,
    })
  }
  return {
    year: Number(year),
    timezone: ctx.account.timezone,
    exchangeRate: ctx.account.exchangeRate,
    months: rows,
    previousYear: { salesTotal: fmt([...previousYear.values()].reduce((sum, month) => sum.add(month.salesTotal), new Prisma.Decimal(0))), monthsCompared: rows.length },
  }
}
