import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseExpenseHistoryQuery, parseExpenseInput } from './expense.schemas.js'
import type { ExpenseDependencies } from './expense.types.js'

function ownerContext(auth: Express.Request['auth']): { accountId: string; userId: string } {
  if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE || auth.role !== UserRole.OWNER) {
    throw new HttpError(403, 'EXPENSE_OWNER_REQUIRED', 'An active tenant OWNER is required')
  }
  return { accountId: auth.accountId, userId: auth.userId }
}

export function createExpense(dependencies: ExpenseDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const { accountId, userId } = ownerContext(request.auth)
      const result = await dependencies.createExpense(accountId, userId, parseExpenseInput(request.body))
      response.status(201).json(result)
    } catch (error) {
      next(error)
    }
  }
}

export function listExpenses(dependencies: ExpenseDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const { accountId } = ownerContext(request.auth)
      response.json(await dependencies.listExpenses(accountId, parseExpenseHistoryQuery(request.query)))
    } catch (error) {
      next(error)
    }
  }
}
