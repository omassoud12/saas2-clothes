// Mounted at /api/products before the product router: only these three paths are handled here, every
// other /api/products request goes on to the product router untouched.
import { Router, type RequestHandler } from 'express'
import { createRequireAuth, createRequireTenant } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { requireAnyPermission, requirePermission } from '../access/permissions.js'
import type { CostDependencies } from './cost.service.js'

function handle(run: (request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler {
  return async (request, response, next) => {
    try { await run(request, response) } catch (error) { next(error) }
  }
}

export function createCostRouter(auth: AuthDependencies, costs: CostDependencies): Router {
  const router = Router()
  const tenant = [createRequireAuth(auth), createRequireTenant(auth)]
  const read = requireAnyPermission('EDIT_PRODUCT_COST', 'VIEW_COST_PROFIT')
  router.get('/missing-cost', ...tenant, read, handle(async (request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(await costs.missingCost(request.auth, request.query as Record<string, unknown>))
  }))
  router.get('/:productId/cost-history', ...tenant, read, handle(async (request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json(await costs.costHistory(request.auth, String(request.params.productId), request.query as Record<string, unknown>))
  }))
  router.post('/:productId/cost-entries', ...tenant, requirePermission('EDIT_PRODUCT_COST'), handle(async (request, response) => {
    response.status(201).json(await costs.addCostEntry(request.auth, String(request.params.productId), request.body, request.ip))
  }))
  return router
}
