import type { RequestHandler } from 'express'
import { AccountStatus } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import type { AuthDependencies } from './auth.types.js'

export function createGetCurrentUser(
  dependencies: AuthDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      if (!request.auth) {
        throw new HttpError(
          401,
          'AUTHENTICATION_REQUIRED',
          'Authentication is required',
        )
      }

      const profile = await dependencies.findCurrentUser(request.auth.userId)

      if (!profile) {
        throw new HttpError(
          403,
          'APPLICATION_USER_NOT_FOUND',
          'Application user has not been provisioned',
        )
      }

      const account = profile.account
        ? {
            id: profile.account.id,
            name: profile.account.name,
            status: profile.account.status,
            ...(profile.account.status === AccountStatus.REJECTED
              ? { rejectionReason: profile.account.rejectionReason }
              : {}),
          }
        : null

      response.json({
        user: {
          id: profile.id,
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          role: profile.role,
          employeeCode: profile.employeeCode,
          isActive: profile.isActive,
        },
        account,
      })
    } catch (error) {
      next(error)
    }
  }
}
