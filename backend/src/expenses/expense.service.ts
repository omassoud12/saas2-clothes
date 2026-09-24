import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { encodeExpenseCursor, formatExpenseDate } from './expense.schemas.js'
import type {
  ExpenseDependencies,
  ExpenseHistoryQuery,
  ExpenseInput,
  ExpenseView,
} from './expense.types.js'

const expenseSelect = {
  id: true,
  amount: true,
  currency: true,
  description: true,
  expenseDate: true,
  createdById: true,
  createdAt: true,
} as const

type ExpenseRecord = Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>
type LockedAccount = { id: string; baseCurrency: string; status: AccountStatus }
type LockedOwner = { id: string; role: UserRole; isActive: boolean }

function toView(expense: ExpenseRecord): ExpenseView {
  return {
    id: expense.id,
    amount: expense.amount.toFixed(2),
    currency: expense.currency,
    description: expense.description,
    expenseDate: formatExpenseDate(expense.expenseDate),
    createdById: expense.createdById,
    createdAt: expense.createdAt,
  }
}

export function createExpenseDependencies(prisma: PrismaClient): ExpenseDependencies {
  async function createExpense(accountId: string, createdById: string, input: ExpenseInput) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const accounts = await transaction.$queryRaw<LockedAccount[]>(
          Prisma.sql`SELECT "id", "baseCurrency", "status" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`,
        )
        const account = accounts[0]
        if (!account || account.status !== AccountStatus.ACTIVE || !/^[A-Z]{3}$/.test(account.baseCurrency)) {
          throw new HttpError(409, 'EXPENSE_ACCOUNT_UNAVAILABLE', 'Expense Account is unavailable')
        }

        const owners = await transaction.$queryRaw<LockedOwner[]>(
          Prisma.sql`SELECT "id", "role", "isActive" FROM "User" WHERE "id" = ${createdById}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`,
        )
        const owner = owners[0]
        if (!owner || !owner.isActive || owner.role !== UserRole.OWNER) {
          throw new HttpError(403, 'EXPENSE_CREATOR_UNAVAILABLE', 'Creator is not authorized to create Expenses')
        }

        const expense = await transaction.expense.create({
          data: {
            accountId,
            createdById,
            amount: new Prisma.Decimal(input.amount),
            currency: account.baseCurrency,
            description: input.description,
            expenseDate: input.expenseDate,
          },
          select: expenseSelect,
        })
        return { expense: toView(expense) }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'EXPENSE_CREATE_UNAVAILABLE', 'Expense could not be created')
    }
  }

  async function listExpenses(accountId: string, query: ExpenseHistoryQuery) {
    try {
      const where: Prisma.ExpenseWhereInput = {
        accountId,
        ...(query.from || query.to ? {
          expenseDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        } : {}),
        ...(query.cursor ? {
          OR: [
            { expenseDate: { lt: query.cursor.expenseDate } },
            { expenseDate: query.cursor.expenseDate, id: { lt: query.cursor.id } },
          ],
        } : {}),
      }
      const rows = await prisma.expense.findMany({
        where,
        select: expenseSelect,
        orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      })
      const page = rows.slice(0, query.limit)
      const last = page.at(-1)
      return {
        expenses: page.map(toView),
        nextCursor: rows.length > query.limit && last
          ? encodeExpenseCursor(last.expenseDate, last.id)
          : null,
      }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'EXPENSE_HISTORY_UNAVAILABLE', 'Expense history is temporarily unavailable')
    }
  }

  return { createExpense, listExpenses }
}
