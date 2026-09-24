import { Router } from 'express'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { UserRole } from '../generated/prisma/enums.js'
import { getExchange, listExchanges } from './exchange.history.controller.js'
import type { ExchangeHistoryDependencies } from './exchange.history.service.js'

export function createExchangeHistoryRouter(auth: AuthDependencies, history: ExchangeHistoryDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER, UserRole.WAREHOUSE))
  router.get('/', listExchanges(history))
  router.get('/:exchangeId', getExchange(history))
  return router
}
