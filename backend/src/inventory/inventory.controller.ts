import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseHistoryQuery, parseReconciliationQuery } from './inventory.schemas.js'
import type { InventoryAuditDependencies } from './inventory.types.js'

function tenantContext(auth: Express.Request['auth']): { accountId: string; role: UserRole } {
  if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE ||
      (auth.role !== UserRole.OWNER && auth.role !== UserRole.WAREHOUSE)) {
    throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An active tenant is required')
  }
  return { accountId: auth.accountId, role: auth.role }
}

export function listMovements(dependencies: InventoryAuditDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const { accountId, role } = tenantContext(request.auth)
      const query = parseHistoryQuery(request.query)
      response.json(await dependencies.listMovements(accountId, role, query))
    } catch (error) { next(error) }
  }
}

export function reconcileInventory(dependencies: InventoryAuditDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const { accountId } = tenantContext(request.auth)
      const query = parseReconciliationQuery(request.query)
      response.json(await dependencies.reconcile(accountId, query))
    } catch (error) { next(error) }
  }
}
