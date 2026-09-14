import { Router } from 'express'
import { createRequireAuth, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { UserRole } from '../generated/prisma/enums.js'
import {
  createApproveAccount,
  createListPendingAccounts,
  createRejectAccount,
  createSuspendAccount,
} from './admin-account.controller.js'
import type { AdminAccountDependencies } from './admin-account.types.js'

export function createAdminAccountRouter(
  auth: AuthDependencies,
  accounts: AdminAccountDependencies,
): Router {
  const router = Router()

  router.use(createRequireAuth(auth), requireRole(UserRole.SUPER_ADMIN))
  router.get('/pending', createListPendingAccounts(accounts))
  router.patch('/:accountId/approve', createApproveAccount(accounts))
  router.patch('/:accountId/reject', createRejectAccount(accounts))
  router.patch('/:accountId/suspend', createSuspendAccount(accounts))

  return router
}
