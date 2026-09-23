import { Router } from 'express'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { UserRole } from '../generated/prisma/enums.js'
import { createSale, getSale, listSales, voidSale } from './sale.controller.js'
import type { SaleDependencies } from './sale.types.js'
import { createReturn } from '../returns/return.controller.js'
import type { ReturnDependencies } from '../returns/return.types.js'

export function createSaleRouter(auth: AuthDependencies, sales: SaleDependencies, returns: ReturnDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER, UserRole.WAREHOUSE))
  router.get('/', listSales(sales))
  router.get('/:saleId', getSale(sales))
  router.post('/:saleId/returns', createReturn(returns))
  router.post('/:saleId/void', requireRole(UserRole.OWNER), voidSale(sales))
  router.post('/', createSale(sales))
  return router
}
