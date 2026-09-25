import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { createGetCurrentUser } from './auth.controller.js'
import { createRequireAuth } from './auth.middleware.js'
import type {
  AuthDependencies,
  CurrentUserProfile,
} from './auth.types.js'

const userId = '11111111-1111-4111-8111-111111111111'
const accountId = '22222222-2222-4222-8222-222222222222'

function createProfile(
  status: AccountStatus,
  role: UserRole = UserRole.OWNER,
  baseCurrency = 'USD',
): CurrentUserProfile {
  return {
    id: userId,
    email: 'owner@example.com',
    firstName: 'Store',
    lastName: 'Owner',
    role,
    employeeCode: null,
    isActive: true,
    account: {
      id: accountId,
      name: 'Example Store',
      status,
      baseCurrency,
      rejectionReason:
        status === AccountStatus.REJECTED ? 'Information is incomplete' : null,
    },
  }
}

function createDependencies(
  profile: CurrentUserProfile,
  onProfileLookup?: (resolvedUserId: string) => void,
): AuthDependencies {
  return {
    async verifyAccessToken() {
      return {
        id: userId,
        email: profile.email,
        emailConfirmedAt: '2026-09-12T00:00:00.000Z',
        isAnonymous: false,
      }
    },
    async findApplicationUser() {
      return {
        id: profile.id,
        role: profile.role,
        accountId: profile.account?.id ?? null,
        isActive: profile.isActive,
      }
    },
    async findAccountById() {
      return null
    },
    async findCurrentUser(resolvedUserId) {
      onProfileLookup?.(resolvedUserId)
      return profile
    },
    async bootstrapOwner() {
      throw new Error('Not implemented in /me tests')
    },
  }
}

function createRequest(): Request {
  return {
    headers: { authorization: 'Bearer token' },
    rawHeaders: ['Authorization', 'Bearer token'],
    body: {},
    query: {},
  } as unknown as Request
}

function createResponse(capture: (body: unknown) => void): Response {
  const response = {
    json(body: unknown) {
      capture(body)
      return response
    },
  }
  return response as unknown as Response
}

async function invoke(
  handler: RequestHandler,
  request: Request,
  response: Response,
): Promise<unknown> {
  let nextError: unknown
  const next: NextFunction = (error?: unknown) => {
    nextError = error
  }

  await handler(request, response, next)
  return nextError
}

async function invokeMe(
  dependencies: AuthDependencies,
  request: Request,
): Promise<unknown> {
  let body: unknown
  const response = createResponse((value) => {
    body = value
  })

  const authError = await invoke(
    createRequireAuth(dependencies),
    request,
    response,
  )
  assert.equal(authError, undefined)

  const controllerError = await invoke(
    createGetCurrentUser(dependencies),
    request,
    response,
  )
  assert.equal(controllerError, undefined)

  return body
}

describe('GET /api/auth/me response', () => {
  test('allows a PENDING OWNER without requireTenant', async () => {
    const body = (await invokeMe(
      createDependencies(createProfile(AccountStatus.PENDING)),
      createRequest(),
    )) as Record<string, Record<string, unknown>>

    assert.equal(body.account.status, AccountStatus.PENDING)
    assert.equal(body.account.baseCurrency, 'USD')
    assert.equal('rejectionReason' in body.account, false)
  })

  test('returns a safe rejection reason for a REJECTED OWNER', async () => {
    const body = (await invokeMe(
      createDependencies(createProfile(AccountStatus.REJECTED)),
      createRequest(),
    )) as Record<string, Record<string, unknown>>

    assert.deepEqual(body.account, {
      id: accountId,
      name: 'Example Store',
      status: AccountStatus.REJECTED,
      baseCurrency: 'USD',
      rejectionReason: 'Information is incomplete',
    })
    assert.equal('reviewedById' in body.account, false)
  })

  test('returns account null for SUPER_ADMIN', async () => {
    const profile: CurrentUserProfile = {
      ...createProfile(AccountStatus.ACTIVE),
      role: UserRole.SUPER_ADMIN,
      account: null,
    }
    const body = (await invokeMe(
      createDependencies(profile),
      createRequest(),
    )) as Record<string, unknown>

    assert.equal(body.account, null)
  })

  for (const [role, baseCurrency] of [
    [UserRole.OWNER, 'LBP'],
    [UserRole.WAREHOUSE, 'EUR'],
  ] as const) {
    test(`returns the authenticated Account baseCurrency for ${role}`, async () => {
      const body = (await invokeMe(
        createDependencies(
          createProfile(AccountStatus.ACTIVE, role, baseCurrency),
        ),
        createRequest(),
      )) as Record<string, Record<string, unknown>>

      assert.equal(body.account.id, accountId)
      assert.equal(body.account.baseCurrency, baseCurrency)
      assert.equal(body.user.role, role)
      for (const sensitiveField of [
        'purchaseCost',
        'lastPurchaseCost',
        'cogs',
        'profit',
        'expenses',
        'financialReport',
      ]) {
        assert.equal(sensitiveField in body.account, false)
      }
    })
  }

  test('ignores frontend accountId and resolves identity by verified Auth UUID', async () => {
    let lookedUpUserId: string | undefined
    const request = createRequest()
    request.body = { accountId: 'attacker-account' }
    request.query = { accountId: 'attacker-account' }

    const body = (await invokeMe(
      createDependencies(
        createProfile(AccountStatus.ACTIVE, UserRole.OWNER, 'LBP'),
        (resolvedId) => {
          lookedUpUserId = resolvedId
        },
      ),
      request,
    )) as Record<string, Record<string, unknown>>

    assert.equal(lookedUpUserId, userId)
    assert.equal(request.auth?.accountId, accountId)
    assert.equal(body.account.id, accountId)
    assert.equal(body.account.baseCurrency, 'LBP')
  })
})
