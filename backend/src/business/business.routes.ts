// Routes of the business reports. Tenant, user and role always come from the session (createRequireAuth +
// createRequireTenant); the client never sends an account id.
//   GET /api/stores
//   GET /api/business/daily | daily/invoices | weekly | monthly | yearly
//   PUT /api/business/targets, GET|POST /api/business/closed-days, DELETE /api/business/closed-days/:date (OWNER)
// Load protection: per-account rate limit, a cache of finished and live reports (ETag / 304,
// Cache-Control), a request time limit, 5 s per database statement, and a log line for slow reports.
import { Router, type RequestHandler } from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthContext, AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { UserRole } from '../generated/prisma/enums.js'
import type { RuntimeLogger } from '../runtime/logger.js'
import { AccountRateLimiter, ReportCache } from './business-cache.js'
import { loadAccountContext } from './business-stores.js'
import { addClosedDay, listClosedDays, removeClosedDay, setTarget } from './business-settings.service.js'
import { dailyInvoices, dailyReport } from './daily.service.js'
import { monthlyReport } from './monthly.service.js'
import { reportContext, tenantOf, type BusinessOptions, type ReportContext } from './report-common.js'
import { weeklyReport } from './weekly.service.js'
import { yearlyReport } from './yearly.service.js'

export type ReportKind = 'daily' | 'invoices' | 'weekly' | 'monthly' | 'yearly'

const builders: Record<ReportKind, (ctx: ReportContext, query: Record<string, unknown>) => Promise<object>> = {
  daily: dailyReport,
  invoices: dailyInvoices,
  weekly: weeklyReport,
  monthly: monthlyReport,
  yearly: yearlyReport,
}

export interface ReportResult {
  readonly body: object
  /** The period contains today (numbers still change). */
  readonly live: boolean
  readonly etag: string
}

export interface BusinessDependencies {
  getStores(auth: AuthContext | undefined): Promise<object>
  getReport(kind: ReportKind, auth: AuthContext | undefined, query: Record<string, unknown>): Promise<ReportResult>
  setTarget(auth: AuthContext | undefined, body: unknown): Promise<object>
  listClosedDays(auth: AuthContext | undefined, query: Record<string, unknown>): Promise<object>
  addClosedDay(auth: AuthContext | undefined, body: unknown): Promise<object>
  removeClosedDay(auth: AuthContext | undefined, date: string, storeId: unknown): Promise<object>
  /** Forget the cached reports of an account (its rollups, targets or closed days changed). */
  invalidate(accountId: string): void
  /** null when allowed, otherwise the seconds to wait. */
  takeRateLimit(accountId: string): number | null
}

export interface BusinessDependencyOptions extends BusinessOptions {
  readonly cache?: ReportCache
  readonly rateLimiter?: AccountRateLimiter
  readonly logger?: RuntimeLogger
  /** A report slower than this is logged (accountId + endpoint only). */
  readonly slowMs?: number
  /** A report not built within this time answers 503. */
  readonly timeoutMs?: number
}

function isLive(kind: ReportKind, body: object, ctx: ReportContext, query: Record<string, unknown>): boolean {
  if (kind === 'invoices') return query.date === ctx.now.date
  if (kind === 'yearly') return String(query.year) === ctx.now.date.slice(0, 4)
  return (body as { live?: boolean }).live === true
}

function periodKey(kind: ReportKind, query: Record<string, unknown>): string {
  const value = (name: string) => (typeof query[name] === 'string' ? query[name] : '')
  switch (kind) {
    case 'daily': return value('date')
    case 'invoices': return [value('date'), value('method'), value('q'), value('cursor'), value('limit')].join('|')
    case 'weekly': return value('week')
    case 'monthly': return value('month')
    case 'yearly': return value('year')
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HttpError(503, 'BUSINESS_REPORT_TIMEOUT', 'The report took too long. Try again in a moment.')), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

export function createBusinessDependencies(prisma: PrismaClient, options: BusinessDependencyOptions = {}): BusinessDependencies {
  const cache = options.cache ?? new ReportCache()
  const limiter = options.rateLimiter ?? new AccountRateLimiter()
  const slowMs = options.slowMs ?? 500
  const timeoutMs = options.timeoutMs ?? 10_000
  const account = async (auth: AuthContext | undefined) => loadAccountContext(prisma, tenantOf(auth).accountId)
  const changed = <T>(auth: AuthContext | undefined, result: T): T => { cache.invalidateAccount(tenantOf(auth).accountId); return result }

  return {
    async getStores(auth) {
      const context = await account(auth)
      return { items: context.stores.map((store) => ({ id: store.id, name: store.name })) }
    },
    async getReport(kind, auth, query) {
      const started = Date.now()
      const ctx = await reportContext(prisma, auth, query.storeId, options)
      const key = `${ctx.scope.accountId}:${ctx.storeKey}:${kind}:${periodKey(kind, query)}:${ctx.isOwner ? 'owner' : 'staff'}`
      const cached = cache.get(key)
      if (cached) return cached
      const body = await withTimeout(builders[kind](ctx, query), timeoutMs)
      const entry = cache.set(key, ctx.scope.accountId, body, isLive(kind, body, ctx, query))
      const durationMs = Date.now() - started
      if (durationMs > slowMs) options.logger?.warn('business_report_slow', { accountId: ctx.scope.accountId, endpoint: kind, durationMs })
      return entry
    },
    async setTarget(auth, body) { return changed(auth, await setTarget(prisma, await account(auth), body)) },
    async listClosedDays(auth, query) { return listClosedDays(prisma, await account(auth), query) },
    async addClosedDay(auth, body) { return changed(auth, await addClosedDay(prisma, await account(auth), body)) },
    async removeClosedDay(auth, date, storeId) { return changed(auth, await removeClosedDay(prisma, await account(auth), date, storeId)) },
    invalidate(accountId) { cache.invalidateAccount(accountId) },
    takeRateLimit(accountId) { return limiter.take(accountId) },
  }
}

function handle(run: (request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler {
  return async (request, response, next) => {
    try { await run(request, response) } catch (error) { next(error) }
  }
}

function report(kind: ReportKind, dependencies: BusinessDependencies): RequestHandler {
  return handle(async (request, response) => {
    const result = await dependencies.getReport(kind, request.auth, request.query as Record<string, unknown>)
    // Live periods change every minute; finished periods only change after a late void.
    response.set('Cache-Control', result.live ? 'private, max-age=30' : 'private, max-age=300')
    response.set('ETag', result.etag)
    if (request.headers['if-none-match'] === result.etag) {
      response.status(304).end()
      return
    }
    response.json(result.body)
  })
}

function rateLimit(dependencies: BusinessDependencies): RequestHandler {
  return (request, response, next) => {
    const accountId = request.auth?.accountId
    const wait = accountId ? dependencies.takeRateLimit(accountId) : null
    if (wait === null) { next(); return }
    response.set('Retry-After', String(wait))
    next(new HttpError(429, 'RATE_LIMITED', 'Too many report requests. Wait a moment and try again.'))
  }
}

export function createBusinessRouter(auth: AuthDependencies, dependencies: BusinessDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER, UserRole.WAREHOUSE), rateLimit(dependencies))
  router.get('/daily', report('daily', dependencies))
  router.get('/daily/invoices', report('invoices', dependencies))
  router.get('/weekly', report('weekly', dependencies))
  router.get('/monthly', report('monthly', dependencies))
  router.get('/yearly', report('yearly', dependencies))
  router.put('/targets', requireRole(UserRole.OWNER), handle(async (request, response) => { response.json(await dependencies.setTarget(request.auth, request.body)) }))
  router.get('/closed-days', handle(async (request, response) => { response.json(await dependencies.listClosedDays(request.auth, request.query as Record<string, unknown>)) }))
  router.post('/closed-days', requireRole(UserRole.OWNER), handle(async (request, response) => { response.status(201).json(await dependencies.addClosedDay(request.auth, request.body)) }))
  router.delete('/closed-days/:date', requireRole(UserRole.OWNER), handle(async (request, response) => {
    response.json(await dependencies.removeClosedDay(request.auth, String(request.params.date), request.query.storeId))
  }))
  return router
}

export function createStoreRouter(auth: AuthDependencies, dependencies: BusinessDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER, UserRole.WAREHOUSE))
  router.get('/', handle(async (request, response) => { response.json(await dependencies.getStores(request.auth)) }))
  return router
}
