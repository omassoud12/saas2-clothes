// Load test and query plans for the business endpoints, against the LOCAL load database (scripts/seed-load.ts).
//
//   npx tsx scripts/bench-business.ts [--requests 1000] [--concurrency 50] [--explain] [--cache]
//
// Starts the business routes in-process (fake auth: the bearer token is "<accountId>:<ownerId>"), with the
// report cache OFF unless --cache, and fires `--requests` requests per endpoint with `--concurrency` in
// flight, each for a random account and period. Prints p50/p95/p99 and requests/s as markdown.
// --explain also captures every SQL a report runs and prints EXPLAIN (ANALYZE, BUFFERS) for it.
import type { AddressInfo } from 'node:net'
import express from 'express'
import pg from 'pg'
import type { AuthDependencies } from '../src/auth/auth.types.js'
import { AccountStatus, UserRole } from '../src/generated/prisma/enums.js'
import { createPrismaClient } from '../src/lib/prisma.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { AccountRateLimiter, ReportCache } from '../src/business/business-cache.js'
import { createBusinessDependencies, createBusinessRouter } from '../src/business/business.routes.js'
import { mondayOf, shiftDate, shopNow } from '../src/business/business-dates.js'

const args = process.argv.slice(2)
const flag = (name: string, fallback: number) => { const index = args.indexOf(name); return index >= 0 ? Number(args[index + 1]) : fallback }
const requestsPerEndpoint = flag('--requests', 1000)
const concurrency = flag('--concurrency', 50)
const url = process.env.LOAD_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/saas2_load'
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('Refusing to benchmark a non-local database')

// Capture the SQL the reports run (for --explain).
const captured: { text: string; values: unknown[] }[] = []
let capturing = false
const originalQuery = pg.Client.prototype.query
pg.Client.prototype.query = function patched(this: pg.Client, ...callArgs: any[]) {
  if (capturing) {
    const first = callArgs[0]
    const text = typeof first === 'string' ? first : first?.text
    const values = (typeof first === 'string' ? callArgs[1] : first?.values) ?? []
    if (typeof text === 'string' && /"(Sale|SaleItem|SaleReturn|DailySalesRollup|DailyProductRollup|DailyStaffRollup|ProductVariant)"/.test(text) && /^\s*(WITH|SELECT)/i.test(text)) captured.push({ text, values })
  }
  return (originalQuery as any).apply(this, callArgs)
} as any

const prisma = createPrismaClient(url, { caPath: '', nodeEnvironment: 'development' })
const owners = await prisma.user.findMany({ where: { role: UserRole.OWNER }, select: { id: true, accountId: true } })
if (!owners.length) throw new Error('No accounts: run scripts/seed-load.ts first')

const auth: AuthDependencies = {
  async verifyAccessToken(token) { const [, userId] = token.split(':'); return { id: userId!, email: 'load@test.local', emailConfirmedAt: '2026-01-01T00:00:00.000Z', isAnonymous: false } },
  async findApplicationUser(userId) { const owner = owners.find((row) => row.id === userId)!; return { id: owner.id, role: UserRole.OWNER, accountId: owner.accountId, isActive: true } },
  async findAccountById(accountId) { return { id: accountId, status: AccountStatus.ACTIVE } },
  async findCurrentUser() { return null },
  async bootstrapOwner() { throw Error('unused') },
}
const cache = args.includes('--cache') ? new ReportCache() : new ReportCache(1, 0, 0)
const business = createBusinessDependencies(prisma, { cache, rateLimiter: new AccountRateLimiter(1_000_000_000), timeoutMs: 30_000 })
const app = express()
app.use('/api/business', createBusinessRouter(auth, business))
app.use(errorHandler)
const server = app.listen(0)
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/business`

const today = shopNow('Asia/Beirut').date
const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!
const pastDate = () => shiftDate(today, -Math.floor(Math.random() * 365))
const endpoints: Record<string, () => string> = {
  daily: () => `/daily?date=${Math.random() < 0.2 ? today : pastDate()}`,
  weekly: () => `/weekly?week=${mondayOf(pastDate())}`,
  monthly: () => `/monthly?month=${pastDate().slice(0, 7)}`,
  yearly: () => `/yearly?year=${pick([today.slice(0, 4), String(Number(today.slice(0, 4)) - 1)])}`,
  invoices: () => `/daily/invoices?date=${pastDate()}&limit=10`,
}

async function call(path: string, owner = pick(owners)) {
  const started = performance.now()
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${owner.accountId}:${owner.id}` } })
  await response.arrayBuffer()
  if (response.status !== 200) throw new Error(`${path} → ${response.status}`)
  return performance.now() - started
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
try {
  if (args.includes('--explain')) {
    const busiest = (await prisma.$queryRaw<{ id: string }[]>`SELECT "accountId"::text AS id FROM "Sale" GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)[0]!.id
    const owner = owners.find((row) => row.accountId === busiest)!
    const explain = new pg.Client({ connectionString: url })
    await explain.connect()
    for (const [name, path] of [['daily (today, live)', `/daily?date=${today}`], ['daily (past day)', `/daily?date=${shiftDate(today, -40)}`],
      ['weekly', `/weekly?week=${mondayOf(shiftDate(today, -60))}`], ['monthly (current)', `/monthly?month=${today.slice(0, 7)}`],
      ['yearly', `/yearly?year=${today.slice(0, 4)}`], ['invoices', `/daily/invoices?date=${shiftDate(today, -3)}&limit=10`]] as const) {
      captured.length = 0
      capturing = true
      await call(path, owner)
      capturing = false
      console.log(`\n### ${name}\n`)
      const seen = new Set<string>()
      for (const query of captured) {
        if (seen.has(query.text)) continue
        seen.add(query.text)
        const plan = await explain.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) ${query.text}`, query.values as unknown[])
        const lines = plan.rows.map((row) => row['QUERY PLAN'] as string)
        const seq = lines.filter((line) => /Seq Scan on "?(Sale|SaleItem|SaleReturn|SaleReturnItem)"? /.test(line))
        console.log('```')
        console.log(query.text.replace(/\s+/g, ' ').slice(0, 160) + ' …')
        console.log(lines.join('\n'))
        console.log('```')
        if (seq.length) console.log(`**Seq scan on a sales table:** ${seq.join('; ')}`)
      }
    }
    await explain.end()
  }

  console.log(`\n| Endpoint | Requests | Concurrency | p50 ms | p95 ms | p99 ms | req/s |\n|---|---|---|---|---|---|---|`)
  for (const [name, next] of Object.entries(endpoints)) {
    const latencies: number[] = []
    let issued = 0
    const started = performance.now()
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (issued < requestsPerEndpoint) {
        issued += 1
        latencies.push(await call(next()))
      }
    }))
    const seconds = (performance.now() - started) / 1000
    latencies.sort((a, b) => a - b)
    console.log(`| ${name} | ${latencies.length} | ${concurrency} | ${percentile(latencies, 50).toFixed(0)} | ${percentile(latencies, 95).toFixed(0)} | ${percentile(latencies, 99).toFixed(0)} | ${(latencies.length / seconds).toFixed(0)} |`)
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect()
}
