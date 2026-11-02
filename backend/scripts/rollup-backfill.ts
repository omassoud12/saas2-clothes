// Fills the business rollup tables for past months, account by account and month by month.
// Resumable: a month whose days are all rolled up already is skipped (use --force to recompute).
//
//   node scripts/with-dev-db.mjs npx tsx scripts/rollup-backfill.ts            # local database
//   npx tsx scripts/rollup-backfill.ts [--account <uuid>] [--from YYYY-MM] [--force]
//
// Without the wrapper it uses DATABASE_URL from .env: only run it like that on purpose.
import 'dotenv/config'
import { Prisma } from '../src/generated/prisma/client.js'
import { createPrismaClient } from '../src/lib/prisma.js'
import { monthDates, shopNow, shiftMonth } from '../src/business/business-dates.js'
import { loadAccountContext } from '../src/business/business-stores.js'
import { rollupDays } from '../src/business/day-totals.js'

const args = process.argv.slice(2)
const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const force = args.includes('--force')
const onlyAccount = flag('--account')
const fromMonth = flag('--from')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const prisma = createPrismaClient(databaseUrl, { caPath: process.env.SUPABASE_DB_CA_PATH?.trim() ?? '', nodeEnvironment: process.env.NODE_ENV })

try {
  const accounts = await prisma.$queryRaw<{ id: string; first: Date }[]>(Prisma.sql`
    SELECT "accountId"::text AS id, MIN("createdAt") AS first FROM "Sale"
    ${onlyAccount ? Prisma.sql`WHERE "accountId" = ${onlyAccount}::uuid` : Prisma.empty}
    GROUP BY "accountId" ORDER BY 1`)
  let monthsDone = 0
  let monthsSkipped = 0
  for (const [position, account] of accounts.entries()) {
    const context = await loadAccountContext(prisma, account.id)
    const today = shopNow(context.timezone).date
    const firstMonth = fromMonth ?? account.first.toISOString().slice(0, 7)
    for (let month = firstMonth; month <= today.slice(0, 7); month = shiftMonth(month, 1)) {
      const dates = monthDates(month).filter((date) => date < today)
      if (!dates.length) continue
      for (const store of context.stores) {
        if (!force) {
          const [row] = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
            SELECT count(*)::int AS n FROM "DailySalesRollup"
            WHERE "accountId" = ${account.id}::uuid AND "storeId" = ${store.id}::uuid AND "date" BETWEEN ${dates[0]}::date AND ${dates[dates.length - 1]}::date`)
          if (row && row.n === dates.length) { monthsSkipped += 1; continue }
        }
        await rollupDays(prisma, { accountId: account.id, timezone: context.timezone, storeId: store.id }, dates[0]!, dates[dates.length - 1]!, today)
        monthsDone += 1
      }
    }
    console.log(`account ${position + 1}/${accounts.length} done`)
  }
  console.log(`Backfill finished: ${monthsDone} months rolled up, ${monthsSkipped} already complete.`)
} finally {
  await prisma.$disconnect()
}
