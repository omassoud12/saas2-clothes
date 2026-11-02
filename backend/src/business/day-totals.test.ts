// Runs against a throwaway database on the local dev Postgres (node scripts/dev-db.mjs start).
// Skipped when that server is not running.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { dateRange } from './business-dates.js'
import { addReturn, addSale, createTestDatabase, seedAccount, voidSale, type FixtureAccount, type TestDatabase } from './business-test-db.js'
import { addDay, emptyDay, liveDay, rangeTotals, rollupDays, type BusinessScope } from './day-totals.js'

const db: TestDatabase | null = await createTestDatabase()
let shop: FixtureAccount
let scope: BusinessScope

before(async () => {
  if (!db) return
  shop = await seedAccount(db.sql)
  scope = { accountId: shop.accountId, timezone: 'Asia/Beirut', storeIds: [shop.storeId] }
  const [beige, white] = shop.variants
  // Monday 12 Oct 2026 (Beirut is UTC+3 until 25 Oct).
  const s1 = await addSale(db.sql, shop, { at: '2026-10-12T10:00:00+03:00', method: 'CASH', lines: [{ variant: beige!, quantity: 2, price: '35.00', cost: '20.0000' }] })
  await addSale(db.sql, shop, { at: '2026-10-12T11:00:00+03:00', method: 'WHISH_OMT', seller: shop.staff, lines: [{ variant: white!, quantity: 1, price: '35.00', cost: null }] })
  const voided = await addSale(db.sql, shop, { at: '2026-10-12T12:00:00+03:00', lines: [{ variant: beige!, quantity: 5, price: '35.00', cost: '20.0000' }] })
  await voidSale(db.sql, shop, voided.saleId, '2026-10-13T09:00:00+03:00')
  await addSale(db.sql, shop, { at: '2026-10-12T23:59:00+03:00', method: 'CARD', discount: '5.00', lines: [{ variant: beige!, quantity: 1, price: '30.00', cost: '20.0000' }] })
  await addSale(db.sql, shop, { at: '2026-10-13T00:01:00+03:00', method: 'CASH', lines: [{ variant: white!, quantity: 1, price: '35.00', cost: '20.0000' }] })
  // Return of one piece of s1, made the next day: it lowers 13 Oct, not 12 Oct.
  await addReturn(db.sql, shop, { saleId: s1.saleId, at: '2026-10-13T09:30:00+03:00', lines: [{ itemId: s1.itemIds[0]!, variant: beige!, quantity: 1, refund: '35.00' }] })
  // A holiday with nothing sold.
  await db.sql.query(`INSERT INTO "ClosedDay" ("id", "accountId", "storeId", "date", "reason") VALUES (gen_random_uuid(), $1, NULL, '2026-10-14', 'Holiday')`, [shop.accountId])
  // DST: Beirut moves to UTC+3 at 00:00 on Sunday 29 Mar 2026 (a 23-hour day).
  await addSale(db.sql, shop, { at: '2026-03-28T23:30:00+02:00', lines: [{ variant: beige!, quantity: 1, price: '10.00', cost: '5.0000' }] })
  await addSale(db.sql, shop, { at: '2026-03-29T23:30:00+03:00', lines: [{ variant: beige!, quantity: 1, price: '11.00', cost: '5.0000' }] })
  await addSale(db.sql, shop, { at: '2026-03-30T00:15:00+03:00', lines: [{ variant: beige!, quantity: 1, price: '12.00', cost: '5.0000' }] })
})
after(async () => { await db?.drop() })

const skip = () => !db
const money = (value: { toFixed(places: number): string }) => value.toFixed(2)

describe('the one day function', () => {
  test('a day: completed sales only, voided excluded, cost from the sale-time snapshot, missing cost flagged', { skip: skip() }, async () => {
    const { day, staff, variants, hours } = await liveDay(db!.prisma, scope, '2026-10-12', null)
    assert.equal(money(day.salesTotal), '135.00', '70 + 35 + 30 (the voided 175 is not counted)')
    assert.equal(money(day.costTotal), '60.00', '2×20 + 1×20; the line without cost adds nothing')
    assert.equal(day.costMissing, true)
    assert.equal(day.invoiceCount, 3); assert.equal(day.piecesSold, 4)
    assert.equal(money(day.discountsTotal), '5.00')
    assert.equal(money(day.cashTotal), '70.00'); assert.equal(day.cashCount, 1)
    assert.equal(money(day.whishTotal), '35.00'); assert.equal(day.whishCount, 1)
    assert.equal(day.returnsCount, 0)
    assert.equal(money(staff.get(shop.staff.id)!.salesTotal), '35.00'); assert.equal(staff.get(shop.owner.id)!.invoiceCount, 2)
    assert.equal(variants.get(shop.variants[0]!.id)!.quantity, 3)
    assert.deepEqual([...hours.keys()].sort((a, b) => a - b), [10, 11, 23])
  })

  test('returns lower the day they are made, with their cost; 00:01 belongs to the next day', { skip: skip() }, async () => {
    const { day, variants, staff } = await liveDay(db!.prisma, scope, '2026-10-13', null)
    assert.equal(money(day.salesTotal), '0.00', '35 sold at 00:01 − 35 refunded')
    assert.equal(money(day.costTotal), '0.00', '20 − 20 returned')
    assert.equal(day.invoiceCount, 1); assert.equal(day.piecesSold, 1)
    assert.equal(day.returnsCount, 1); assert.equal(money(day.returnsTotal), '35.00')
    assert.equal(money(day.cashTotal), '0.00', 'the cash refund comes out of the drawer')
    assert.equal(money(variants.get(shop.variants[0]!.id)!.salesTotal), '-35.00')
    assert.equal(money(staff.get(shop.owner.id)!.salesTotal), '0.00')
  })

  test('"by this time": a day cut at 10:30 only counts what was sold by 10:30', { skip: skip() }, async () => {
    const { day } = await liveDay(db!.prisma, scope, '2026-10-12', 10 * 60 + 30)
    assert.equal(money(day.salesTotal), '70.00'); assert.equal(day.invoiceCount, 1)
  })

  test('DST: 23:30 on the short day and 00:15 the morning after are on their own days', { skip: skip() }, async () => {
    const result = await rangeTotals(db!.prisma, scope, '2026-03-28', '2026-03-30', { today: '2026-11-02' })
    assert.deepEqual([...result.days.values()].map((day) => money(day.salesTotal)), ['10.00', '11.00', '12.00'])
  })

  test('a closed day is $0 and flagged closed', { skip: skip() }, async () => {
    const result = await rangeTotals(db!.prisma, scope, '2026-10-14', '2026-10-14', { today: '2026-11-02' })
    assert.equal(result.closed.has('2026-10-14'), true)
    assert.equal(money(result.days.get('2026-10-14')!.salesTotal), '0.00')
  })

  test('a week from the rollups equals the sum of the live day function for each day', { skip: skip() }, async () => {
    const week = dateRange('2026-10-12', '2026-10-18')
    const fromRollups = await rangeTotals(db!.prisma, scope, week[0]!, week[6]!, { today: '2026-11-02' })
    const sum = emptyDay(week[0]!)
    for (const date of week) {
      const { day } = await liveDay(db!.prisma, scope, date, null)
      assert.equal(money(fromRollups.days.get(date)!.salesTotal), money(day.salesTotal), date)
      assert.equal(fromRollups.days.get(date)!.invoiceCount, day.invoiceCount, date)
      addDay(sum, day)
    }
    for (const key of ['salesTotal', 'costTotal', 'discountsTotal', 'returnsTotal', 'cashTotal', 'whishTotal'] as const) {
      assert.equal(money(fromRollups.totals[key]), money(sum[key]), key)
    }
    for (const key of ['invoiceCount', 'piecesSold', 'returnsCount', 'cashCount', 'whishCount'] as const) assert.equal(fromRollups.totals[key], sum[key], key)
    assert.equal(fromRollups.totals.costMissing, true)
    const rows = await db!.sql.query(`SELECT count(*)::int AS n FROM "DailySalesRollup" WHERE "accountId" = $1 AND "date" BETWEEN '2026-10-12' AND '2026-10-18'`, [shop.accountId])
    assert.equal(rows.rows[0].n, 7, 'every finished day gets a rollup row, zeros included')
  })

  test('rolling up the same days again changes nothing; today is never rolled up', { skip: skip() }, async () => {
    const store = { accountId: shop.accountId, timezone: 'Asia/Beirut', storeId: shop.storeId }
    const read = async () => (await db!.sql.query(`SELECT "date"::text, "salesTotal"::text, "invoiceCount" FROM "DailySalesRollup" WHERE "accountId" = $1 ORDER BY 1`, [shop.accountId])).rows
    await rollupDays(db!.prisma, store, '2026-10-10', '2026-10-20', '2026-11-02')
    const first = await read()
    await rollupDays(db!.prisma, store, '2026-10-10', '2026-10-20', '2026-11-02')
    assert.deepEqual(await read(), first)
    assert.equal(await rollupDays(db!.prisma, store, '2026-10-12', '2026-10-12', '2026-10-12'), 0, 'today stays live')
  })

  test('the rollups and the live function agree on staff and products over a range', { skip: skip() }, async () => {
    const range = await rangeTotals(db!.prisma, scope, '2026-10-12', '2026-10-13', { today: '2026-11-02' })
    const day1 = await liveDay(db!.prisma, scope, '2026-10-12', null)
    const day2 = await liveDay(db!.prisma, scope, '2026-10-13', null)
    const beige = shop.variants[0]!.id
    assert.equal(range.variants.get(beige)!.quantity, day1.variants.get(beige)!.quantity + (day2.variants.get(beige)?.quantity ?? 0))
    assert.equal(money(range.variants.get(beige)!.salesTotal), money(day1.variants.get(beige)!.salesTotal.add(day2.variants.get(beige)!.salesTotal)))
    assert.equal(range.staff.get(shop.owner.id)!.invoiceCount, 3)
  })
})

describe('keeping the rollups fresh', () => {
  const quiet = { info() {}, warn() {}, error() {} }

  test('voiding a sale of a finished day recomputes that day; the nightly job rolls up recent days', { skip: skip() }, async () => {
    const { shiftDate, shopNow } = await import('./business-dates.js')
    const { createVoidRefresher, runNightlyRollups } = await import('./rollup-jobs.js')
    const yesterday = shiftDate(shopNow('Asia/Beirut').date, -1)
    const other = await seedAccount(db!.sql, { name: 'Second shop' })
    const sale = await addSale(db!.sql, other, { at: `${yesterday}T12:00:00+02:00`, lines: [{ variant: other.variants[0]!, quantity: 1, price: '40.00', cost: '20.0000' }] })
    const otherScope = { accountId: other.accountId, timezone: 'Asia/Beirut', storeIds: [other.storeId] }

    const summary = await runNightlyRollups(db!.prisma, quiet)
    assert.ok(summary.accounts >= 1 && summary.failed === 0)
    const rollup = async () => (await db!.sql.query(`SELECT "salesTotal"::text AS s FROM "DailySalesRollup" WHERE "accountId" = $1 AND "date" = $2`, [other.accountId, yesterday])).rows[0]?.s
    assert.equal(await rollup(), '40.00')

    await voidSale(db!.sql, other, sale.saleId, new Date().toISOString())
    const invalidated: string[][] = []
    createVoidRefresher(db!.prisma, quiet, (_account, dates) => { invalidated.push([...dates]) })({ accountId: other.accountId, saleId: sale.saleId })
    for (let wait = 0; wait < 50 && (await rollup()) !== '0.00'; wait += 1) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await rollup(), '0.00', 'the voided sale left the rollup of its day')
    assert.deepEqual(invalidated, [[yesterday]])
    const range = await rangeTotals(db!.prisma, otherScope, yesterday, yesterday, { today: shiftDate(yesterday, 1) })
    assert.equal(money(range.totals.salesTotal), '0.00')
  })

  test('the next 03:30 in Beirut is computed in the shop timezone', async () => {
    const { msUntilNext } = await import('./rollup-jobs.js')
    assert.equal(msUntilNext('Asia/Beirut', 3, 30, new Date('2026-11-02T01:00:00Z')), 30 * 60_000, '03:00 Beirut → 30 minutes')
    assert.equal(msUntilNext('Asia/Beirut', 3, 30, new Date('2026-11-02T02:00:00Z')), 23.5 * 3_600_000, '04:00 Beirut → tomorrow')
  })
})

describe('concurrent reports', () => {
  test('two reports rolling up the same missing days at once do not collide', { skip: skip() }, async () => {
    const shop2 = await seedAccount(db!.sql, { name: 'Busy shop' })
    for (const day of ['2026-09-01', '2026-09-02', '2026-09-03']) {
      await addSale(db!.sql, shop2, { at: `${day}T10:00:00+03:00`, lines: [{ variant: shop2.variants[0]!, quantity: 1, price: '10.00', cost: '5.0000' }] })
    }
    const busy = { accountId: shop2.accountId, timezone: 'Asia/Beirut', storeIds: [shop2.storeId] }
    const results = await Promise.all([
      rangeTotals(db!.prisma, busy, '2026-09-01', '2026-09-30', { today: '2026-11-02' }),
      rangeTotals(db!.prisma, busy, '2026-08-20', '2026-09-10', { today: '2026-11-02' }),
      rangeTotals(db!.prisma, busy, '2026-09-02', '2026-09-03', { today: '2026-11-02', breakdowns: false }),
    ])
    assert.equal(money(results[0].totals.salesTotal), '30.00')
    assert.equal(money(results[1].totals.salesTotal), '30.00')
    assert.equal(money(results[2].totals.salesTotal), '20.00')
  })
})
