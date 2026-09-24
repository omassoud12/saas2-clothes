import { Router } from 'express'
import { createRequireAuth, createRequireTenant, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { UserRole } from '../generated/prisma/enums.js'
import { createExpense, listExpenses } from './expense.controller.js'
import type { ExpenseDependencies } from './expense.types.js'

export function createExpenseRouter(auth: AuthDependencies, expenses: ExpenseDependencies): Router {
  const router = Router()
  router.use(createRequireAuth(auth), createRequireTenant(auth), requireRole(UserRole.OWNER))
  router.get('/', listExpenses(expenses))
  router.post('/', createExpense(expenses))
  return router
}
