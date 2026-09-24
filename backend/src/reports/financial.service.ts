import { Prisma } from '../generated/prisma/client.js'
import type {
  DailyFinancials,
  FinancialSummary,
  FinancialTransaction,
} from './financial.types.js'
import { FinancialComputationError } from './financial.types.js'

const reportDatePattern = /^\d{4}-\d{2}-\d{2}$/
const millisecondsPerDay = 86_400_000
const maximumRangeDays = 366
const maximumInt = 2_147_483_647n
const maximumMoney = new Prisma.Decimal('9999999999999999.99')
const zeroMoney = '0.00'

type NumericValue = Prisma.Decimal | string | number | bigint

interface RawFinancialDay {
  readonly reportDate: Date | string
  readonly salesCount: bigint | number | string
  readonly totalUnitsSold: bigint | number | string
  readonly grossRevenue: NumericValue
  readonly returnedRevenue: NumericValue
  readonly voidedRevenue: NumericValue
  readonly rawGrossCOGS: NumericValue
  readonly rawReturnedCOGS: NumericValue
  readonly rawVoidedCOGS: NumericValue
  readonly operatingExpenses: NumericValue
  readonly currencyMismatch: boolean
}

function fail(code: ConstructorParameters<typeof FinancialComputationError>[0], message: string): never {
  throw new FinancialComputationError(code, message)
}

export function parseReportDate(value: string): Date {
  if (!reportDatePattern.test(value) || value.startsWith('0000-')) {
    return fail('INVALID_FINANCIAL_DATE', 'Report dates must use YYYY-MM-DD')
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return fail('INVALID_FINANCIAL_DATE', 'Report date must be a valid Gregorian calendar date')
  }
  return date
}

function formatReportDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return parseReportDate(value).toISOString().slice(0, 10)
}

export function enumerateReportDates(fromDate: string, toDate: string): readonly string[] {
  const from = parseReportDate(fromDate)
  const to = parseReportDate(toDate)
  const dayCount = Math.floor((to.getTime() - from.getTime()) / millisecondsPerDay) + 1
  if (dayCount < 1 || dayCount > maximumRangeDays) {
    return fail('INVALID_FINANCIAL_RANGE', `Financial ranges must contain 1 to ${maximumRangeDays} days`)
  }
  return Array.from({ length: dayCount }, (_, index) =>
    new Date(from.getTime() + index * millisecondsPerDay).toISOString().slice(0, 10))
}

function decimal(value: NumericValue): Prisma.Decimal {
  try {
    return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value.toString())
  } catch {
    return fail('FINANCIAL_INVARIANT_VIOLATION', 'Financial aggregate is invalid')
  }
}

function money(value: NumericValue): string {
  const amount = decimal(value)
  if (!amount.isFinite() || amount.decimalPlaces() > 2 || amount.abs().gt(maximumMoney)) {
    return fail('FINANCIAL_VALUE_OVERFLOW', 'Financial amount does not fit Decimal(18,2)')
  }
  return amount.toFixed(2)
}

function nonnegativeMoney(value: NumericValue): string {
  const amount = decimal(value)
  if (amount.isNegative()) {
    return fail('FINANCIAL_INVARIANT_VIOLATION', 'Financial magnitude must not be negative')
  }
  return money(amount)
}

export function roundDailyCogs(value: NumericValue): string {
  const raw = decimal(value)
  if (raw.isNegative()) {
    return fail('FINANCIAL_INVARIANT_VIOLATION', 'COGS magnitude must not be negative')
  }
  const rounded = raw.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
  return money(rounded)
}

function integer(value: RawFinancialDay['salesCount']): number {
  let parsed: bigint
  try {
    parsed = BigInt(value)
  } catch {
    return fail('FINANCIAL_INVARIANT_VIOLATION', 'Financial count is invalid')
  }
  if (parsed < 0n || parsed > maximumInt) {
    return fail('FINANCIAL_VALUE_OVERFLOW', 'Financial count does not fit PostgreSQL Int')
  }
  return Number(parsed)
}

function deriveDay(
  reportDate: string,
  currency: string,
  values: {
    salesCount: number
    totalUnitsSold: number
    grossRevenue: string
    returnedRevenue: string
    voidedRevenue: string
    grossCOGS: string
    returnedCOGS: string
    voidedCOGS: string
    operatingExpenses: string
  },
): DailyFinancials {
  const grossRevenue = decimal(values.grossRevenue)
  const returnedRevenue = decimal(values.returnedRevenue)
  const voidedRevenue = decimal(values.voidedRevenue)
  const grossCOGS = decimal(values.grossCOGS)
  const returnedCOGS = decimal(values.returnedCOGS)
  const voidedCOGS = decimal(values.voidedCOGS)
  const operatingExpenses = decimal(values.operatingExpenses)
  const netRevenue = money(grossRevenue.sub(returnedRevenue).sub(voidedRevenue))
  const netCOGS = money(grossCOGS.sub(returnedCOGS).sub(voidedCOGS))
  const grossProfit = money(decimal(netRevenue).sub(netCOGS))
  const netProfit = money(decimal(grossProfit).sub(operatingExpenses))
  return {
    reportDate,
    currency,
    salesCount: values.salesCount,
    totalUnitsSold: values.totalUnitsSold,
    grossRevenue: money(grossRevenue),
    returnedRevenue: money(returnedRevenue),
    voidedRevenue: money(voidedRevenue),
    netRevenue,
    grossCOGS: money(grossCOGS),
    returnedCOGS: money(returnedCOGS),
    voidedCOGS: money(voidedCOGS),
    netCOGS,
    grossProfit,
    operatingExpenses: money(operatingExpenses),
    netProfit,
    stockValue: null,
  }
}

function zeroDay(reportDate: string, currency: string): DailyFinancials {
  return deriveDay(reportDate, currency, {
    salesCount: 0,
    totalUnitsSold: 0,
    grossRevenue: zeroMoney,
    returnedRevenue: zeroMoney,
    voidedRevenue: zeroMoney,
    grossCOGS: zeroMoney,
    returnedCOGS: zeroMoney,
    voidedCOGS: zeroMoney,
    operatingExpenses: zeroMoney,
  })
}

export async function computeFinancialRangeInTransaction(
  transaction: FinancialTransaction,
  accountId: string,
  fromDate: string,
  toDate: string,
): Promise<readonly DailyFinancials[]> {
  const requestedDates = enumerateReportDates(fromDate, toDate)
  const account = await transaction.account.findUnique({
    where: { id: accountId },
    select: { baseCurrency: true },
  })
  if (!account || !/^[A-Z]{3}$/.test(account.baseCurrency)) {
    return fail('FINANCIAL_ACCOUNT_NOT_FOUND', 'Financial Account is unavailable')
  }

  const rows = await transaction.$queryRaw<RawFinancialDay[]>(Prisma.sql`
    WITH bounds AS (
      SELECT ${fromDate}::date AS from_date, ${toDate}::date AS to_date
    ),
    days AS (
      SELECT generate_series(from_date, to_date, interval '1 day')::date AS report_date
      FROM bounds
    ),
    sale_totals AS (
      SELECT (s."createdAt" AT TIME ZONE 'UTC')::date AS report_date,
             COUNT(*)::bigint AS sales_count,
             COALESCE(SUM(s."totalAmount"), 0::numeric) AS gross_revenue,
             BOOL_OR(s."currency" <> ${account.baseCurrency}) AS currency_mismatch
      FROM "Sale" s, bounds b
      WHERE s."accountId" = ${accountId}::uuid
        AND s."createdAt" >= (b.from_date::timestamp AT TIME ZONE 'UTC')
        AND s."createdAt" < ((b.to_date + 1)::timestamp AT TIME ZONE 'UTC')
      GROUP BY 1
    ),
    gross_item_totals AS (
      SELECT (s."createdAt" AT TIME ZONE 'UTC')::date AS report_date,
             COALESCE(SUM(si."quantity"), 0)::bigint AS total_units_sold,
             COALESCE(SUM(si."quantity"::numeric * si."unitCostAtSale"), 0::numeric) AS raw_gross_cogs
      FROM "Sale" s
      JOIN "SaleItem" si ON si."saleId" = s."id" AND si."accountId" = s."accountId"
      CROSS JOIN bounds b
      WHERE s."accountId" = ${accountId}::uuid
        AND s."createdAt" >= (b.from_date::timestamp AT TIME ZONE 'UTC')
        AND s."createdAt" < ((b.to_date + 1)::timestamp AT TIME ZONE 'UTC')
      GROUP BY 1
    ),
    return_totals AS (
      SELECT (sr."createdAt" AT TIME ZONE 'UTC')::date AS report_date,
             COALESCE(SUM(sri."refundAmount"), 0::numeric) AS returned_revenue,
             COALESCE(SUM(sri."quantity"::numeric * si."unitCostAtSale"), 0::numeric) AS raw_returned_cogs,
             BOOL_OR(s."currency" <> ${account.baseCurrency}) AS currency_mismatch
      FROM "SaleReturn" sr
      JOIN "SaleReturnItem" sri ON sri."returnId" = sr."id" AND sri."accountId" = sr."accountId"
      JOIN "SaleItem" si ON si."id" = sri."saleItemId" AND si."saleId" = sri."saleId" AND si."accountId" = sri."accountId"
      JOIN "Sale" s ON s."id" = sr."saleId" AND s."accountId" = sr."accountId"
      CROSS JOIN bounds b
      WHERE sr."accountId" = ${accountId}::uuid
        AND sr."createdAt" >= (b.from_date::timestamp AT TIME ZONE 'UTC')
        AND sr."createdAt" < ((b.to_date + 1)::timestamp AT TIME ZONE 'UTC')
      GROUP BY 1
    ),
    void_totals AS (
      SELECT (s."voidedAt" AT TIME ZONE 'UTC')::date AS report_date,
             COALESCE(SUM(s."totalAmount"), 0::numeric) AS voided_revenue,
             BOOL_OR(s."currency" <> ${account.baseCurrency}) AS currency_mismatch
      FROM "Sale" s, bounds b
      WHERE s."accountId" = ${accountId}::uuid
        AND s."voidedAt" >= (b.from_date::timestamp AT TIME ZONE 'UTC')
        AND s."voidedAt" < ((b.to_date + 1)::timestamp AT TIME ZONE 'UTC')
      GROUP BY 1
    ),
    void_item_totals AS (
      SELECT (s."voidedAt" AT TIME ZONE 'UTC')::date AS report_date,
             COALESCE(SUM(si."quantity"::numeric * si."unitCostAtSale"), 0::numeric) AS raw_voided_cogs
      FROM "Sale" s
      JOIN "SaleItem" si ON si."saleId" = s."id" AND si."accountId" = s."accountId"
      CROSS JOIN bounds b
      WHERE s."accountId" = ${accountId}::uuid
        AND s."voidedAt" >= (b.from_date::timestamp AT TIME ZONE 'UTC')
        AND s."voidedAt" < ((b.to_date + 1)::timestamp AT TIME ZONE 'UTC')
      GROUP BY 1
    ),
    expense_totals AS (
      SELECT e."expenseDate" AS report_date,
             COALESCE(SUM(e."amount"), 0::numeric) AS operating_expenses,
             BOOL_OR(e."currency" <> ${account.baseCurrency}) AS currency_mismatch
      FROM "Expense" e, bounds b
      WHERE e."accountId" = ${accountId}::uuid
        AND e."expenseDate" BETWEEN b.from_date AND b.to_date
      GROUP BY 1
    )
    SELECT d.report_date AS "reportDate",
           COALESCE(st.sales_count, 0::bigint) AS "salesCount",
           COALESCE(git.total_units_sold, 0::bigint) AS "totalUnitsSold",
           COALESCE(st.gross_revenue, 0::numeric) AS "grossRevenue",
           COALESCE(rt.returned_revenue, 0::numeric) AS "returnedRevenue",
           COALESCE(vt.voided_revenue, 0::numeric) AS "voidedRevenue",
           COALESCE(git.raw_gross_cogs, 0::numeric) AS "rawGrossCOGS",
           COALESCE(rt.raw_returned_cogs, 0::numeric) AS "rawReturnedCOGS",
           COALESCE(vit.raw_voided_cogs, 0::numeric) AS "rawVoidedCOGS",
           COALESCE(et.operating_expenses, 0::numeric) AS "operatingExpenses",
           COALESCE(st.currency_mismatch, false)
             OR COALESCE(rt.currency_mismatch, false)
             OR COALESCE(vt.currency_mismatch, false)
             OR COALESCE(et.currency_mismatch, false) AS "currencyMismatch"
    FROM days d
    LEFT JOIN sale_totals st ON st.report_date = d.report_date
    LEFT JOIN gross_item_totals git ON git.report_date = d.report_date
    LEFT JOIN return_totals rt ON rt.report_date = d.report_date
    LEFT JOIN void_totals vt ON vt.report_date = d.report_date
    LEFT JOIN void_item_totals vit ON vit.report_date = d.report_date
    LEFT JOIN expense_totals et ON et.report_date = d.report_date
    ORDER BY d.report_date ASC
  `)

  const byDate = new Map<string, DailyFinancials>()
  for (const row of rows) {
    const reportDate = formatReportDate(row.reportDate)
    if (!requestedDates.includes(reportDate) || byDate.has(reportDate)) {
      return fail('FINANCIAL_INVARIANT_VIOLATION', 'Financial aggregation returned invalid report dates')
    }
    if (row.currencyMismatch) {
      return fail('FINANCIAL_INVARIANT_VIOLATION', 'Financial history contains mixed currencies')
    }
    byDate.set(reportDate, deriveDay(reportDate, account.baseCurrency, {
      salesCount: integer(row.salesCount),
      totalUnitsSold: integer(row.totalUnitsSold),
      grossRevenue: nonnegativeMoney(row.grossRevenue),
      returnedRevenue: nonnegativeMoney(row.returnedRevenue),
      voidedRevenue: nonnegativeMoney(row.voidedRevenue),
      grossCOGS: roundDailyCogs(row.rawGrossCOGS),
      returnedCOGS: roundDailyCogs(row.rawReturnedCOGS),
      voidedCOGS: roundDailyCogs(row.rawVoidedCOGS),
      operatingExpenses: nonnegativeMoney(row.operatingExpenses),
    }))
  }
  return requestedDates.map((reportDate) => byDate.get(reportDate) ?? zeroDay(reportDate, account.baseCurrency))
}

export async function computeDailyFinancialsInTransaction(
  transaction: FinancialTransaction,
  accountId: string,
  reportDate: string,
): Promise<DailyFinancials> {
  const [day] = await computeFinancialRangeInTransaction(transaction, accountId, reportDate, reportDate)
  if (!day) return fail('FINANCIAL_INVARIANT_VIOLATION', 'Daily financial calculation returned no result')
  return day
}

export function summarizeFinancialDays(days: readonly DailyFinancials[]): FinancialSummary {
  if (days.length === 0) return fail('INVALID_FINANCIAL_RANGE', 'At least one financial day is required')
  const currency = days[0]?.currency
  if (!currency || days.some((day) => day.currency !== currency)) {
    return fail('FINANCIAL_INVARIANT_VIOLATION', 'Financial summary contains mixed currencies')
  }
  const sumMagnitude = (field: keyof DailyFinancials): string => nonnegativeMoney(days.reduce(
    (sum, day) => sum.add(decimal(day[field] as string)),
    new Prisma.Decimal(0),
  ))
  const salesCount = integer(days.reduce((sum, day) => sum + BigInt(day.salesCount), 0n))
  const totalUnitsSold = integer(days.reduce((sum, day) => sum + BigInt(day.totalUnitsSold), 0n))
  const { reportDate: _reportDate, ...summary } = deriveDay('', currency, {
    salesCount,
    totalUnitsSold,
    grossRevenue: sumMagnitude('grossRevenue'),
    returnedRevenue: sumMagnitude('returnedRevenue'),
    voidedRevenue: sumMagnitude('voidedRevenue'),
    grossCOGS: sumMagnitude('grossCOGS'),
    returnedCOGS: sumMagnitude('returnedCOGS'),
    voidedCOGS: sumMagnitude('voidedCOGS'),
    operatingExpenses: sumMagnitude('operatingExpenses'),
  })
  return summary
}
