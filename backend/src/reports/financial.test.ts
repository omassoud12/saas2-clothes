import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { createDailyReportService } from './daily-report.service.js'
import {
  computeDailyFinancialsInTransaction,
  computeFinancialRangeInTransaction,
  parseReportDate,
  roundDailyCogs,
  summarizeFinancialDays,
} from './financial.service.js'
import type { DailyFinancials, FinancialTransaction } from './financial.types.js'
import { FinancialComputationError } from './financial.types.js'

const accountId = '11111111-1111-4111-8111-111111111111'

function rawDay(reportDate: string, overrides: Record<string, unknown> = {}) {
  return {
    reportDate,
    salesCount: 0n,
    totalUnitsSold: 0n,
    grossRevenue: new Prisma.Decimal(0),
    returnedRevenue: new Prisma.Decimal(0),
    voidedRevenue: new Prisma.Decimal(0),
    rawGrossCOGS: new Prisma.Decimal(0),
    rawReturnedCOGS: new Prisma.Decimal(0),
    rawVoidedCOGS: new Prisma.Decimal(0),
    operatingExpenses: new Prisma.Decimal(0),
    currencyMismatch: false,
    ...overrides,
  }
}

function expectFinancialError(error: unknown, code: string): boolean {
  assert.ok(error instanceof FinancialComputationError)
  assert.equal(error.code, code)
  return true
}

class FinancialStore {
  currency = 'USD'
  accountExists = true
  rows: ReturnType<typeof rawDay>[] = []
  events: string[] = []
  aggregateSql = ''
  queryCount = 0
  failUpsert = false
  report: Record<string, unknown> | null = null

  transaction(): FinancialTransaction {
    const store = this
    return {
      account: {
        async findUnique() {
          store.events.push('AccountRead')
          store.queryCount += 1
          return store.accountExists ? { baseCurrency: store.currency } : null
        },
      },
      async $queryRaw(sql: Prisma.Sql) {
        store.queryCount += 1
        const text = sql.sql
        if (text.includes('FOR UPDATE')) {
          store.events.push('AccountLock')
          return store.accountExists ? [{ id: accountId }] : []
        }
        store.events.push('Aggregate')
        store.aggregateSql = text
        return store.rows
      },
      dailyReport: {
        async upsert({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) {
          store.events.push('Upsert')
          if (store.failUpsert) throw new Error('sensitive database failure')
          store.report = store.report ? { ...store.report, ...update } : { id: 'report-id', ...create }
          return { id: 'report-id' }
        },
      },
    } as unknown as FinancialTransaction
  }

  client(): PrismaClient {
    const store = this
    return {
      async $transaction(callback: (transaction: FinancialTransaction) => Promise<unknown>, options: unknown) {
        store.events.push(`Transaction:${(options as { isolationLevel: string }).isolationLevel}`)
        const previous = store.report ? { ...store.report } : null
        try {
          return await callback(store.transaction())
        } catch (error) {
          store.report = previous
          throw error
        }
      },
    } as unknown as PrismaClient
  }
}

function zeroDay(reportDate: string): DailyFinancials {
  return {
    reportDate,
    currency: 'USD',
    salesCount: 0,
    totalUnitsSold: 0,
    grossRevenue: '0.00',
    returnedRevenue: '0.00',
    voidedRevenue: '0.00',
    netRevenue: '0.00',
    grossCOGS: '0.00',
    returnedCOGS: '0.00',
    voidedCOGS: '0.00',
    netCOGS: '0.00',
    grossProfit: '0.00',
    operatingExpenses: '0.00',
    netProfit: '0.00',
    costStatus: 'COMPLETE',
    stockValue: null,
  }
}

describe('financial range calculation', () => {
  test('validates strict Gregorian dates and the inclusive 1..366 day bound', async () => {
    assert.equal(parseReportDate('2028-02-29').toISOString(), '2028-02-29T00:00:00.000Z')
    for (const invalid of ['0000-01-01', '2027-02-29', '2026-02-30', '2026-9-01', '2026-09-01T00:00:00Z']) {
      assert.throws(() => parseReportDate(invalid), (error) => expectFinancialError(error, 'INVALID_FINANCIAL_DATE'))
    }
    const store = new FinancialStore()
    const days = await computeFinancialRangeInTransaction(store.transaction(), accountId, '2024-01-01', '2024-12-31')
    assert.equal(days.length, 366)
    assert.equal(store.queryCount, 2)
    await assert.rejects(
      computeFinancialRangeInTransaction(store.transaction(), accountId, '2024-01-01', '2025-01-01'),
      (error) => expectFinancialError(error, 'INVALID_FINANCIAL_RANGE'),
    )
    await assert.rejects(
      computeFinancialRangeInTransaction(store.transaction(), accountId, '2026-09-25', '2026-09-24'),
      (error) => expectFinancialError(error, 'INVALID_FINANCIAL_RANGE'),
    )
  })

  test('assigns gross Sale, Return, Void, and Expense values to their occurrence days', async () => {
    const store = new FinancialStore()
    store.rows = [
      rawDay('2026-09-21', {
        salesCount: 1n, totalUnitsSold: 2n, grossRevenue: '100.00', rawGrossCOGS: '60.0000',
      }),
      rawDay('2026-09-22', {
        returnedRevenue: '25.00', rawReturnedCOGS: '15.0000', operatingExpenses: '20.00',
      }),
      rawDay('2026-09-23', { voidedRevenue: '100.00', rawVoidedCOGS: '60.0000' }),
    ]
    const days = await computeFinancialRangeInTransaction(store.transaction(), accountId, '2026-09-21', '2026-09-24')
    assert.deepEqual(days.map((day) => day.reportDate), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'])
    assert.deepEqual(days[0], {
      ...zeroDay('2026-09-21'), salesCount: 1, totalUnitsSold: 2,
      grossRevenue: '100.00', netRevenue: '100.00', grossCOGS: '60.00', netCOGS: '60.00',
      grossProfit: '40.00', netProfit: '40.00',
    })
    assert.deepEqual(days[1], {
      ...zeroDay('2026-09-22'), returnedRevenue: '25.00', netRevenue: '-25.00',
      returnedCOGS: '15.00', netCOGS: '-15.00', grossProfit: '-10.00',
      operatingExpenses: '20.00', netProfit: '-30.00',
    })
    assert.deepEqual(days[2], {
      ...zeroDay('2026-09-23'), voidedRevenue: '100.00', netRevenue: '-100.00',
      voidedCOGS: '60.00', netCOGS: '-60.00', grossProfit: '-40.00', netProfit: '-40.00',
    })
    assert.deepEqual(days[3], zeroDay('2026-09-24'))
  })

  test('uses set-based authoritative SQL and gives Exchange no direct financial contribution', async () => {
    const store = new FinancialStore()
    await computeDailyFinancialsInTransaction(store.transaction(), accountId, '2026-09-24')
    assert.match(store.aggregateSql, /"Sale"/)
    assert.match(store.aggregateSql, /"SaleReturn"/)
    assert.match(store.aggregateSql, /"Expense"/)
    assert.match(store.aggregateSql, /"createdAt" AT TIME ZONE 'UTC'/)
    assert.match(store.aggregateSql, /"voidedAt" AT TIME ZONE 'UTC'/)
    assert.match(store.aggregateSql, /e\."expenseDate" BETWEEN/)
    assert.match(store.aggregateSql, /si\."unitCostAtSale"/)
    assert.doesNotMatch(store.aggregateSql, /"Exchange"|"currentStock"|"lastPurchaseCost"/)
    assert.equal(store.queryCount, 2)
  })

  test('encodes exact half-open UTC boundaries without Sale status or Expense timestamp authority', async () => {
    const store = new FinancialStore()
    await computeFinancialRangeInTransaction(store.transaction(), accountId, '2026-09-23', '2026-09-24')
    const saleCtes = store.aggregateSql.split('sale_totals AS (')[1]?.split('return_totals AS (')[0] ?? ''
    const returnCte = store.aggregateSql.split('return_totals AS (')[1]?.split('void_totals AS (')[0] ?? ''
    const voidCtes = store.aggregateSql.split('void_totals AS (')[1]?.split('expense_totals AS (')[0] ?? ''
    const expenseCte = store.aggregateSql.split('expense_totals AS (')[1]?.split('SELECT d.report_date')[0] ?? ''

    assert.match(saleCtes, /s\."createdAt" >= \(b\.from_date::timestamp AT TIME ZONE 'UTC'\)/)
    assert.match(saleCtes, /s\."createdAt" < \(\(b\.to_date \+ 1\)::timestamp AT TIME ZONE 'UTC'\)/)
    assert.doesNotMatch(saleCtes, /s\."status"/)
    assert.match(returnCte, /sr\."createdAt" >= \(b\.from_date::timestamp AT TIME ZONE 'UTC'\)/)
    assert.match(returnCte, /sr\."createdAt" < \(\(b\.to_date \+ 1\)::timestamp AT TIME ZONE 'UTC'\)/)
    assert.match(voidCtes, /s\."voidedAt" >= \(b\.from_date::timestamp AT TIME ZONE 'UTC'\)/)
    assert.match(voidCtes, /s\."voidedAt" < \(\(b\.to_date \+ 1\)::timestamp AT TIME ZONE 'UTC'\)/)
    assert.match(expenseCte, /e\."expenseDate" BETWEEN b\.from_date AND b\.to_date/)
    assert.doesNotMatch(expenseCte, /"createdAt"|AT TIME ZONE/)
  })

  test('keeps header totals exact for a multi-item Sale, multiple Returns/Expenses, and multi-item Void', async () => {
    const store = new FinancialStore()
    store.rows = [rawDay('2026-09-24', {
      salesCount: 1n,
      totalUnitsSold: 6n,
      grossRevenue: '100.00',
      returnedRevenue: '30.00',
      voidedRevenue: '100.00',
      rawGrossCOGS: '15.5554',
      rawReturnedCOGS: '3.3333',
      rawVoidedCOGS: '15.5554',
      operatingExpenses: '12.00',
    })]
    const day = await computeDailyFinancialsInTransaction(store.transaction(), accountId, '2026-09-24')

    assert.deepEqual(day, {
      ...zeroDay('2026-09-24'),
      salesCount: 1,
      totalUnitsSold: 6,
      grossRevenue: '100.00',
      returnedRevenue: '30.00',
      voidedRevenue: '100.00',
      netRevenue: '-30.00',
      grossCOGS: '15.56',
      returnedCOGS: '3.33',
      voidedCOGS: '15.56',
      netCOGS: '-3.33',
      grossProfit: '-26.67',
      operatingExpenses: '12.00',
      netProfit: '-38.67',
    })

    const saleHeaderCte = store.aggregateSql.split('sale_totals AS (')[1]?.split('gross_item_totals AS (')[0] ?? ''
    const voidHeaderCte = store.aggregateSql.split('void_totals AS (')[1]?.split('void_item_totals AS (')[0] ?? ''
    const expenseCte = store.aggregateSql.split('expense_totals AS (')[1]?.split('SELECT d.report_date')[0] ?? ''
    assert.match(saleHeaderCte, /COUNT\(\*\).*SUM\(s\."totalAmount"\)/s)
    assert.doesNotMatch(saleHeaderCte, /"SaleItem"/)
    assert.match(voidHeaderCte, /SUM\(s\."totalAmount"\)/)
    assert.doesNotMatch(voidHeaderCte, /"SaleItem"/)
    assert.match(expenseCte, /SUM\(e\."amount"\)/)
    assert.doesNotMatch(expenseCte, /JOIN/)
  })

  test('keeps multiple Sales, partial Returns, and Voids on their exact occurrence days', async () => {
    const store = new FinancialStore()
    store.rows = [
      rawDay('2026-09-21', {
        salesCount: 2n, totalUnitsSold: 7n, grossRevenue: '170.00', rawGrossCOGS: '80.0049',
      }),
      rawDay('2026-09-22', { returnedRevenue: '15.00', rawReturnedCOGS: '6.0049' }),
      rawDay('2026-09-23', { returnedRevenue: '20.00', rawReturnedCOGS: '8.0050' }),
      rawDay('2026-09-24', { voidedRevenue: '90.00', rawVoidedCOGS: '42.0050' }),
    ]
    const days = await computeFinancialRangeInTransaction(
      store.transaction(), accountId, '2026-09-21', '2026-09-24',
    )
    assert.deepEqual(days.map((day) => ({
      reportDate: day.reportDate,
      salesCount: day.salesCount,
      grossRevenue: day.grossRevenue,
      returnedRevenue: day.returnedRevenue,
      voidedRevenue: day.voidedRevenue,
    })), [
      { reportDate: '2026-09-21', salesCount: 2, grossRevenue: '170.00', returnedRevenue: '0.00', voidedRevenue: '0.00' },
      { reportDate: '2026-09-22', salesCount: 0, grossRevenue: '0.00', returnedRevenue: '15.00', voidedRevenue: '0.00' },
      { reportDate: '2026-09-23', salesCount: 0, grossRevenue: '0.00', returnedRevenue: '20.00', voidedRevenue: '0.00' },
      { reportDate: '2026-09-24', salesCount: 0, grossRevenue: '0.00', returnedRevenue: '0.00', voidedRevenue: '90.00' },
    ])
    const summary = summarizeFinancialDays(days)
    assert.equal(summary.totalUnitsSold, 7)
    assert.equal(summary.netRevenue, '45.00')
    assert.equal(summary.grossCOGS, '80.00')
    assert.equal(summary.returnedCOGS, '14.01')
    assert.equal(summary.voidedCOGS, '42.01')
    assert.equal(summary.netCOGS, '23.98')
    assert.equal(summary.grossProfit, '21.02')
    assert.equal(summary.netProfit, '21.02')
  })

  test('keeps replacement Sale gross activity and its later Void on their own UTC days', async () => {
    const store = new FinancialStore()
    store.rows = [
      rawDay('2026-09-22', {
        salesCount: 1n, totalUnitsSold: 1n, grossRevenue: '40.00', rawGrossCOGS: '18.0000',
      }),
      rawDay('2026-09-24', { voidedRevenue: '40.00', rawVoidedCOGS: '18.0000' }),
    ]
    const days = await computeFinancialRangeInTransaction(store.transaction(), accountId, '2026-09-22', '2026-09-24')
    assert.equal(days[0]?.grossRevenue, '40.00')
    assert.equal(days[0]?.grossCOGS, '18.00')
    assert.deepEqual(days[1], zeroDay('2026-09-23'))
    assert.equal(days[2]?.voidedRevenue, '40.00')
    assert.equal(days[2]?.voidedCOGS, '18.00')
  })

  test('rounds each daily COGS component once with HALF_UP before range summarization', async () => {
    assert.equal(roundDailyCogs('0.0049'), '0.00')
    assert.equal(roundDailyCogs('0.0050'), '0.01')
    assert.equal(roundDailyCogs('0.0051'), '0.01')
    assert.equal(roundDailyCogs('123456789.9950'), '123456790.00')
    const store = new FinancialStore()
    store.rows = [
      rawDay('2026-09-21', { rawGrossCOGS: '0.0049' }),
      rawDay('2026-09-22', { rawGrossCOGS: '0.0049' }),
    ]
    const days = await computeFinancialRangeInTransaction(store.transaction(), accountId, '2026-09-21', '2026-09-22')
    assert.deepEqual(days.map((day) => day.grossCOGS), ['0.00', '0.00'])
    assert.equal(summarizeFinancialDays(days).grossCOGS, '0.00')
  })

  test('summarizes daily rounded components and preserves all accounting equations', () => {
    const first = { ...zeroDay('2026-09-21'), grossRevenue: '100.00', netRevenue: '100.00', grossCOGS: '60.00', netCOGS: '60.00', grossProfit: '40.00', netProfit: '40.00', salesCount: 1, totalUnitsSold: 2 }
    const second = { ...zeroDay('2026-09-22'), returnedRevenue: '25.00', netRevenue: '-25.00', returnedCOGS: '15.00', netCOGS: '-15.00', grossProfit: '-10.00', operatingExpenses: '20.00', netProfit: '-30.00' }
    const summary = summarizeFinancialDays([first, second])
    assert.equal(summary.grossRevenue, '100.00')
    assert.equal(summary.returnedRevenue, '25.00')
    assert.equal(summary.netRevenue, '75.00')
    assert.equal(summary.netCOGS, '45.00')
    assert.equal(summary.grossProfit, '30.00')
    assert.equal(summary.netProfit, '10.00')
    assert.equal(summary.netProfit, new Prisma.Decimal(first.netProfit).add(second.netProfit).toFixed(2))
    assert.equal(summary.stockValue, null)
  })

  test('rejects mixed currencies and Decimal/Int overflow at the aggregate boundary', async () => {
    const mixed = new FinancialStore()
    mixed.rows = [rawDay('2026-09-24', { currencyMismatch: true })]
    await assert.rejects(
      computeDailyFinancialsInTransaction(mixed.transaction(), accountId, '2026-09-24'),
      (error) => expectFinancialError(error, 'FINANCIAL_INVARIANT_VIOLATION'),
    )
    const moneyOverflow = new FinancialStore()
    moneyOverflow.rows = [rawDay('2026-09-24', { grossRevenue: '10000000000000000.00' })]
    await assert.rejects(
      computeDailyFinancialsInTransaction(moneyOverflow.transaction(), accountId, '2026-09-24'),
      (error) => expectFinancialError(error, 'FINANCIAL_VALUE_OVERFLOW'),
    )
    const intOverflow = new FinancialStore()
    intOverflow.rows = [rawDay('2026-09-24', { salesCount: 2_147_483_648n })]
    await assert.rejects(
      computeDailyFinancialsInTransaction(intOverflow.transaction(), accountId, '2026-09-24'),
      (error) => expectFinancialError(error, 'FINANCIAL_VALUE_OVERFLOW'),
    )
    const negativeMagnitude = new FinancialStore()
    negativeMagnitude.rows = [rawDay('2026-09-24', { operatingExpenses: '-0.01' })]
    await assert.rejects(
      computeDailyFinancialsInTransaction(negativeMagnitude.transaction(), accountId, '2026-09-24'),
      (error) => expectFinancialError(error, 'FINANCIAL_INVARIANT_VIOLATION'),
    )
  })

  test('accepts exact Decimal/Int maxima and rejects rounded or derived overflow without clamping', async () => {
    const exact = new FinancialStore()
    exact.rows = [rawDay('2026-09-24', {
      salesCount: 2_147_483_647n,
      totalUnitsSold: 2_147_483_647n,
      grossRevenue: '9999999999999999.99',
      rawGrossCOGS: '9999999999999999.9949',
    })]
    const day = await computeDailyFinancialsInTransaction(exact.transaction(), accountId, '2026-09-24')
    assert.equal(day.salesCount, 2_147_483_647)
    assert.equal(day.totalUnitsSold, 2_147_483_647)
    assert.equal(day.grossRevenue, '9999999999999999.99')
    assert.equal(day.grossCOGS, '9999999999999999.99')

    const roundedOverflow = new FinancialStore()
    roundedOverflow.rows = [rawDay('2026-09-24', { rawGrossCOGS: '9999999999999999.9950' })]
    await assert.rejects(
      computeDailyFinancialsInTransaction(roundedOverflow.transaction(), accountId, '2026-09-24'),
      (error) => expectFinancialError(error, 'FINANCIAL_VALUE_OVERFLOW'),
    )

    const derivedOverflow = new FinancialStore()
    derivedOverflow.rows = [rawDay('2026-09-24', {
      returnedRevenue: '9999999999999999.99',
      voidedRevenue: '9999999999999999.99',
    })]
    await assert.rejects(
      computeDailyFinancialsInTransaction(derivedOverflow.transaction(), accountId, '2026-09-24'),
      (error) => expectFinancialError(error, 'FINANCIAL_VALUE_OVERFLOW'),
    )

    const unitsOverflow = new FinancialStore()
    unitsOverflow.rows = [rawDay('2026-09-24', { totalUnitsSold: 2_147_483_648n })]
    await assert.rejects(
      computeDailyFinancialsInTransaction(unitsOverflow.transaction(), accountId, '2026-09-24'),
      (error) => expectFinancialError(error, 'FINANCIAL_VALUE_OVERFLOW'),
    )
  })
})

describe('DailyReport rebuild', () => {
  test('uses lock-compatible READ COMMITTED, locks Account first, and idempotently upserts one cache row', async () => {
    const store = new FinancialStore()
    store.rows = [rawDay('2026-09-24', { grossRevenue: '10.00', rawGrossCOGS: '4.0000' })]
    const service = createDailyReportService(store.client())
    const first = await service.rebuildDailyReport(accountId, '2026-09-24')
    const firstComputedAt = first.computedAt
    const second = await service.rebuildDailyReport(accountId, '2026-09-24')
    assert.deepEqual(store.events.slice(0, 5), [
      `Transaction:${Prisma.TransactionIsolationLevel.ReadCommitted}`,
      'AccountLock', 'AccountRead', 'Aggregate', 'Upsert',
    ])
    assert.equal(first.grossRevenue, '10.00')
    assert.equal(second.grossRevenue, first.grossRevenue)
    assert.equal(store.report?.stockValue, null)
    assert.equal(store.report?.reportDate instanceof Date, true)
    assert.ok(second.computedAt.getTime() >= firstComputedAt.getTime())
  })

  test('rebuilds an empty day and updates the same cache row after authoritative results change', async () => {
    const store = new FinancialStore()
    const service = createDailyReportService(store.client())
    const empty = await service.rebuildDailyReport(accountId, '2026-09-24')
    assert.deepEqual({ ...empty, computedAt: undefined }, { ...zeroDay('2026-09-24'), computedAt: undefined })
    store.rows = [rawDay('2026-09-24', { operatingExpenses: '20.00' })]
    const changed = await service.rebuildDailyReport(accountId, '2026-09-24')
    assert.equal(changed.operatingExpenses, '20.00')
    assert.equal(changed.netProfit, '-20.00')
    assert.equal(store.report?.operatingExpenses, '20.00')
  })

  test('keeps rebuilt cache fields identical to live authoritative output after each event class', async () => {
    const scenarios = [
      rawDay('2026-09-24', {
        salesCount: 2n, totalUnitsSold: 5n, grossRevenue: '120.00', rawGrossCOGS: '70.0050',
      }),
      rawDay('2026-09-24', {
        returnedRevenue: '25.00', rawReturnedCOGS: '12.3450',
      }),
      rawDay('2026-09-24', {
        voidedRevenue: '80.00', rawVoidedCOGS: '44.4450',
      }),
      rawDay('2026-09-24', { operatingExpenses: '19.99' }),
      rawDay('2026-09-24', {
        salesCount: 1n, totalUnitsSold: 1n, grossRevenue: '40.00', returnedRevenue: '30.00',
        rawGrossCOGS: '18.0000', rawReturnedCOGS: '13.5000',
      }),
    ]

    for (const authoritativeRow of scenarios) {
      const store = new FinancialStore()
      store.rows = [authoritativeRow]
      const live = await computeDailyFinancialsInTransaction(store.transaction(), accountId, '2026-09-24')
      const rebuilt = await createDailyReportService(store.client()).rebuildDailyReport(accountId, '2026-09-24')
      const { computedAt: _computedAt, ...rebuiltFinancials } = rebuilt
      assert.deepEqual(rebuiltFinancials, live)
      for (const [field, value] of Object.entries(live)) {
        if (field !== 'reportDate') assert.deepEqual(store.report?.[field], value)
      }
    }
  })

  test('rolls back cache state and returns a safe error when persistence fails', async () => {
    const store = new FinancialStore()
    store.report = { id: 'report-id', grossRevenue: '7.00' }
    store.rows = [rawDay('2026-09-24', { grossRevenue: '10.00' })]
    store.failUpsert = true
    await assert.rejects(
      createDailyReportService(store.client()).rebuildDailyReport(accountId, '2026-09-24'),
      (error) => expectFinancialError(error, 'FINANCIAL_REBUILD_FAILED'),
    )
    assert.deepEqual(store.report, { id: 'report-id', grossRevenue: '7.00' })
  })
})

test('unknown-cost activity keeps revenue exact and all final economics unavailable, including cache and summary',async()=>{
 const store=new FinancialStore()
 for (const knownCogs of ['0','12.3456']) {
 store.rows=[rawDay('2026-09-24',{grossRevenue:'50.00',rawGrossCOGS:knownCogs,costIncomplete:true,salesCount:1n,totalUnitsSold:2n})]
 const day=await computeDailyFinancialsInTransaction(store.transaction(),accountId,'2026-09-24')
 assert.equal(day.netRevenue,'50.00')
 assert.equal(day.costStatus,'INCOMPLETE')
 for(const field of ['grossCOGS','returnedCOGS','voidedCOGS','netCOGS','grossProfit','netProfit'] as const) assert.equal(day[field],null)
 const summary=summarizeFinancialDays([zeroDay('2026-09-23'),day])
 assert.equal(summary.netRevenue,'50.00');assert.equal(summary.netProfit,null);assert.equal(summary.costStatus,'INCOMPLETE')
 await createDailyReportService(store.client()).rebuildDailyReport(accountId,'2026-09-24')
 assert.equal(store.report?.costStatus,'INCOMPLETE');assert.equal(store.report?.grossCOGS,null)
 assert.match(store.aggregateSql,/BOOL_OR\(si\."unitCostAtSale" IS NULL\)/)
 }
})

test('unknown-cost migration preserves exact null-safe ledger matching and snapshot immutability',async()=>{
 const sql=await readFile(new URL('../../prisma/migrations/20260929030000_allow_unknown_sale_cost/migration.sql',import.meta.url),'utf8')
 assert.match(sql,/ALTER TABLE "SaleItem" ALTER COLUMN "unitCostAtSale" DROP NOT NULL/)
 assert.match(sql,/IS DISTINCT FROM historical_unit_cost/)
 assert.doesNotMatch(sql,/IF NEW\."unitCost" IS NULL/)
 assert.doesNotMatch(sql,/UPDATE "SaleItem"|DELETE FROM|DROP TABLE/)
 assert.match(sql,/DailyReport_cost_completeness_check/)
 for(const type of ['SALE','RETURN','SALE_VOID']) assert.ok(sql.includes(`'${type}'`))
})
