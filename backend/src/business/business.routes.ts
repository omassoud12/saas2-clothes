// Routes of the business reports. Tenant, user and role always come from the session (createRequireAuth +
// createRequireTenant); the client never sends an account id.
//   GET /api/stores
//   GET /api/business/daily | daily/invoices | weekly | monthly | yearly
//   PUT /api/business/targets, GET|POST /api/business/closed-days, DELETE /api/business/closed-days/:date (OWNER)
import { Router, type RequestHandler } from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthContext, AuthDependencies } from '../auth/auth.types.js'
import { UserRole } from '../generated/prisma/enums.js'
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
}

export interface BusinessDependencies {
  getStores(auth: AuthContext | undefined): Promise<object>
  getReport(kind: ReportKind, auth: AuthContext | undefined, query: Record<string, unknown>): Promise<ReportResult>
  setTarget(auth: AuthContext | undefined, body: unknown): Promise<object>
  listClosedDays(auth: AuthContext | undefined, query: Record<string, unknown>): Promise<object>
  addClosedDay(auth: AuthContext | undefined, body: unknown): Promise<object>
  removeClosedDay(auth: AuthContext | undefined, date: string, storeId: unknown): Promise<object>
}

function isLive(kind: ReportKind, body: object, ctx: ReportContext, query: Record<string, unknown>): boolean {
  if (kind === 'invoices') return query.date === ctx.now.date
  if (kind === 'yearly') return String(query.year) === ctx.now.date.slice(0, 4)
  return (body as { live?: boolean }).live === true
}

export function createBusinessDependencies(prisma: PrismaClient, options: BusinessOptions = {}): BusinessDependencies {
  const account = async (auth: AuthContext | undefined) => loadAccountContext(prisma, tenantOf(auth).accountId)
  return {
    async getStores(auth) {
      const context = await account(auth)
      return { items: context.stores.map((store) => ({ id: store.id, name: store.name })) }
    },
    async getReport(kind, auth, query) {
      const ctx = await reportContext(prisma, auth, query.storeId, options)
      const body = await builders[kind](ctx, query)
      return { body, live: isLive(kind, body, ctx, query) }
    },
    async setTarget(auth, body) { return setTarget(prisma, await account(auth), body) },
    async listClosedDays(auth, query) { return listClosedDays(prisma, await account(auth), query) },
    async addClosedDay(auth, body) { return addClosedDay(prisma, await account(auth), body) },
    async removeClosedDay(auth, date, storeId) { return removeClosedDay(prisma, await account(auth), date, storeId) },
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
    response.json(result.body)
  })
}

export function createBusinessRouter(auth: AuthDependencies, dependencies: BusinessDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER, UserRole.WAREHOUSE))
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
