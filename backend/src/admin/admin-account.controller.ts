import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'
import {
  assertEmptyReviewBody,
  parseAccountId,
  parseRejectionReason,
} from './admin-account.schemas.js'
import type { AdminAccountDependencies } from './admin-account.types.js'

function requireReviewerId(auth: Express.Request['auth']): string {
  if (!auth) {
    throw new HttpError(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication is required',
    )
  }

  return auth.userId
}

export function createListPendingAccounts(
  dependencies: AdminAccountDependencies,
): RequestHandler {
  return async (_request, response, next) => {
    try {
      const accounts = await dependencies.listPendingAccounts()
      response.json({ accounts })
    } catch (error) {
      next(error)
    }
  }
}

export function createApproveAccount(
  dependencies: AdminAccountDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      assertEmptyReviewBody(request.body)
      const accountId = parseAccountId(request.params.accountId)
      const account = await dependencies.approveAccount(
        accountId,
        requireReviewerId(request.auth),
      )
      response.json({ account })
    } catch (error) {
      next(error)
    }
  }
}

export function createRejectAccount(
  dependencies: AdminAccountDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const accountId = parseAccountId(request.params.accountId)
      const reason = parseRejectionReason(request.body)
      const account = await dependencies.rejectAccount(
        accountId,
        requireReviewerId(request.auth),
        reason,
      )
      response.json({ account })
    } catch (error) {
      next(error)
    }
  }
}

export function createSuspendAccount(
  dependencies: AdminAccountDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      assertEmptyReviewBody(request.body)
      const accountId = parseAccountId(request.params.accountId)
      const account = await dependencies.suspendAccount(accountId)
      response.json({ account })
    } catch (error) {
      next(error)
    }
  }
}
