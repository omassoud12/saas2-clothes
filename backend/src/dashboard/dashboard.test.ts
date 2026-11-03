// /api/dashboard/* on a throwaway local Postgres database (skipped when the local server is not running).
// The clock is fixed at Monday 19 Oct 2026, 17:00 in Beirut. Every number is checked against the
// Business report for the same period: one source of truth.
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { addReturn, addSale, createTestDatabase, seedAccount, voidSale, type FixtureAccount } from '../business/business-test-db.js'
import { createBusinessDependencies, createBusinessRouter } from '../business/business.routes.js'
import { AccountRateLimiter, ReportCache } from '../business/business-cache.js'
import { createDashboardDependencies, percentChange, periodRange, suggestTarget } from './dashboard.service.js'
import { createDashboardRouter } from './dashboard.routes.js'
import { Prisma } from '../generated/prisma/client.js'

const db = await createTestDatabase()
const skip = !db
const clock = () => new Date('2026-10-19T17:00:00+03:00')
let shopA: FixtureAccount
let shopB: FixtureAccount
let base = ''
let server: ReturnType<express.Express['listen']> | null = null

interface Caller { userId: string; role: UserRole; accountId: string; employeeRole?: string | null; permissions?: string[]; permissionsCustom?: boolean }
let caller: Caller = { userId: '', role: UserRole.OWNER, accountId: '' }

const auth: AuthDependencies = {
  async verifyAccessToken() { return { id: caller.userId, email: 'user@example.com', emailConfirmedAt: '2026-01-01T00:00:00.000Z', isAnonymous: false } },
  async findApplicationUser() {
    return {
      id: caller.userId, role: caller.role, accountId: caller.accountId, isActive: true, status: 'ACTIVE' as const,
      employeeRole: caller.employeeRole ?? (caller.role === UserRole.WAREHOUSE ? 'WAREHOUSE' : null),
      permissions: caller.permissions ?? [], permissionsCustom: caller.permissionsCustom ?? false, mustChangePassword: false,
    }
  },
  async findAccountById() { return { id: caller.accountId, status: AccountStatus.ACTIVE } },
  async findCurrentUser() { return null },
  async bootstrapOwner() { throw Error('unused') },
}

before(async () => {
  if (!db) return
  shopA = await seedAccount(db.sql, { name: 'Hamra' })
  shopB = await seedAccount(db.sql, { name: 'Hamra' })
  const [beige, white, black] = shopA.variants
  for (const [date, count] of [['2026-10-12', 3], ['2026-10-13', 2], ['2026-10-15', 4], ['2026-10-18', 1]] as const) {
    for (let index = 0; index < count; index += 1) {
      await addSale(db.sql, shopA, {
        at: `${date}T${String(10 + index).padStart(2, '0')}:15:00+03:00`, seller: index % 2 ? shopA.staff : shopA.owner,
        lines: [{ variant: index % 3 === 0 ? beige! : white!, quantity: 1 + (index % 2), price: '35.00', cost: '20.0000' }],
      })
    }
  }
  // Sunday 18 Oct: one sale before 17:00 (above) and one after, left out of "yesterday by this time".
  await addSale(db.sql, shopA, { at: '2026-10-18T18:00:00+03:00', lines: [{ variant: black!, quantity: 1, price: '48.00', cost: '30.0000' }] })
  const voided = await addSale(db.sql, shopA, { at: '2026-10-13T16:00:00+03:00', lines: [{ variant: beige!, quantity: 2, price: '35.00', cost: '20.0000' }] })
  await voidSale(db.sql, shopA, voided.saleId, '2026-10-14T09:00:00+03:00')
  const returned = await addSale(db.sql, shopA, { at: '2026-10-15T19:00:00+03:00', lines: [{ variant: white!, quantity: 2, price: '35.00', cost: '20.0000' }] })
  await addReturn(db.sql, shopA, { saleId: returned.saleId, at: '2026-10-16T11:00:00+03:00', lines: [{ itemId: returned.itemIds[0]!, variant: white!, quantity: 1, refund: '35.00' }] })
  // Today so far: one sale with a cost and one sold without a cost (black has no cost any more).
  await addSale(db.sql, shopA, { at: '2026-10-19T11:30:00+03:00', lines: [{ variant: beige!, quantity: 1, price: '35.00', cost: '20.0000' }] })
  await db.sql.query(`UPDATE "ProductVariant" SET "lastPurchaseCost" = NULL WHERE "id" = $1`, [black!.id])
  await addSale(db.sql, shopA, { at: '2026-10-19T12:00:00+03:00', lines: [{ variant: black!, quantity: 2, price: '48.00', cost: null }] })
  // October: rent $750 and a removed $999 expense; a $5,000 monthly target.
  await db.sql.query(`INSERT INTO "Expense" ("id", "accountId", "description", "amount", "currency", "expenseDate", "category", "createdById", "updatedAt")
    VALUES (gen_random_uuid(), $1, 'Shop rent', 750, 'USD', '2026-10-01', 'RENT', $2, now())`, [shopA.accountId, shopA.owner.id])
  await db.sql.query(`INSERT INTO "Expense" ("id", "accountId", "description", "amount", "currency", "expenseDate", "category", "createdById", "deletedAt", "updatedAt")
    VALUES (gen_random_uuid(), $1, 'Typo', 999, 'USD', '2026-10-02', 'OTHER', $2, now(), now())`, [shopA.accountId, shopA.owner.id])
  await db.sql.query(`INSERT INTO "SalesTarget" ("id", "accountId", "period", "periodStart", "amount", "updatedAt")
    VALUES (gen_random_uuid(), $1, 'MONTH', '2026-10-01', 5000, now())`, [shopA.accountId])
  // Shop B sells too, so leaks would show.
  await addSale(db.sql, shopB, { at: '2026-10-19T12:00:00+03:00', lines: [{ variant: shopB.variants[0]!, quantity: 9, price: '99.00', cost: '1.0000' }] })

  const cache = new ReportCache()
  const business = createBusinessDependencies(db.prisma, { clock, cache, rateLimiter: new AccountRateLimiter(100_000) })
  const dashboard = createDashboardDependencies(db.prisma, { clock, cache, rateLimiter: new AccountRateLimiter(100_000) })
  const app = express(); app.use(express.json())
  app.use('/api/business', createBusinessRouter(auth, business))
  app.use('/api/dashboard', createDashboardRouter(auth, dashboard))
  app.use(errorHandler)
  server = app.listen(0)
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await db?.drop()
})

const asOwner = (shop: FixtureAccount) => { caller = { userId: shop.owner.id, role: UserRole.OWNER, accountId: shop.accountId } }
const asEmployee = (shop: FixtureAccount, employeeRole: string, permissions?: string[]) => {
  caller = { userId: shop.staff.id, role: UserRole.WAREHOUSE, accountId: shop.accountId, employeeRole, permissions, permissionsCustom: permissions !== undefined }
}
async function get(path: string) {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: 'Bearer test' } })
  return { status: response.status, body: await response.json() as any }
}
const money = (value: string | null) => new Prisma.Decimal(value ?? 0)

describe('dashboard helpers', () => {
  test('change in percent and the best-seller periods', () => {
    assert.equal(percentChange(new Prisma.Decimal(150), new Prisma.Decimal(100)), '50.0')
    assert.equal(percentChange(new Prisma.Decimal(1), new Prisma.Decimal(3)), '-66.7')
    assert.equal(percentChange(new Prisma.Decimal(5), new Prisma.Decimal(0)), null)
    assert.deepEqual(periodRange('today', '2026-10-19'), { from: '2026-10-19', to: '2026-10-19' })
    assert.deepEqual(periodRange('week', '2026-10-21'), { from: '2026-10-19', to: '2026-10-21' })
    assert.deepEqual(periodRange('month', '2026-10-19'), { from: '2026-10-01', to: '2026-10-19' })
    // Suggested target: average of the last 3 full months + 5%, rounded to $500.
    assert.equal(suggestTarget(new Prisma.Decimal(9000)), '3000.00')
    assert.equal(suggestTarget(new Prisma.Decimal(13000)), '4500.00')
    assert.equal(suggestTarget(new Prisma.Decimal(100)), '500.00')
    assert.equal(suggestTarget(new Prisma.Decimal(0)), null)
  })
})

describe('GET /api/dashboard/summary', { skip }, () => {
  test('today = Business Daily, the month = Business Monthly, net profit = Monthly profit − its expenses', async () => {
    asOwner(shopA)
    const { status, body } = await get('/api/dashboard/summary')
    assert.equal(status, 200)
    const daily = (await get('/api/business/daily?date=2026-10-19')).body
    const monthly = (await get('/api/business/monthly?month=2026-10')).body
    assert.equal(body.today.salesTotal, daily.salesTotal)
    assert.equal(body.today.invoiceCount, daily.invoiceCount)
    assert.equal(body.today.profitTotal, daily.profitTotal)
    assert.equal(body.today.vsYesterdaySameTime.salesTotal, daily.previousDay.salesTotal)
    assert.equal(body.month.salesTotal, monthly.totals.salesTotal)
    assert.equal(body.month.profitTotal, monthly.totals.profitTotal)
    const monthlyExpenses = monthly.expenses.reduce((sum: Prisma.Decimal, row: any) => sum.add(row.amountTotal), new Prisma.Decimal(0))
    assert.equal(body.month.expensesTotal, monthlyExpenses.toFixed(2))
    assert.equal(body.month.netProfit, money(monthly.totals.profitTotal).sub(monthlyExpenses).toFixed(2))
    // Recorded (not spread) expenses of the month, without the removed one.
    assert.equal(body.expensesThisMonth.total, '750.00')
    assert.equal(body.expensesThisMonth.byCategory.find((row: any) => row.category === 'RENT').amountTotal, '750.00')
  })

  test('numbers: today, yesterday by 17:00, target pace, missing cost', async () => {
    asOwner(shopA)
    const { body } = await get('/api/dashboard/summary')
    assert.equal(body.date, '2026-10-19')
    assert.equal(body.asOf, '17:00')
    assert.equal(body.today.salesTotal, '131.00') // 35 + 2 × 48
    assert.equal(body.today.invoiceCount, 2)
    assert.equal(body.today.costComplete, false)
    assert.equal(body.today.vsYesterdaySameTime.salesTotal, '35.00') // the 18:00 sale is left out
    assert.equal(body.today.vsYesterdaySameTime.changePercent, '274.3')
    assert.deepEqual(body.month.target, { amount: '5000.00', progress: money(body.month.salesTotal).div(5000).toDecimalPlaces(4).toFixed(4), expectedByToday: '3064.52' })
    assert.ok(money(body.month.projection).greaterThanOrEqualTo(money(body.month.salesTotal)))
    assert.equal(body.missingCost.productCount, 1)
    assert.equal(body.missingCost.variantCount, 1)
    assert.equal(body.missingCost.salesAffectedTotal, '96.00')
    assert.deepEqual(body.employees, { active: 1, invited: 0, deactivated: 0 })
  })

  test('the dashboard is for the owner only: every employee preset gets 403, even with custom permissions', async () => {
    for (const preset of ['MANAGER', 'CASHIER', 'WAREHOUSE']) {
      asEmployee(shopA, preset)
      assert.equal((await get('/api/dashboard/summary')).status, 403)
      assert.equal((await get('/api/dashboard/best-sellers')).status, 403)
    }
    // A stored DASHBOARD permission on an employee is ignored.
    asEmployee(shopA, 'MANAGER', ['DASHBOARD', 'VIEW_COST_PROFIT'])
    assert.equal((await get('/api/dashboard/summary')).status, 403)
  })

  test('another account never sees these numbers', async () => {
    asOwner(shopB)
    const b = (await get('/api/dashboard/summary')).body
    assert.equal(b.today.salesTotal, '891.00')
    assert.equal(b.month.target, null)
    assert.equal(b.expensesThisMonth.total, '0.00')
    assert.equal((await get(`/api/dashboard/summary?storeId=${shopA.storeId}`)).status, 403)
  })
})

describe('GET /api/dashboard/best-sellers', { skip }, () => {
  test('month = the products of Business Monthly; today and week from the same day function', async () => {
    asOwner(shopA)
    const month = (await get('/api/dashboard/best-sellers?period=month&limit=50')).body
    const monthly = (await get('/api/business/monthly?month=2026-10')).body
    assert.deepEqual(month.items, monthly.products)
    const week = (await get('/api/business/weekly?week=2026-10-19')).body
    assert.deepEqual((await get('/api/dashboard/best-sellers?period=week&limit=50')).body.items, week.products)
    const today = (await get('/api/dashboard/best-sellers?period=today')).body
    assert.equal(today.items[0].variants[0].label, 'Black · One size')
  })

  test('sorting by pieces and profit; profit needs VIEW_COST_PROFIT; bad input is 422', async () => {
    asOwner(shopA)
    const byQuantity = (await get('/api/dashboard/best-sellers?period=month&sort=quantity')).body.items
    for (let index = 1; index < byQuantity.length; index += 1) assert.ok(byQuantity[index - 1].quantity >= byQuantity[index].quantity)
    const byProfit = (await get('/api/dashboard/best-sellers?period=month&sort=profit')).body.items
    for (let index = 1; index < byProfit.length; index += 1) assert.ok(Number(byProfit[index - 1].profitTotal) >= Number(byProfit[index].profitTotal))
    assert.equal((await get('/api/dashboard/best-sellers?period=month&limit=1')).body.items.length, 1)
    assert.equal((await get('/api/dashboard/best-sellers?period=year')).status, 422)
    assert.equal((await get('/api/dashboard/best-sellers?limit=0')).status, 422)
  })
})
