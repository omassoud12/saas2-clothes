import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import type {
  AdminAccountDependencies,
  ReviewedAccount,
} from './admin-account.types.js'

const reviewedAccountSelect = {
  id: true,
  status: true,
  reviewedAt: true,
  reviewedById: true,
  rejectionReason: true,
} as const

type ReviewedAccountRecord = Prisma.AccountGetPayload<{
  select: typeof reviewedAccountSelect
}>

async function getUpdatedAccount(
  prisma: PrismaClient,
  accountId: string,
): Promise<ReviewedAccountRecord> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: reviewedAccountSelect,
  })

  if (!account) {
    throw new HttpError(
      500,
      'ACCOUNT_UPDATE_INTEGRITY_ERROR',
      'Updated Account could not be resolved',
    )
  }

  return account
}

async function throwTransitionFailure(
  prisma: PrismaClient,
  accountId: string,
  conflictCode: string,
  conflictMessage: string,
): Promise<never> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true },
  })

  if (!account) {
    throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'Account does not exist')
  }

  throw new HttpError(409, conflictCode, conflictMessage)
}

async function reviewPendingAccount(
  prisma: PrismaClient,
  accountId: string,
  reviewerId: string,
  status: typeof AccountStatus.ACTIVE | typeof AccountStatus.REJECTED,
  rejectionReason: string | null,
): Promise<ReviewedAccount> {
  const result = await prisma.account.updateMany({
    where: { id: accountId, status: AccountStatus.PENDING },
    data: {
      status,
      reviewedAt: new Date(),
      reviewedById: reviewerId,
      rejectionReason,
    },
  })

  if (result.count !== 1) {
    return throwTransitionFailure(
      prisma,
      accountId,
      'ACCOUNT_ALREADY_REVIEWED',
      'Account has already been reviewed',
    )
  }

  return getUpdatedAccount(prisma, accountId)
}

export function createAdminAccountDependencies(
  prisma: PrismaClient,
): AdminAccountDependencies {
  return {
    async listPendingAccounts() {
      const accounts = await prisma.account.findMany({
        where: { status: AccountStatus.PENDING },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          baseCurrency: true,
          status: true,
          createdAt: true,
          users: {
            where: { role: UserRole.OWNER },
            orderBy: { createdAt: 'asc' },
            take: 2,
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      })

      return accounts.map(({ users, ...account }) => {
        if (users.length !== 1) {
          throw new HttpError(
            500,
            'ACCOUNT_OWNER_INTEGRITY_ERROR',
            'Pending Account has an invalid OWNER relationship',
          )
        }

        return { account, owner: users[0] }
      })
    },

    approveAccount(accountId, reviewerId) {
      return reviewPendingAccount(
        prisma,
        accountId,
        reviewerId,
        AccountStatus.ACTIVE,
        null,
      )
    },

    rejectAccount(accountId, reviewerId, reason) {
      return reviewPendingAccount(
        prisma,
        accountId,
        reviewerId,
        AccountStatus.REJECTED,
        reason,
      )
    },

    async suspendAccount(accountId) {
      const result = await prisma.account.updateMany({
        where: { id: accountId, status: AccountStatus.ACTIVE },
        data: { status: AccountStatus.SUSPENDED },
      })

      if (result.count !== 1) {
        return throwTransitionFailure(
          prisma,
          accountId,
          'ACCOUNT_NOT_ACTIVE',
          'Only an active Account can be suspended',
        )
      }

      return getUpdatedAccount(prisma, accountId)
    },
  }
}
