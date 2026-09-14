import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import {
  createRequireAuth,
  createRequireTenant,
  requireRole,
} from './auth.middleware.js'
import {
  createAuthDependencies,
  type AuthVerificationFailure,
} from './auth.service.js'
import type { AuthDependencies } from './auth.types.js'

const userId = '11111111-1111-4111-8111-111111111111'
const accountId = '22222222-2222-4222-8222-222222222222'

function createDependencies(
  overrides: Partial<AuthDependencies> = {},
): AuthDependencies {
  return {
    async verifyAccessToken() {
      return {
        id: userId,
        email: 'owner@example.com',
        emailConfirmedAt: '2026-09-12T00:00:00.000Z',
        isAnonymous: false,
      }
    },
    async findApplicationUser() {
      return {
        id: userId,
        role: UserRole.OWNER,
        accountId,
        isActive: true,
      }
    },
    async findAccountById() {
      return { id: accountId, status: AccountStatus.ACTIVE }
    },
    async findCurrentUser() {
      return null
    },
    async bootstrapOwner() {
      throw new Error('Not implemented in middleware tests')
    },
    ...overrides,
  }
}

function createRequest(
  authorization?: string,
  authorizationHeaderCount = authorization ? 1 : 0,
): Request {
  const rawHeaders = Array.from(
    { length: authorizationHeaderCount },
    () => ['Authorization', authorization ?? ''],
  ).flat()

  return {
    headers: authorization ? { authorization } : {},
    rawHeaders,
    body: {},
    query: {},
  } as unknown as Request
}

async function invoke(
  handler: RequestHandler,
  request: Request,
): Promise<unknown> {
  let nextError: unknown
  const next: NextFunction = (error?: unknown) => {
    nextError = error
  }

  await handler(request, {} as Response, next)
  return nextError
}

function assertHttpError(
  error: unknown,
  status: number,
  code: string,
): void {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
}

function createVerifier(
  getUser: (accessToken: string) => Promise<unknown>,
): SupabaseClient {
  return {
    auth: { getUser },
  } as unknown as SupabaseClient
}

describe('Supabase access-token verification', () => {
  test('passes the request bearer token to getUser and continues to application User lookup', async () => {
    let receivedAccessToken: string | undefined
    let applicationLookupUserId: string | undefined
    const verifier = createVerifier(async (accessToken) => {
      receivedAccessToken = accessToken
      return {
        data: {
          user: {
            id: userId,
            email: 'owner@example.com',
            email_confirmed_at: '2026-09-12T00:00:00.000Z',
            is_anonymous: false,
          },
        },
        error: null,
      }
    })
    const prisma = {
      user: {
        async findUnique(query: { where: { id: string } }) {
          applicationLookupUserId = query.where.id
          return {
            id: userId,
            role: UserRole.OWNER,
            accountId,
            isActive: true,
          }
        },
      },
    } as unknown as PrismaClient
    const failures: AuthVerificationFailure[] = []
    const dependencies = createAuthDependencies(
      prisma,
      verifier,
      (failure) => failures.push(failure),
    )
    const request = createRequest('Bearer request-user-jwt')

    const error = await invoke(createRequireAuth(dependencies), request)

    assert.equal(error, undefined)
    assert.equal(receivedAccessToken, 'request-user-jwt')
    assert.equal(applicationLookupUserId, userId)
    assert.deepEqual(request.auth, {
      userId,
      role: UserRole.OWNER,
      accountId,
    })
    assert.deepEqual(failures, [])
  })

  test('reports only safe provider status and code for an invalid token', async () => {
    const verifier = createVerifier(async () => ({
      data: { user: null },
      error: {
        status: 403,
        code: 'bad_jwt',
        message: 'sensitive provider detail containing a token',
      },
    }))
    const failures: AuthVerificationFailure[] = []
    const dependencies = createAuthDependencies(
      {} as PrismaClient,
      verifier,
      (failure) => failures.push(failure),
    )

    const identity = await dependencies.verifyAccessToken('invalid-token')

    assert.equal(identity, null)
    assert.deepEqual(failures, [{ status: 403, code: 'bad_jwt' }])
    assert.equal(JSON.stringify(failures).includes('sensitive'), false)
    assert.equal(JSON.stringify(failures).includes('invalid-token'), false)
  })

  test('preserves a safe provider code that distinguishes key misconfiguration', async () => {
    const verifier = createVerifier(async () => ({
      data: { user: null },
      error: {
        status: 401,
        code: 'invalid_api_key',
        message: 'sensitive provider configuration detail',
      },
    }))
    const failures: AuthVerificationFailure[] = []
    const dependencies = createAuthDependencies(
      {} as PrismaClient,
      verifier,
      (failure) => failures.push(failure),
    )

    const identity = await dependencies.verifyAccessToken('invalid-token')

    assert.equal(identity, null)
    assert.deepEqual(failures, [{ status: 401, code: 'invalid_api_key' }])
    assert.equal(JSON.stringify(failures).includes('configuration'), false)
  })

  test('sanitizes a thrown provider error without leaking its details', async () => {
    const verifier = createVerifier(async () => {
      throw Object.assign(new Error('sensitive network detail'), {
        status: 503,
        code: 'provider_unavailable',
      })
    })
    const failures: AuthVerificationFailure[] = []
    const dependencies = createAuthDependencies(
      {} as PrismaClient,
      verifier,
      (failure) => failures.push(failure),
    )

    const identity = await dependencies.verifyAccessToken('invalid-token')

    assert.equal(identity, null)
    assert.deepEqual(failures, [
      { status: 503, code: 'provider_unavailable' },
    ])
    assert.equal(JSON.stringify(failures).includes('network'), false)
    assert.equal(JSON.stringify(failures).includes('invalid-token'), false)
  })
})

describe('requireAuth', () => {
  test('rejects a missing Authorization header', async () => {
    const error = await invoke(
      createRequireAuth(createDependencies()),
      createRequest(),
    )
    assertHttpError(error, 401, 'AUTHORIZATION_REQUIRED')
  })

  test('rejects duplicate Authorization headers', async () => {
    const error = await invoke(
      createRequireAuth(createDependencies()),
      createRequest('Bearer token', 2),
    )
    assertHttpError(error, 401, 'AUTHORIZATION_MALFORMED')
  })

  test('rejects malformed Authorization headers', async () => {
    const error = await invoke(
      createRequireAuth(createDependencies()),
      createRequest('Bearer token extra'),
    )
    assertHttpError(error, 401, 'AUTHORIZATION_MALFORMED')
  })

  test('rejects a non-Bearer header', async () => {
    const error = await invoke(
      createRequireAuth(createDependencies()),
      createRequest('Basic credentials'),
    )
    assertHttpError(error, 401, 'AUTHORIZATION_MALFORMED')
  })

  test('rejects an invalid token', async () => {
    const dependencies = createDependencies({
      async verifyAccessToken() {
        return null
      },
    })
    const error = await invoke(
      createRequireAuth(dependencies),
      createRequest('Bearer invalid'),
    )
    assertHttpError(error, 401, 'INVALID_ACCESS_TOKEN')
  })

  test('rejects an expired or otherwise invalid identity', async () => {
    const dependencies = createDependencies({
      async verifyAccessToken() {
        return null
      },
    })
    const error = await invoke(
      createRequireAuth(dependencies),
      createRequest('Bearer expired'),
    )
    assertHttpError(error, 401, 'INVALID_ACCESS_TOKEN')
  })

  test('rejects an anonymous identity', async () => {
    const dependencies = createDependencies({
      async verifyAccessToken() {
        return {
          id: userId,
          email: null,
          emailConfirmedAt: null,
          isAnonymous: true,
        }
      },
    })
    const error = await invoke(
      createRequireAuth(dependencies),
      createRequest('Bearer token'),
    )
    assertHttpError(error, 403, 'ANONYMOUS_IDENTITY_FORBIDDEN')
  })

  test('rejects an unconfirmed email identity', async () => {
    const dependencies = createDependencies({
      async verifyAccessToken() {
        return {
          id: userId,
          email: 'owner@example.com',
          emailConfirmedAt: null,
          isAnonymous: false,
        }
      },
    })
    const error = await invoke(
      createRequireAuth(dependencies),
      createRequest('Bearer token'),
    )
    assertHttpError(error, 403, 'EMAIL_NOT_CONFIRMED')
  })

  test('rejects an Auth UUID with no application User', async () => {
    const dependencies = createDependencies({
      async findApplicationUser() {
        return null
      },
    })
    const error = await invoke(
      createRequireAuth(dependencies),
      createRequest('Bearer token'),
    )
    assertHttpError(error, 403, 'APPLICATION_USER_NOT_FOUND')
  })

  test('rejects an inactive application User', async () => {
    const dependencies = createDependencies({
      async findApplicationUser() {
        return {
          id: userId,
          role: UserRole.OWNER,
          accountId,
          isActive: false,
        }
      },
    })
    const error = await invoke(
      createRequireAuth(dependencies),
      createRequest('Bearer token'),
    )
    assertHttpError(error, 403, 'USER_INACTIVE')
  })

  for (const [role, resolvedAccountId] of [
    [UserRole.OWNER, accountId],
    [UserRole.WAREHOUSE, accountId],
    [UserRole.SUPER_ADMIN, null],
  ] as const) {
    test(`attaches immutable database identity for ${role}`, async () => {
      const dependencies = createDependencies({
        async findApplicationUser() {
          return {
            id: userId,
            role,
            accountId: resolvedAccountId,
            isActive: true,
          }
        },
      })
      const request = createRequest('Bearer token')
      const error = await invoke(createRequireAuth(dependencies), request)

      assert.equal(error, undefined)
      assert.deepEqual(request.auth, {
        userId,
        role,
        accountId: resolvedAccountId,
      })
      assert.equal(Object.isFrozen(request.auth), true)
    })
  }
})

describe('requireRole', () => {
  test('allows an included role', async () => {
    const request = createRequest()
    request.auth = Object.freeze({
      userId,
      role: UserRole.OWNER,
      accountId,
    })

    const error = await invoke(requireRole(UserRole.OWNER), request)
    assert.equal(error, undefined)
  })

  test('denies a role that is not included', async () => {
    const request = createRequest()
    request.auth = Object.freeze({
      userId,
      role: UserRole.WAREHOUSE,
      accountId,
    })

    const error = await invoke(requireRole(UserRole.OWNER), request)
    assertHttpError(error, 403, 'ROLE_FORBIDDEN')
  })
})

describe('requireTenant', () => {
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
    test(`allows an ACTIVE ${role}`, async () => {
      const request = createRequest()
      request.auth = Object.freeze({ userId, role, accountId })

      const error = await invoke(
        createRequireTenant(createDependencies()),
        request,
      )

      assert.equal(error, undefined)
      assert.equal(request.auth?.accountStatus, AccountStatus.ACTIVE)
      assert.equal(Object.isFrozen(request.auth), true)
    })
  }

  for (const [status, code] of [
    [AccountStatus.PENDING, 'ACCOUNT_PENDING'],
    [AccountStatus.REJECTED, 'ACCOUNT_REJECTED'],
    [AccountStatus.SUSPENDED, 'ACCOUNT_SUSPENDED'],
  ] as const) {
    test(`rejects a ${status} Account`, async () => {
      const dependencies = createDependencies({
        async findAccountById() {
          return { id: accountId, status }
        },
      })
      const request = createRequest()
      request.auth = Object.freeze({
        userId,
        role: UserRole.OWNER,
        accountId,
      })

      const error = await invoke(createRequireTenant(dependencies), request)
      assertHttpError(error, 403, code)
    })
  }

  test('rejects SUPER_ADMIN from tenant access', async () => {
    const request = createRequest()
    request.auth = Object.freeze({
      userId,
      role: UserRole.SUPER_ADMIN,
      accountId: null,
    })

    const error = await invoke(
      createRequireTenant(createDependencies()),
      request,
    )
    assertHttpError(error, 403, 'TENANT_ACCESS_REQUIRED')
  })

  test('rejects a missing Account', async () => {
    const dependencies = createDependencies({
      async findAccountById() {
        return null
      },
    })
    const request = createRequest()
    request.auth = Object.freeze({
      userId,
      role: UserRole.OWNER,
      accountId,
    })

    const error = await invoke(createRequireTenant(dependencies), request)
    assertHttpError(error, 403, 'ACCOUNT_NOT_FOUND')
  })
})
