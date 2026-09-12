import type { Request, RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import type {
  AuthDependencies,
  VerifiedIdentityContext,
} from './auth.types.js'

function getAuthorizationHeader(request: Request): string {
  let rawAuthorizationCount = 0

  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'authorization') {
      rawAuthorizationCount += 1
    }
  }

  if (rawAuthorizationCount > 1) {
    throw new HttpError(
      401,
      'AUTHORIZATION_MALFORMED',
      'Exactly one Authorization header is required',
    )
  }

  const header = request.headers.authorization

  if (!header) {
    throw new HttpError(
      401,
      'AUTHORIZATION_REQUIRED',
      'Authorization header is required',
    )
  }

  if (Array.isArray(header)) {
    throw new HttpError(
      401,
      'AUTHORIZATION_MALFORMED',
      'Exactly one Authorization header is required',
    )
  }

  return header
}

function getBearerToken(request: Request): string {
  const header = getAuthorizationHeader(request)
  const match = /^Bearer ([^\s,]+)$/i.exec(header)

  if (!match) {
    throw new HttpError(
      401,
      'AUTHORIZATION_MALFORMED',
      'Authorization header must use the Bearer scheme',
    )
  }

  return match[1]
}

export async function resolveVerifiedIdentity(
  request: Request,
  dependencies: AuthDependencies,
): Promise<Readonly<VerifiedIdentityContext>> {
  const accessToken = getBearerToken(request)
  const identity = await dependencies.verifyAccessToken(accessToken)

  if (!identity) {
    throw new HttpError(
      401,
      'INVALID_ACCESS_TOKEN',
      'Access token is invalid or expired',
    )
  }

  if (identity.isAnonymous) {
    throw new HttpError(
      403,
      'ANONYMOUS_IDENTITY_FORBIDDEN',
      'Anonymous identities cannot access this application',
    )
  }

  if (!identity.email || !identity.emailConfirmedAt) {
    throw new HttpError(
      403,
      'EMAIL_NOT_CONFIRMED',
      'A confirmed email address is required',
    )
  }

  const verifiedEmail = identity.email.trim().toLowerCase()

  if (!verifiedEmail) {
    throw new HttpError(
      403,
      'EMAIL_NOT_CONFIRMED',
      'A confirmed email address is required',
    )
  }

  return Object.freeze({
    authUserId: identity.id,
    verifiedEmail,
  })
}

export function createRequireVerifiedIdentity(
  dependencies: AuthDependencies,
): RequestHandler {
  return async (request, _response, next) => {
    try {
      request.verifiedIdentity = await resolveVerifiedIdentity(
        request,
        dependencies,
      )
      next()
    } catch (error) {
      next(error)
    }
  }
}

interface RateLimitEntry {
  count: number
  expiresAt: number
}

function consumeRateLimit(
  entries: Map<string, RateLimitEntry>,
  key: string,
  limit: number,
  now: number,
  windowMs: number,
): boolean {
  const current = entries.get(key)

  if (!current || current.expiresAt <= now) {
    entries.set(key, { count: 1, expiresAt: now + windowMs })
    return true
  }

  if (current.count >= limit) return false

  current.count += 1
  return true
}

export function createBootstrapRateLimit(): RequestHandler {
  const windowMs = 10 * 60 * 1000
  const userEntries = new Map<string, RateLimitEntry>()
  const ipEntries = new Map<string, RateLimitEntry>()

  return (request, _response, next) => {
    const identity = request.verifiedIdentity

    if (!identity) {
      next(
        new HttpError(
          401,
          'AUTHENTICATION_REQUIRED',
          'A verified identity is required',
        ),
      )
      return
    }

    const now = Date.now()

    for (const entries of [userEntries, ipEntries]) {
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(key)
      }
    }

    const userAllowed = consumeRateLimit(
      userEntries,
      identity.authUserId,
      5,
      now,
      windowMs,
    )
    const ipAllowed = consumeRateLimit(
      ipEntries,
      request.ip || request.socket.remoteAddress || 'unknown',
      20,
      now,
      windowMs,
    )

    if (!userAllowed || !ipAllowed) {
      next(
        new HttpError(
          429,
          'BOOTSTRAP_RATE_LIMITED',
          'Too many bootstrap attempts; try again later',
        ),
      )
      return
    }

    next()
  }
}

export function createRequireAuth(
  dependencies: AuthDependencies,
): RequestHandler {
  return async (request, _response, next) => {
    try {
      const identity = await resolveVerifiedIdentity(request, dependencies)

      const applicationUser = await dependencies.findApplicationUser(
        identity.authUserId,
      )

      if (!applicationUser) {
        throw new HttpError(
          403,
          'APPLICATION_USER_NOT_FOUND',
          'Application user has not been provisioned',
        )
      }

      if (!applicationUser.isActive) {
        throw new HttpError(
          403,
          'USER_INACTIVE',
          'Application user is inactive',
        )
      }

      request.auth = Object.freeze({
        userId: applicationUser.id,
        role: applicationUser.role,
        accountId: applicationUser.accountId,
      })

      next()
    } catch (error) {
      next(error)
    }
  }
}

export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  const roles = new Set(allowedRoles)

  return (request, _response, next) => {
    if (!request.auth) {
      next(
        new HttpError(
          401,
          'AUTHENTICATION_REQUIRED',
          'Authentication is required',
        ),
      )
      return
    }

    if (!roles.has(request.auth.role)) {
      next(new HttpError(403, 'ROLE_FORBIDDEN', 'Role is not authorized'))
      return
    }

    next()
  }
}

export function createRequireTenant(
  dependencies: AuthDependencies,
): RequestHandler {
  return async (request, _response, next) => {
    try {
      const auth = request.auth

      if (!auth) {
        throw new HttpError(
          401,
          'AUTHENTICATION_REQUIRED',
          'Authentication is required',
        )
      }

      if (
        (auth.role !== UserRole.OWNER && auth.role !== UserRole.WAREHOUSE) ||
        !auth.accountId
      ) {
        throw new HttpError(
          403,
          'TENANT_ACCESS_REQUIRED',
          'An authenticated tenant user is required',
        )
      }

      const account = await dependencies.findAccountById(auth.accountId)

      if (!account) {
        throw new HttpError(
          403,
          'ACCOUNT_NOT_FOUND',
          'Tenant account does not exist',
        )
      }

      const forbiddenStatusCodes: Partial<Record<AccountStatus, string>> = {
        [AccountStatus.PENDING]: 'ACCOUNT_PENDING',
        [AccountStatus.REJECTED]: 'ACCOUNT_REJECTED',
        [AccountStatus.SUSPENDED]: 'ACCOUNT_SUSPENDED',
      }
      const forbiddenCode = forbiddenStatusCodes[account.status]

      if (forbiddenCode) {
        throw new HttpError(
          403,
          forbiddenCode,
          'Tenant account is not active',
        )
      }

      if (account.status !== AccountStatus.ACTIVE) {
        throw new HttpError(
          403,
          'ACCOUNT_NOT_ACTIVE',
          'Tenant account is not active',
        )
      }

      request.auth = Object.freeze({
        ...auth,
        accountStatus: account.status,
      })

      next()
    } catch (error) {
      next(error)
    }
  }
}
