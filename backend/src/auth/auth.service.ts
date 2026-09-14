import type { SupabaseClient } from '@supabase/supabase-js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import type {
  AuthDependencies,
  OwnerBootstrapData,
  OwnerBootstrapInput,
  OwnerBootstrapResult,
  VerifiedIdentityContext,
} from './auth.types.js'

const ownerBootstrapSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  employeeCode: true,
  accountId: true,
  account: {
    select: {
      id: true,
      name: true,
      status: true,
      baseCurrency: true,
    },
  },
} as const

type OwnerBootstrapRecord = Prisma.UserGetPayload<{
  select: typeof ownerBootstrapSelect
}>

export interface AuthVerificationFailure {
  readonly status: number | null
  readonly code: string
}

type AuthVerificationFailureReporter = (
  failure: AuthVerificationFailure,
) => void

function toSafeAuthVerificationFailure(
  error: unknown,
): AuthVerificationFailure {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
      ? error.status
      : null
  const providerCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Za-z0-9_-]{1,100}$/.test(error.code)
      ? error.code
      : null

  return Object.freeze({
    status,
    code: providerCode ?? 'AUTH_PROVIDER_ERROR',
  })
}

function reportAuthVerificationFailure(
  failure: AuthVerificationFailure,
): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('Supabase Auth verification failed', failure)
  }
}

function safelyReportAuthVerificationFailure(
  error: unknown,
  reporter: AuthVerificationFailureReporter,
): void {
  try {
    reporter(toSafeAuthVerificationFailure(error))
  } catch {
    // Authentication behavior must not depend on diagnostic reporting.
  }
}

function existingOwnerResult(
  existingUser: OwnerBootstrapRecord,
): OwnerBootstrapResult {
  if (existingUser.role !== UserRole.OWNER) {
    throw new HttpError(
      409,
      'AUTH_IDENTITY_ALREADY_PROVISIONED',
      'Authenticated identity is already provisioned with another role',
    )
  }

  if (!existingUser.accountId || !existingUser.account) {
    throw new HttpError(
      500,
      'OWNER_ACCOUNT_INTEGRITY_ERROR',
      'Owner account relationship is inconsistent',
    )
  }

  return {
    created: false,
    data: {
      user: {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        role: existingUser.role,
        employeeCode: existingUser.employeeCode,
      },
      account: existingUser.account,
    },
  }
}

async function bootstrapOwner(
  prisma: PrismaClient,
  identity: VerifiedIdentityContext,
  input: OwnerBootstrapInput,
): Promise<OwnerBootstrapResult> {
  const existingUser = await prisma.user.findUnique({
    where: { id: identity.authUserId },
    select: ownerBootstrapSelect,
  })

  if (existingUser) return existingOwnerResult(existingUser)

  try {
    return await prisma.$transaction(async (transaction) => {
      const concurrentExistingUser = await transaction.user.findUnique({
        where: { id: identity.authUserId },
        select: ownerBootstrapSelect,
      })

      if (concurrentExistingUser) {
        return existingOwnerResult(concurrentExistingUser)
      }

      const account = await transaction.account.create({
        data: {
          name: input.accountName,
          baseCurrency: input.baseCurrency,
          status: AccountStatus.PENDING,
          reviewedAt: null,
          reviewedById: null,
          rejectionReason: null,
        },
        select: {
          id: true,
          name: true,
          status: true,
          baseCurrency: true,
        },
      })

      const user = await transaction.user.create({
        data: {
          id: identity.authUserId,
          email: identity.verifiedEmail,
          firstName: input.firstName,
          lastName: input.lastName,
          employeeCode: input.employeeCode,
          role: UserRole.OWNER,
          accountId: account.id,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          employeeCode: true,
        },
      })

      const data: OwnerBootstrapData = { user, account }
      return { created: true, data }
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const winningUser = await prisma.user.findUnique({
        where: { id: identity.authUserId },
        select: ownerBootstrapSelect,
      })

      if (winningUser) return existingOwnerResult(winningUser)

      throw new HttpError(
        409,
        'EMAIL_ALREADY_PROVISIONED',
        'Verified email is already associated with another application user',
      )
    }

    throw error
  }
}

export function createAuthDependencies(
  prisma: PrismaClient,
  verifier: SupabaseClient,
  reportVerificationFailure: AuthVerificationFailureReporter =
    reportAuthVerificationFailure,
): AuthDependencies {
  return {
    async verifyAccessToken(accessToken) {
      try {
        const {
          data: { user },
          error,
        } = await verifier.auth.getUser(accessToken)

        if (error || !user) {
          safelyReportAuthVerificationFailure(
            error ?? { code: 'AUTH_USER_MISSING' },
            reportVerificationFailure,
          )
          return null
        }

        return {
          id: user.id,
          email: user.email ?? null,
          emailConfirmedAt: user.email_confirmed_at ?? null,
          isAnonymous: user.is_anonymous === true,
        }
      } catch (error) {
        safelyReportAuthVerificationFailure(error, reportVerificationFailure)
        return null
      }
    },

    findApplicationUser(userId) {
      return prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          accountId: true,
          isActive: true,
        },
      })
    },

    findAccountById(accountId) {
      return prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true, status: true },
      })
    },

    findCurrentUser(userId) {
      return prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          employeeCode: true,
          isActive: true,
          account: {
            select: {
              id: true,
              name: true,
              status: true,
              rejectionReason: true,
            },
          },
        },
      })
    },

    bootstrapOwner(identity, input) {
      return bootstrapOwner(prisma, identity, input)
    },
  }
}
