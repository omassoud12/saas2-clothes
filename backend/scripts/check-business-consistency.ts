// Proves that every business report shows the same numbers for the same days (the port of
// business-reference/saas2-business/scripts/check-consistency.mjs, run against OUR API):
//   for every day of the current month: monthly day = daily; month = sum of daily; week days = daily;
//   product pieces month = sum of daily; yearly current month = monthly.
//
//   Real API:  BUSINESS_API_URL=https://api.example.com BUSINESS_API_TOKEN=<owner access token> npx tsx scripts/check-business-consistency.ts
//   Local/CI:  npx tsx scripts/check-business-consistency.ts
//              (no URL: starts the business routes on a throwaway local Postgres database with a seeded month)
// Prints "All reports agree." and exits 0, or lists what disagrees and exits 1.
import type { AddressInfo } from 'node:net'
import express from 'express'
import { mapDailySummary, mapMonthly, mapWeekly, mapYearly } from '../../frontend/src/features/business/domain/mappers.js'
import type { AuthDependencies } from '../src/auth/auth.types.js'
import { AccountStatus, UserRole } from '../src/generated/prisma/enums.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { dateRange, mondayOf, shiftDate, shopNow } from '../src/business/business-dates.js'
import { AccountRateLimiter } from '../src/business/business-cache.js'
import { createBusinessDependencies, createBusinessRouter } from '../src/business/business.routes.js'
import { addReturn, addSale, createTestDatabase, seedAccount, voidSale } from '../src/business/business-test-db.js'

let base = process.env.BUSINESS_API_URL?.replace(/\/$/, '') ?? ''
let token = process.env.BUSINESS_API_TOKEN ?? ''
let cleanup = async () => {}

if (!base) {
  const db = await createTestDatabase()
  if (!db) { console.error('No BUSINESS_API_URL and no local Postgres (node scripts/dev-db.mjs start).'); process.exit(1) }
  const shop = await seedAccount(db.sql, { name: 'Consistency shop' })
  const now = shopNow('Asia/Beirut')
  // Every day of this month up to today, from 09:00 (today: only what is already in the past), plus a void and a return.
  const month = dateRange(`${now.date.slice(0, 7)}-01`, now.date)
  for (const [index, date] of month.entries()) {
    for (let sale = 0; sale < 1 + (index % 4); sale += 1) {
      const hour = 9 + sale
      if (date === now.date && hour * 60 >= now.minute) continue
      const created = await addSale(db.sql, shop, {
        at: `${date}T${String(hour).padStart(2, '0')}:10:00+0${date >= '2026-10-25' && date < '2027-03-28' ? 2 : 3}:00`,
        method: sale % 2 ? 'WHISH_OMT' : 'CASH', seller: sale % 2 ? shop.staff : shop.owner,
        lines: [{ variant: shop.variants[sale % 3]!, quantity: 1 + (sale % 2), price: '35.00', cost: '20.0000' }],
      })
      if (index === 1 && sale === 0) await voidSale(db.sql, shop, created.saleId, `${date}T18:00:00Z`)
      if (index === 2 && sale === 1) await addReturn(db.sql, shop, { saleId: created.saleId, at: `${date}T15:00:00Z`, lines: [{ itemId: created.itemIds[0]!, variant: shop.variants[1]!, quantity: 1, refund: '35.00' }] })
    }
  }
  const auth: AuthDependencies = {
    async verifyAccessToken() { return { id: shop.owner.id, email: 'owner@check.local', emailConfirmedAt: '2026-01-01T00:00:00.000Z', isAnonymous: false } },
    async findApplicationUser() { return { id: shop.owner.id, role: UserRole.OWNER, accountId: shop.accountId, isActive: true } },
    async findAccountById() { return { id: shop.accountId, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw Error('unused') },
  }
  const app = express()
  app.use('/api/business', createBusinessRouter(auth, createBusinessDependencies(db.prisma, { rateLimiter: new AccountRateLimiter(1_000_000) })))
  app.use(errorHandler)
  const server = app.listen(0)
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  token = 'local'
  cleanup = async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await db.drop() }
}

async function get(path: string) {
  const response = await fetch(`${base}/api/business${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`)
  return response.json()
}

let failed = 0
const eq = (label: string, a: number, b: number) => {
  const ok = Math.abs(a - b) < 0.005
  if (!ok) failed += 1
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${a.toFixed(2)} vs ${b.toFixed(2)}`)
}

try {
  const today = shopNow('Asia/Beirut').date
  const ym = today.slice(0, 7)
  const m = mapMonthly(await get(`/monthly?month=${ym}`))
  let sales = 0
  let invoices = 0
  const pieces: Record<string, number> = {}
  const daily = new Map<string, ReturnType<typeof mapDailySummary>>()
  for (const d of m.days.filter((x: { sales: number | null }) => x.sales !== null)) {
    const day = mapDailySummary(await get(`/daily?date=${d.date}`))
    daily.set(d.date, day)
    eq(`${d.date} monthly day = daily (sales)`, d.sales, day.sales)
    eq(`${d.date} monthly day = daily (invoices)`, d.invoices, day.invoices)
    sales += day.sales
    invoices += day.invoices
    day.products.forEach((p: { name: string; quantity: number }) => { pieces[p.name] = (pieces[p.name] ?? 0) + p.quantity })
  }
  eq('month = sum of daily (sales)', m.sales, sales)
  eq('month = sum of daily (invoices)', m.invoices, invoices)
  // Every week that touches this month: its days in this month = daily.
  for (let monday = mondayOf(`${ym}-01`); monday <= today; monday = shiftDate(monday, 7)) {
    const w = mapWeekly(await get(`/weekly?week=${monday}`))
    for (const d of w.days.filter((x: { sales: number | null; date: string }) => x.sales !== null && x.date.startsWith(ym))) {
      eq(`week ${monday}: ${d.date} = daily`, d.sales, daily.get(d.date)!.sales)
    }
  }
  m.products.forEach((p: { name: string; quantity: number }) => eq(`${p.name} pieces month = sum of daily`, p.quantity, pieces[p.name] ?? 0))
  const y = mapYearly(await get(`/yearly?year=${today.slice(0, 4)}`), ym)
  const yearMonth = y.months.find((x: { month: string }) => x.month === ym)!
  eq(`yearly ${ym} = monthly (sales)`, yearMonth.sales, m.sales)
  eq(`yearly ${ym} = monthly (invoices)`, yearMonth.invoices, m.invoices)
} finally {
  await cleanup()
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll reports agree.')
process.exit(failed ? 1 : 0)
