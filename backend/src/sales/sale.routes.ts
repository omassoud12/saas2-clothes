import { Router } from 'express'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { UserRole } from '../generated/prisma/enums.js'
import { createSale, getSale, listSales } from './sale.controller.js'
import type { SaleDependencies } from './sale.types.js'

export function createSaleRouter(auth: AuthDependencies, sales: SaleDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER, UserRole.WAREHOUSE))
  router.get('/', listSales(sales))
  router.get('/:saleId', getSale(sales))
  router.post('/', createSale(sales))
  return router
}
