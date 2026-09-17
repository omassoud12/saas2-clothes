import { Router } from 'express'
import { createRequireAuth, createRequireTenant } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { listMovements, reconcileInventory } from './inventory.controller.js'
import type { InventoryAuditDependencies } from './inventory.types.js'

export function createInventoryRouter(auth: AuthDependencies, audit: InventoryAuditDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth))
  router.get('/movements', listMovements(audit))
  router.get('/reconciliation', reconcileInventory(audit))
  return router
}
