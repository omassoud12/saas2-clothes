// Endpoint tests for /api/stores and /api/business/* on a throwaway local Postgres database (skipped when the
// local server is not running). The clock is fixed at Monday 19 Oct 2026, 17:00 in Beirut.
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { addReturn, addSale, createTestDatabase, seedAccount, voidSale, type FixtureAccount } from './business-test-db.js'
import { createBusinessDependencies, createBusinessRouter, createStoreRouter } from './business.routes.js'
import { AccountRateLimiter } from './business-cache.js'

const db = await createTestDatabase()
const skip = !db
const clock = () => new Date('2026-10-19T17:00:00+03:00')
let shopA: FixtureAccount
let shopB: FixtureAccount
let base = ''
let server: ReturnType<express.Express['listen']> | null = null
// Who is calling: the tests switch it between the owner and the staff member of shop A or B.
let caller: { userId: string; role: UserRole; accountId: string } = { userId: '', role: UserRole.OWNER, accountId: '' }

const auth: AuthDependencies = {
  async verifyAccessToken() { return { id: caller.userId, email: 'user@example.com', emailConfirmedAt: '2026-01-01T00:00:00.000Z', isAnonymous: false } },
  async findApplicationUser() { return { id: caller.userId, role: caller.role, accountId: caller.accountId, isActive: true } },
  async findAccountById() { return { id: caller.accountId, status: AccountStatus.ACTIVE } },
  async findCurrentUser() { return null },
  async bootstrapOwner() { throw Error('unused') },
}

before(async () => {
  if (!db) return
  // Two accounts whose stores have the SAME name, to prove nothing leaks between them.
  shopA = await seedAccount(db.sql, { name: 'Hamra' })
  shopB = await seedAccount(db.sql, { name: 'Hamra' })
  const [beige, white, black] = shopA.variants
  for (const [date, count] of [['2026-10-12', 3], ['2026-10-13', 2], ['2026-10-15', 4], ['2026-10-18', 1]] as const) {
    for (let index = 0; index < count; index += 1) {
      await addSale(db.sql, shopA, {
        at: `${date}T${String(10 + index).padStart(2, '0')}:15:00+03:00`, method: index % 2 ? 'WHISH_OMT' : 'CASH', seller: index % 2 ? shopA.staff : shopA.owner,
        lines: [{ variant: index % 3 === 0 ? beige! : white!, quantity: 1 + (index % 2), price: '35.00', cost: '20.0000' }],
      })
    }
  }
  // Sunday 18 Oct at 18:00 (after today's 17:00): left out of "yesterday by this time".
  await addSale(db.sql, shopA, { at: '2026-10-18T18:00:00+03:00', lines: [{ variant: black!, quantity: 1, price: '48.00', cost: '30.0000' }] })
  const voided = await addSale(db.sql, shopA, { at: '2026-10-13T16:00:00+03:00', lines: [{ variant: beige!, quantity: 2, price: '35.00', cost: '20.0000' }] })
  await voidSale(db.sql, shopA, voided.saleId, '2026-10-14T09:00:00+03:00')
  const returned = await addSale(db.sql, shopA, { at: '2026-10-15T19:00:00+03:00', lines: [{ variant: white!, quantity: 2, price: '35.00', cost: '20.0000' }] })
  await addReturn(db.sql, shopA, { saleId: returned.saleId, at: '2026-10-16T11:00:00+03:00', lines: [{ itemId: returned.itemIds[0]!, variant: white!, quantity: 1, refund: '35.00' }] })
  // Today, Monday 19 Oct, so far.
  await addSale(db.sql, shopA, { at: '2026-10-19T11:30:00+03:00', method: 'WHISH_OMT', lines: [{ variant: beige!, quantity: 1, price: '35.00', cost: '20.0000' }] })
  // Shop B sells too, so leaks would show.
  await addSale(db.sql, shopB, { at: '2026-10-12T12:00:00+03:00', lines: [{ variant: shopB.variants[0]!, quantity: 9, price: '99.00', cost: '1.0000' }] })

  // A high limit here: the dedicated test below checks the real per-account limit.
  const business = createBusinessDependencies(db.prisma, { clock, rateLimiter: new AccountRateLimiter(100_000) })
  const app = express(); app.use(express.json())
  app.use('/api/stores', createStoreRouter(auth, business))
  app.use('/api/business', createBusinessRouter(auth, business))
  app.use(errorHandler)
  server = app.listen(0)
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await db?.drop()
})

const as = (shop: FixtureAccount, role: UserRole) => { caller = { userId: role === UserRole.OWNER ? shop.owner.id : shop.staff.id, role, accountId: shop.accountId } }
async function get(path: string) {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: 'Bearer test' } })
  return { status: response.status, body: await response.json() as any }
}

describe('business endpoints', () => {
  test('/api/stores lists the account’s own store only', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const { status, body } = await get('/api/stores')
    assert.equal(status, 200)
    assert.deepEqual(body, { items: [{ id: shopA.storeId, name: 'Hamra' }] })
  })

  test('daily (owner): the documented shape, net of the void, with cost and profit', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const { status, body } = await get('/api/business/daily?date=2026-10-13')
    assert.equal(status, 200)
    assert.equal(body.date, '2026-10-13'); assert.equal(body.timezone, 'Asia/Beirut'); assert.equal(body.currency, 'USD')
    assert.equal(body.live, false); assert.equal(body.asOf, null)
    assert.equal(body.salesTotal, '105.00', '35 + 70; the voided 70 is not counted')
    assert.equal(body.costTotal, '60.00'); assert.equal(body.profitTotal, '45.00'); assert.equal(body.costComplete, true)
    assert.equal(body.invoiceCount, 2); assert.equal(body.piecesSold, 3)
    assert.deepEqual(body.returns, { count: 0, amountTotal: '0.00' })
    assert.deepEqual(body.previousDay, { date: '2026-10-12', salesTotal: '140.00', invoiceCount: 3 })
    assert.deepEqual(body.sameWeekdayLastWeek, { date: '2026-10-06', salesTotal: '0.00', invoiceCount: 0 })
    assert.deepEqual(body.paymentSplit.map((row: any) => row.method), ['CASH', 'WHISH'])
    assert.equal(body.byStaff.length, 2); assert.equal(typeof body.byStaff[0].profitTotal, 'string')
    assert.equal(body.products[0].name, 'Linen shirt'); assert.match(body.products[0].variants[0].label, /^(Beige|White) · Size [ML]$/)
    assert.ok(body.byHour.some((row: any) => row.hour === 10 && row.salesTotal === '35.00'))
  })

  test('daily (staff): cost, profit and every profit breakdown are null', { skip }, async () => {
    as(shopA, UserRole.WAREHOUSE)
    const { status, body } = await get('/api/business/daily?date=2026-10-13')
    assert.equal(status, 200)
    assert.equal(body.salesTotal, '105.00')
    assert.equal(body.costTotal, null); assert.equal(body.profitTotal, null)
    assert.ok(body.byStaff.every((row: any) => row.profitTotal === null))
    assert.ok(body.products.every((row: any) => row.profitTotal === null && row.variants.every((variant: any) => variant.profitTotal === null)))
  })

  test('daily today is live, and yesterday is compared by this time (17:00)', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const { body } = await get('/api/business/daily?date=2026-10-19')
    assert.equal(body.live, true); assert.equal(body.asOf, '17:00')
    assert.equal(body.salesTotal, '35.00')
    assert.deepEqual(body.previousDay, { date: '2026-10-18', salesTotal: '35.00', invoiceCount: 1 }, 'the 18:00 sale is after 17:00')
    assert.ok(body.byHour.every((row: any) => row.hour <= 17))
  })

  test('the week of Monday 12 Oct: Monday = the Daily of Monday, and the week = the sum of its days', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const week = (await get('/api/business/weekly?week=2026-10-14')).body
    assert.equal(week.weekStart, '2026-10-12'); assert.equal(week.weekEnd, '2026-10-18'); assert.equal(week.live, false)
    assert.equal(week.days.length, 7)
    let sales = 0; let invoices = 0
    for (const day of week.days) {
      const daily = (await get(`/api/business/daily?date=${day.date}`)).body
      assert.equal(day.salesTotal, daily.salesTotal, day.date); assert.equal(day.invoiceCount, daily.invoiceCount, day.date)
      assert.equal(day.profitTotal, daily.profitTotal, day.date)
      sales += Number(daily.salesTotal); invoices += daily.invoiceCount
    }
    assert.equal(week.totals.salesTotal, sales.toFixed(2)); assert.equal(week.totals.invoiceCount, invoices)
    assert.equal(week.slowMovers, null, 'stock right now only for the current week')
  })

  test('this week is live: days to come are null with a forecast, last week is cut at 17:00 today', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const week = (await get('/api/business/weekly?week=2026-10-19')).body
    assert.equal(week.live, true); assert.equal(week.asOfDate, '2026-10-19')
    assert.equal(week.days[0].salesTotal, '35.00'); assert.equal(week.days[0].previousSalesTotal, '140.00')
    assert.equal(week.days[1].salesTotal, null); assert.equal(typeof week.days[1].forecastSalesTotal, 'string')
    assert.deepEqual(week.previousWeek, { salesTotal: '140.00', invoiceCount: 3 })
    assert.ok(Array.isArray(week.slowMovers))
  })

  test('the month: every day = Daily, totals = the sum, and the yearly October = the monthly October', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const month = (await get('/api/business/monthly?month=2026-10')).body
    assert.equal(month.live, true); assert.equal(month.days.length, 31)
    let sales = 0; let pieces = 0
    for (const day of month.days.filter((row: any) => row.salesTotal !== null)) {
      const daily = (await get(`/api/business/daily?date=${day.date}`)).body
      assert.equal(day.salesTotal, daily.salesTotal, day.date)
      sales += Number(daily.salesTotal); pieces += daily.piecesSold
    }
    assert.equal(month.totals.salesTotal, sales.toFixed(2)); assert.equal(month.totals.piecesSold, pieces)
    assert.equal(month.days[30].salesTotal, null)
    assert.deepEqual(month.expenses.map((row: any) => row.category), ['RENT', 'SALARIES', 'ELECTRICITY', 'GENERATOR', 'OTHER'])
    assert.equal(typeof month.inventory.stockUnits, 'number')
    const year = (await get('/api/business/yearly?year=2026')).body
    const october = year.months.find((row: any) => row.month === '2026-10')
    assert.equal(october.salesTotal, month.totals.salesTotal); assert.equal(october.invoiceCount, month.totals.invoiceCount)
    assert.equal(year.months.length, 10)
  })

  test('the return lowers the day it is made', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const day = (await get('/api/business/daily?date=2026-10-16')).body
    assert.equal(day.salesTotal, '-35.00'); assert.deepEqual(day.returns, { count: 1, amountTotal: '35.00' })
  })

  test('yearly is for the owner only', { skip }, async () => {
    as(shopA, UserRole.WAREHOUSE)
    const { status, body } = await get('/api/business/yearly?year=2026')
    assert.equal(status, 403); assert.equal(body.error.code, 'OWNER_ONLY')
  })

  test('a store of another account is 403, even with the same name; "all" and the own store work', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const foreign = await get(`/api/business/daily?date=2026-10-12&storeId=${shopB.storeId}`)
    assert.equal(foreign.status, 403); assert.equal(foreign.body.error.code, 'STORE_FORBIDDEN')
    assert.equal((await get(`/api/business/daily?date=2026-10-12&storeId=${shopA.storeId}`)).status, 200)
    assert.equal((await get('/api/business/daily?date=2026-10-12&storeId=all')).body.salesTotal, '140.00')
    assert.equal((await get('/api/business/monthly?month=2026-10&storeId=not-a-store')).status, 403)
  })

  test('tenant isolation: account B never sees account A’s numbers', { skip }, async () => {
    as(shopB, UserRole.OWNER)
    const day = (await get('/api/business/daily?date=2026-10-13')).body
    assert.equal(day.salesTotal, '0.00'); assert.equal(day.invoiceCount, 0)
    const monday = (await get('/api/business/daily?date=2026-10-12')).body
    assert.equal(monday.salesTotal, '891.00', 'only B’s own sale')
    const invoices = (await get('/api/business/daily/invoices?date=2026-10-13')).body
    assert.deepEqual(invoices.items, [])
    const stores = (await get('/api/stores')).body
    assert.deepEqual(stores.items, [{ id: shopB.storeId, name: 'Hamra' }])
  })

  test('invoices: newest first, keyset pages, voided marked, method filter, never cost', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const first = (await get('/api/business/daily/invoices?date=2026-10-13&limit=2')).body
    assert.equal(first.items.length, 2); assert.equal(typeof first.nextCursor, 'string')
    assert.equal(first.items[0].status, 'VOIDED', 'the 16:00 sale (voided) is the newest')
    assert.ok(first.items[0].createdAt > first.items[1].createdAt)
    const second = (await get(`/api/business/daily/invoices?date=2026-10-13&limit=2&cursor=${first.nextCursor}`)).body
    assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null)
    const all = [...first.items, ...second.items]
    assert.equal(new Set(all.map((row: any) => row.id)).size, 3)
    assert.ok(all.every((row: any) => !('cost' in row) && !('costTotal' in row)))
    assert.deepEqual(Object.keys(all[0]).sort(), ['createdAt', 'customerName', 'id', 'itemCount', 'number', 'paymentMethod', 'staff', 'status', 'store', 'total'])
    const whish = (await get('/api/business/daily/invoices?date=2026-10-13&method=WHISH')).body
    assert.ok(whish.items.length >= 1 && whish.items.every((row: any) => row.paymentMethod === 'WHISH'))
    assert.equal((await get('/api/business/daily/invoices?date=2026-10-13&limit=51')).status, 422)
  })

  test('validation: future dates, bad months and bad weeks are rejected', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    for (const path of ['/api/business/daily?date=2026-10-20', '/api/business/daily?date=13-10-2026', '/api/business/monthly?month=2026-13',
      '/api/business/monthly?month=2026-11', '/api/business/weekly?week=2026-10-26', '/api/business/yearly?year=2027']) {
      const { status, body } = await get(path)
      assert.equal(status, 422, path); assert.equal(body.error.code, 'VALIDATION_ERROR', path)
    }
  })

  test('targets and closed days: the owner sets them and the reports show them', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const put = await fetch(`${base}/api/business/targets`, { method: 'PUT', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ period: 'WEEK', periodStart: '2026-10-19', amount: '1000.00' }) })
    assert.equal(put.status, 200)
    assert.deepEqual((await get('/api/business/weekly?week=2026-10-19')).body.target, { salesTotal: '1000.00' })
    const closed = await fetch(`${base}/api/business/closed-days`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-10-14', reason: 'Holiday' }) })
    assert.equal(closed.status, 201)
    const week = (await get('/api/business/weekly?week=2026-10-12')).body
    assert.equal(week.days.find((day: any) => day.date === '2026-10-14').closed, true)
    as(shopA, UserRole.WAREHOUSE)
    const denied = await fetch(`${base}/api/business/targets`, { method: 'PUT', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ period: 'WEEK', periodStart: '2026-10-19', amount: '1.00' }) })
    assert.equal(denied.status, 403)
  })
})

describe('load protection', () => {
  test('Cache-Control and ETag: a repeated request with If-None-Match gets 304', { skip }, async () => {
    as(shopA, UserRole.OWNER)
    const past = await fetch(`${base}/api/business/daily?date=2026-10-12`, { headers: { Authorization: 'Bearer test' } })
    assert.equal(past.headers.get('cache-control'), 'private, max-age=300')
    const etag = past.headers.get('etag')!
    assert.ok(etag)
    const again = await fetch(`${base}/api/business/daily?date=2026-10-12`, { headers: { Authorization: 'Bearer test', 'If-None-Match': etag } })
    assert.equal(again.status, 304)
    const live = await fetch(`${base}/api/business/daily?date=2026-10-19`, { headers: { Authorization: 'Bearer test' } })
    assert.equal(live.headers.get('cache-control'), 'private, max-age=30')
  })

  test('a per-account rate limit answers 429 with Retry-After', { skip }, async () => {
    const { AccountRateLimiter } = await import('./business-cache.js')
    const limited = createBusinessDependencies(db!.prisma, { clock, rateLimiter: new AccountRateLimiter(2, 60_000) })
    const app = express()
    app.use('/api/business', createBusinessRouter(auth, limited))
    app.use(errorHandler)
    const small = app.listen(0)
    try {
      const url = `http://127.0.0.1:${(small.address() as AddressInfo).port}/api/business/daily?date=2026-10-12`
      as(shopA, UserRole.OWNER)
      assert.equal((await fetch(url, { headers: { Authorization: 'Bearer test' } })).status, 200)
      assert.equal((await fetch(url, { headers: { Authorization: 'Bearer test' } })).status, 200)
      const third = await fetch(url, { headers: { Authorization: 'Bearer test' } })
      assert.equal(third.status, 429); assert.ok(Number(third.headers.get('retry-after')) > 0)
      assert.equal(((await third.json()) as any).error.code, 'RATE_LIMITED')
      as(shopB, UserRole.OWNER)
      assert.equal((await fetch(url, { headers: { Authorization: 'Bearer test' } })).status, 200, 'another account is not limited')
    } finally {
      await new Promise<void>((resolve) => small.close(() => resolve()))
    }
  })
})
