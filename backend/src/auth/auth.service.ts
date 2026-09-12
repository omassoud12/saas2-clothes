import type { SupabaseClient } from '@supabase/supabase-js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { AuthDependencies } from './auth.types.js'

export function createAuthDependencies(
  prisma: PrismaClient,
  verifier: SupabaseClient,
): AuthDependencies {
  return {
    async verifyAccessToken(accessToken) {
      const {
        data: { user },
        error,
      } = await verifier.auth.getUser(accessToken)

      if (error || !user) return null

      return {
        id: user.id,
        email: user.email ?? null,
        emailConfirmedAt: user.email_confirmed_at ?? null,
        isAnonymous: user.is_anonymous === true,
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
  }
}
