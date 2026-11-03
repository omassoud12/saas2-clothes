// GET /api/dashboard/summary?storeId and GET /api/dashboard/best-sellers?period&sort&limit&storeId.
// DASHBOARD permission; the account, role and permissions come from the session only.
import { Router, type RequestHandler } from 'express'
import { createRequireAuth, createRequireTenant } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { requirePermission } from '../access/permissions.js'
import type { DashboardDependencies } from './dashboard.service.js'

function rateLimit(dependencies: DashboardDependencies): RequestHandler {
  return (request, response, next) => {
    const accountId = request.auth?.accountId
    const wait = accountId ? dependencies.takeRateLimit(accountId) : null
    if (wait === null) { next(); return }
    response.set('Retry-After', String(wait))
    next(new HttpError(429, 'RATE_LIMITED', 'Too many dashboard requests. Wait a moment and try again.'))
  }
}

function send(load: (request: Parameters<RequestHandler>[0]) => Promise<{ body: object; etag: string }>): RequestHandler {
  return async (request, response, next) => {
    try {
      const result = await load(request)
      response.set('Cache-Control', 'private, max-age=30')
      response.set('ETag', result.etag)
      if (request.headers['if-none-match'] === result.etag) { response.status(304).end(); return }
      response.json(result.body)
    } catch (error) {
      next(error)
    }
  }
}

export function createDashboardRouter(auth: AuthDependencies, dependencies: DashboardDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requirePermission('DASHBOARD'), rateLimit(dependencies))
  router.get('/summary', send((request) => dependencies.getSummary(request.auth, request.query as Record<string, unknown>)))
  router.get('/best-sellers', send((request) => dependencies.getBestSellers(request.auth, request.query as Record<string, unknown>)))
  return router
}
