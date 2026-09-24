import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { createReportRouter } from './report.routes.js'
import { parseDailyReportQuery, parseSummaryReportQuery } from './report.schemas.js'
import { createReportDependencies } from './report.service.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const ownerA = '33333333-3333-4333-8333-333333333333'

type Row = Record<string, unknown>

function rawDay(reportDate: string, overrides: Row = {}): Row {
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

function expectHttp(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  return true
}

class ReportStore {
  readonly accounts = new Map([[accountA, 'USD'], [accountB, 'LBP']])
  readonly rows = new Map<string, Row[]>([[accountA, []], [accountB, []]])
  readonly isolationLevels: string[] = []
  readonly aggregateSql: string[] = []
  accountReads = 0
  aggregateQueries = 0
  dailyReportReads = 0
  mutations = 0
  staleDailyReport = { grossRevenue: '999.00', computedAt: new Date('2020-01-01T00:00:00Z') }
  failUnexpectedly = false

  client(): PrismaClient {
    const store = this
    return {
      async $transaction(
        callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel: string },
      ) {
        store.isolationLevels.push(options.isolationLevel)
        let selectedAccountId = ''
        const transaction = {
          account: {
            async findUnique({ where }: { where: { id: string } }) {
              if (store.failUnexpectedly) throw new Error('sensitive database detail')
              store.accountReads += 1
              selectedAccountId = where.id
              const currency = store.accounts.get(where.id)
              return currency ? { baseCurrency: currency } : null
            },
          },
          async $queryRaw(sql: Prisma.Sql) {
            store.aggregateQueries += 1
            store.aggregateSql.push(sql.sql)
            const from = sql.values[0] as string
            const to = sql.values[1] as string
            return (store.rows.get(selectedAccountId) ?? []).filter((row) =>
              typeof row.reportDate === 'string' && row.reportDate >= from && row.reportDate <= to)
          },
          dailyReport: {
            async findMany() { store.dailyReportReads += 1; return [store.staleDailyReport] },
            async upsert() { store.mutations += 1; throw new Error('Report GET must not mutate cache') },
          },
          sale: { async update() { store.mutations += 1 } },
          expense: { async create() { store.mutations += 1 } },
          inventoryMovement: { async create() { store.mutations += 1 } },
        } as unknown as Prisma.TransactionClient
        return callback(transaction)
      },
    } as unknown as PrismaClient
  }
}

describe('report query validation', () => {
  test('accepts one strict daily date and rejects missing, duplicate, timestamp, impossible, or unknown input', () => {
    assert.deepEqual(parseDailyReportQuery({ date: '2028-02-29' }), { date: '2028-02-29' })
    for (const query of [
      {},
      { date: ['2026-09-24', '2026-09-25'] },
      { date: '2027-02-29' },
      { date: '2026-09-24T00:00:00Z' },
      { date: '2026-09-24+03:00' },
      { date: '2026-09-24', accountId: accountB },
    ]) {
      assert.throws(() => parseDailyReportQuery(query), (error) => {
        assert.ok(error instanceof HttpError)
        assert.equal(error.status, 422)
        return true
      })
    }
  })

  test('accepts bounded inclusive summary ranges and rejects every invalid shape', () => {
    assert.deepEqual(parseSummaryReportQuery({ from: '2026-09-24', to: '2026-09-24' }), {
      from: '2026-09-24', to: '2026-09-24',
    })
    assert.doesNotThrow(() => parseSummaryReportQuery({ from: '2026-09-01', to: '2026-09-30' }))
    assert.doesNotThrow(() => parseSummaryReportQuery({ from: '2024-01-01', to: '2024-12-31' }))
    for (const query of [
      { to: '2026-09-24' },
      { from: '2026-09-24' },
      { from: '2026-09-25', to: '2026-09-24' },
      { from: '2024-01-01', to: '2025-01-01' },
      { from: '2027-02-29', to: '2027-03-01' },
      { from: '2026-09-01T00:00:00Z', to: '2026-09-02' },
      { from: ['2026-09-01', '2026-09-02'], to: '2026-09-02' },
      { from: '2026-09-01', to: ['2026-09-02', '2026-09-03'] },
      { from: '2026-09-01', to: '2026-09-02', preset: 'month' },
    ]) {
      assert.throws(() => parseSummaryReportQuery(query), (error) => {
        assert.ok(error instanceof HttpError)
        assert.equal(error.status, 422)
        return true
      })
    }
  })
})

describe('authoritative report service', () => {
  test('uses one REPEATABLE READ snapshot and authoritative history instead of stale DailyReport', async () => {
    const store = new ReportStore()
    store.rows.set(accountA, [rawDay('2026-09-24', {
      salesCount: 1n,
      totalUnitsSold: 3n,
      grossRevenue: '100.00',
      rawGrossCOGS: '60.0000',
    })])
    const result = await createReportDependencies(store.client()).getDailyReport(accountA, { date: '2026-09-24' })
    const summary = await createReportDependencies(store.client()).getSummaryReport(
      accountA,
      { from: '2026-09-24', to: '2026-09-24' },
    )
    assert.equal(result.report.grossRevenue, '100.00')
    assert.equal(summary.report.grossRevenue, '100.00')
    assert.equal(result.report.grossCOGS, '60.00')
    assert.equal(result.report.netProfit, '40.00')
    assert.notEqual(result.report.grossRevenue, store.staleDailyReport.grossRevenue)
    assert.deepEqual(store.isolationLevels, [
      Prisma.TransactionIsolationLevel.RepeatableRead,
      Prisma.TransactionIsolationLevel.RepeatableRead,
    ])
    assert.equal(store.accountReads, 2)
    assert.equal(store.aggregateQueries, 2)
    assert.equal(store.dailyReportReads, 0)
    assert.equal(store.mutations, 0)
    assert.deepEqual(store.staleDailyReport, {
      grossRevenue: '999.00', computedAt: new Date('2020-01-01T00:00:00Z'),
    })
    assert.doesNotMatch(store.aggregateSql[0] ?? '', /FOR UPDATE|"DailyReport"|"Exchange"/)
  })

  test('preserves Sale, Return, Void, Expense, negative, and summary equations by occurrence date', async () => {
    const store = new ReportStore()
    store.rows.set(accountA, [
      rawDay('2026-09-21', {
        salesCount: 1n, totalUnitsSold: 2n, grossRevenue: '100.00', rawGrossCOGS: '60.0000',
      }),
      rawDay('2026-09-22', {
        returnedRevenue: '25.00', rawReturnedCOGS: '15.0000', operatingExpenses: '20.00',
      }),
      rawDay('2026-09-23', { voidedRevenue: '100.00', rawVoidedCOGS: '60.0000' }),
    ])
    const reports = createReportDependencies(store.client())
    const saleDay = await reports.getDailyReport(accountA, { date: '2026-09-21' })
    const returnExpenseDay = await reports.getDailyReport(accountA, { date: '2026-09-22' })
    const voidDay = await reports.getDailyReport(accountA, { date: '2026-09-23' })
    const summary = await reports.getSummaryReport(accountA, { from: '2026-09-21', to: '2026-09-24' })
    assert.equal(saleDay.report.grossRevenue, '100.00')
    assert.equal(returnExpenseDay.report.returnedRevenue, '25.00')
    assert.equal(returnExpenseDay.report.returnedCOGS, '15.00')
    assert.equal(returnExpenseDay.report.operatingExpenses, '20.00')
    assert.equal(voidDay.report.voidedRevenue, '100.00')
    assert.equal(voidDay.report.voidedCOGS, '60.00')
    assert.deepEqual({
      from: summary.report.from,
      to: summary.report.to,
      daysCount: summary.report.daysCount,
      netRevenue: summary.report.netRevenue,
      netCOGS: summary.report.netCOGS,
      grossProfit: summary.report.grossProfit,
      netProfit: summary.report.netProfit,
      stockValue: summary.report.stockValue,
    }, {
      from: '2026-09-21', to: '2026-09-24', daysCount: 4,
      netRevenue: '-25.00', netCOGS: '-15.00', grossProfit: '-10.00',
      netProfit: '-30.00', stockValue: null,
    })
    assert.equal(Object.hasOwn(summary.report, 'days'), false)
    assert.equal(store.dailyReportReads, 0)
    assert.equal(store.mutations, 0)
  })

  test('returns Account currency and canonical zeros for empty daily and summary reports', async () => {
    const store = new ReportStore()
    const reports = createReportDependencies(store.client())
    const daily = await reports.getDailyReport(accountB, { date: '2026-09-24' })
    const summary = await reports.getSummaryReport(accountB, { from: '2026-09-24', to: '2026-09-26' })
    assert.deepEqual(daily.report, {
      reportDate: '2026-09-24', currency: 'LBP', salesCount: 0, totalUnitsSold: 0,
      grossRevenue: '0.00', returnedRevenue: '0.00', voidedRevenue: '0.00', netRevenue: '0.00',
      grossCOGS: '0.00', returnedCOGS: '0.00', voidedCOGS: '0.00', netCOGS: '0.00',
      grossProfit: '0.00', operatingExpenses: '0.00', netProfit: '0.00', stockValue: null,
    })
    assert.equal(summary.report.daysCount, 3)
    assert.equal(summary.report.currency, 'LBP')
    assert.equal(summary.report.netProfit, '0.00')
    assert.equal(summary.report.stockValue, null)
    assert.deepEqual(store.isolationLevels, [
      Prisma.TransactionIsolationLevel.RepeatableRead,
      Prisma.TransactionIsolationLevel.RepeatableRead,
    ])
  })

  test('keeps tenant history isolated and preserves daily-before-range COGS rounding', async () => {
    const store = new ReportStore()
    store.rows.set(accountA, [
      rawDay('2026-09-21', { salesCount: 1n, totalUnitsSold: 2n, grossRevenue: '10.00', rawGrossCOGS: '0.0049', operatingExpenses: '1.00' }),
      rawDay('2026-09-22', { salesCount: 1n, totalUnitsSold: 2n, grossRevenue: '10.00', rawGrossCOGS: '0.0049', operatingExpenses: '1.00' }),
    ])
    store.rows.set(accountB, [rawDay('2026-09-21', {
      salesCount: 4n, totalUnitsSold: 8n, grossRevenue: '999.00', rawGrossCOGS: '500.0000', operatingExpenses: '50.00',
    })])
    const reports = createReportDependencies(store.client())
    const tenantA = await reports.getSummaryReport(accountA, { from: '2026-09-21', to: '2026-09-22' })
    const tenantB = await reports.getSummaryReport(accountB, { from: '2026-09-21', to: '2026-09-22' })
    assert.equal(tenantA.report.grossRevenue, '20.00')
    assert.equal(tenantA.report.grossCOGS, '0.00')
    assert.equal(tenantA.report.salesCount, 2)
    assert.equal(tenantA.report.totalUnitsSold, 4)
    assert.equal(tenantA.report.operatingExpenses, '2.00')
    assert.equal(tenantA.report.netProfit, '18.00')
    assert.equal(tenantB.report.grossRevenue, '999.00')
    assert.equal(tenantB.report.salesCount, 4)
    assert.equal(tenantB.report.totalUnitsSold, 8)
    assert.equal(tenantB.report.operatingExpenses, '50.00')
    assert.equal(tenantB.report.netProfit, '449.00')
    assert.equal(tenantB.report.currency, 'LBP')
  })

  test('maps mixed currency and unexpected database failures to safe HTTP errors', async () => {
    const mixed = new ReportStore()
    mixed.rows.set(accountA, [rawDay('2026-09-24', { currencyMismatch: true })])
    await assert.rejects(
      createReportDependencies(mixed.client()).getDailyReport(accountA, { date: '2026-09-24' }),
      (error) => expectHttp(error, 500, 'FINANCIAL_REPORT_INVARIANT'),
    )
    const failed = new ReportStore()
    failed.failUnexpectedly = true
    await assert.rejects(
      createReportDependencies(failed.client()).getDailyReport(accountA, { date: '2026-09-24' }),
      (error) => expectHttp(error, 503, 'FINANCIAL_REPORT_UNAVAILABLE'),
    )
    const missing = new ReportStore()
    missing.accounts.delete(accountA)
    await assert.rejects(
      createReportDependencies(missing.client()).getDailyReport(accountA, { date: '2026-09-24' }),
      (error) => expectHttp(error, 409, 'REPORT_ACCOUNT_UNAVAILABLE'),
    )
    const overflow = new ReportStore()
    overflow.rows.set(accountA, [rawDay('2026-09-24', { grossRevenue: '10000000000000000.00' })])
    await assert.rejects(
      createReportDependencies(overflow.client()).getDailyReport(accountA, { date: '2026-09-24' }),
      (error) => expectHttp(error, 500, 'FINANCIAL_REPORT_INVARIANT'),
    )
  })
})

function auth(role: UserRole, options: { active?: boolean; status?: AccountStatus; authorized?: boolean } = {}): AuthDependencies {
  return {
    async verifyAccessToken() {
      if (options.authorized === false) return null
      return { id: ownerA, email: 'owner@example.com', emailConfirmedAt: new Date().toISOString(), isAnonymous: false }
    },
    async findApplicationUser() {
      return { id: ownerA, role, accountId: role === UserRole.SUPER_ADMIN ? null : accountA, isActive: options.active ?? true }
    },
    async findAccountById() { return { id: accountA, status: options.status ?? AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw new Error('unused') },
  }
}

async function request(
  role: UserRole,
  path: string,
  options: { method?: string; active?: boolean; status?: AccountStatus; authorized?: boolean } = {},
) {
  const store = new ReportStore()
  store.rows.set(accountA, [rawDay('2026-09-24', { grossRevenue: '10.50', rawGrossCOGS: '15.7500' })])
  const app = express()
  app.use(express.json())
  app.use('/api/reports', createReportRouter(auth(role, options), createReportDependencies(store.client())))
  app.use(errorHandler)
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method ?? 'GET',
      headers: options.authorized === false ? {} : { Authorization: 'Bearer token' },
    })
    return { response, store }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('report routes', () => {
  test('allows active OWNER on both routes with aggregate-only private responses', async () => {
    const daily = await request(UserRole.OWNER, '/api/reports/daily?date=2026-09-24')
    assert.equal(daily.response.status, 200)
    const dailyJson = await daily.response.json() as Row
    assert.equal((dailyJson.report as Row).grossRevenue, '10.50')
    assert.equal((dailyJson.report as Row).grossCOGS, '15.75')
    assert.equal((dailyJson.report as Row).grossProfit, '-5.25')
    for (const forbidden of ['accountId', 'computedAt', 'saleId', 'expenseId', 'unitCostAtSale']) {
      assert.equal(Object.hasOwn(dailyJson.report as object, forbidden), false)
    }
    const summary = await request(UserRole.OWNER, '/api/reports/summary?from=2026-09-24&to=2026-09-24')
    assert.equal(summary.response.status, 200)
    const summaryJson = await summary.response.json() as Row
    assert.equal((summaryJson.report as Row).daysCount, 1)
    assert.equal(Object.hasOwn(summaryJson.report as object, 'days'), false)
  })

  test('rejects WAREHOUSE, SUPER_ADMIN, unauthenticated, inactive user, and inactive Account on both routes', async () => {
    for (const path of ['/api/reports/daily?date=2026-09-24', '/api/reports/summary?from=2026-09-24&to=2026-09-24']) {
      assert.equal((await request(UserRole.WAREHOUSE, path)).response.status, 403)
      assert.equal((await request(UserRole.SUPER_ADMIN, path)).response.status, 403)
      assert.equal((await request(UserRole.OWNER, path, { authorized: false })).response.status, 401)
      assert.equal((await request(UserRole.OWNER, path, { active: false })).response.status, 403)
      assert.equal((await request(UserRole.OWNER, path, { status: AccountStatus.SUSPENDED })).response.status, 403)
    }
  })

  test('validates queries before calculation and exposes no mutation or rebuild route', async () => {
    for (const path of [
      '/api/reports/daily',
      '/api/reports/daily?date=2026-09-24&date=2026-09-25',
      '/api/reports/daily?date=2026-09-24&accountId=22222222-2222-4222-8222-222222222222',
      '/api/reports/summary?from=2026-09-25&to=2026-09-24',
      '/api/reports/summary?from=2024-01-01&to=2025-01-01',
    ]) {
      const result = await request(UserRole.OWNER, path)
      assert.equal(result.response.status, 422)
      assert.equal(result.store.aggregateQueries, 0)
    }
    for (const path of ['/api/reports/daily?date=2026-09-24', '/api/reports/summary?from=2026-09-24&to=2026-09-24', '/api/reports/rebuild']) {
      assert.equal((await request(UserRole.OWNER, path, { method: 'POST' })).response.status, 404)
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        assert.equal((await request(UserRole.OWNER, path, { method })).response.status, 404)
      }
    }
  })
})
