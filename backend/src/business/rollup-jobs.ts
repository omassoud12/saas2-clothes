// Keeps the rollup tables fresh. Today is always read live, so only changes to PAST days need a recompute:
//   * after a void (it removes the sale from the day it was made) — refreshAfterVoid();
//   * every night at 03:30 Asia/Beirut, for every account with recent activity: yesterday and the two
//     days before (late voids) — runNightlyRollups() / scheduleNightlyRollups();
//   * history — scripts/rollup-backfill.ts.
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import type { RuntimeLogger } from '../runtime/logger.js'
import { shiftDate, shopNow } from './business-dates.js'
import { loadAccountContext } from './business-stores.js'
import { rollupDays } from './day-totals.js'

export type RollupInvalidator = (accountId: string, dates: readonly string[]) => void

/** After a void has committed: recompute the day the sale was made, if that day is already finished. */
export function createVoidRefresher(prisma: PrismaClient, logger: RuntimeLogger, invalidate: RollupInvalidator = () => {}) {
  return function afterVoid({ accountId, saleId }: { readonly accountId: string; readonly saleId: string }): void {
    setImmediate(() => {
      void (async () => {
        const context = await loadAccountContext(prisma, accountId)
        const [sale] = await prisma.$queryRaw<{ d: string }[]>(Prisma.sql`
          SELECT ("createdAt" AT TIME ZONE ${context.timezone})::date::text AS d FROM "Sale"
          WHERE "id" = ${saleId}::uuid AND "accountId" = ${accountId}::uuid`)
        if (!sale) return
        const today = shopNow(context.timezone).date
        if (sale.d >= today) return
        for (const store of context.stores) {
          await rollupDays(prisma, { accountId, timezone: context.timezone, storeId: store.id }, sale.d, sale.d, today)
        }
        invalidate(accountId, [sale.d])
      })().catch((error: unknown) => {
        logger.warn('business_rollup_after_void_failed', { accountId, code: error instanceof Error ? error.name : 'unknown' })
      })
    })
  }
}

export interface NightlySummary { readonly accounts: number; readonly ok: number; readonly skipped: number; readonly failed: number; readonly ms: number }

/** Rolls up the last `days` finished days of every account with sales, voids or returns in that window. */
export async function runNightlyRollups(
  prisma: PrismaClient,
  logger: RuntimeLogger,
  options: { days?: number; batchSize?: number; invalidate?: RollupInvalidator } = {},
): Promise<NightlySummary> {
  const started = Date.now()
  const days = options.days ?? 3
  const batchSize = options.batchSize ?? 50
  const active = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT "accountId"::text AS id FROM (
      SELECT "accountId" FROM "Sale" WHERE "createdAt" >= now() - make_interval(days => ${days + 2}::int)
      UNION ALL SELECT "accountId" FROM "Sale" WHERE "voidedAt" >= now() - make_interval(days => ${days + 2}::int)
      UNION ALL SELECT "accountId" FROM "SaleReturn" WHERE "createdAt" >= now() - make_interval(days => ${days + 2}::int)
    ) recent`)
  let ok = 0
  let skipped = 0
  const failedIds: string[] = []

  async function rollAccount(accountId: string): Promise<'ok' | 'skipped'> {
    const context = await loadAccountContext(prisma, accountId)
    const today = shopNow(context.timezone).date
    let result: 'ok' | 'skipped' = 'ok'
    for (const store of context.stores) {
      const written = await rollupDays(prisma, { accountId, timezone: context.timezone, storeId: store.id }, shiftDate(today, -days), shiftDate(today, -1), today, { lockAccount: true })
      if (written < 0) result = 'skipped'
    }
    options.invalidate?.(accountId, Array.from({ length: days }, (_, index) => shiftDate(today, -(index + 1))))
    return result
  }

  for (let index = 0; index < active.length; index += batchSize) {
    const batch = active.slice(index, index + batchSize)
    const results = await Promise.allSettled(batch.map((row) => rollAccount(row.id)))
    results.forEach((result, position) => {
      if (result.status === 'fulfilled') { if (result.value === 'ok') ok += 1; else skipped += 1 } else failedIds.push(batch[position]!.id)
    })
  }
  // One retry, one account at a time, for the accounts that failed.
  let failed = 0
  for (const accountId of failedIds) {
    try { if ((await rollAccount(accountId)) === 'ok') ok += 1; else skipped += 1 } catch { failed += 1 }
  }
  const summary = { accounts: active.length, ok, skipped, failed, ms: Date.now() - started }
  logger.info('business_nightly_rollup_finished', { ...summary })
  return summary
}

/** Milliseconds from `now` until the next hh:mm in `timezone`. */
export function msUntilNext(timezone: string, hour: number, minute: number, now: Date = new Date()): number {
  const local = shopNow(timezone, now)
  let wait = (hour * 60 + minute - local.minute) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds()
  if (wait <= 0) wait += 24 * 60 * 60_000
  return wait
}

/** Runs runNightlyRollups every day at 03:30 Asia/Beirut inside the API process. Returns a stop function. */
export function scheduleNightlyRollups(prisma: PrismaClient, logger: RuntimeLogger, options: { invalidate?: RollupInvalidator } = {}): () => void {
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  const plan = () => {
    if (stopped) return
    timer = setTimeout(() => {
      runNightlyRollups(prisma, logger, { invalidate: options.invalidate })
        .catch((error: unknown) => logger.error('business_nightly_rollup_failed', { code: error instanceof Error ? error.name : 'unknown' }))
        .finally(plan)
    }, msUntilNext('Asia/Beirut', 3, 30))
    timer.unref()
  }
  plan()
  return () => { stopped = true; if (timer) clearTimeout(timer) }
}
