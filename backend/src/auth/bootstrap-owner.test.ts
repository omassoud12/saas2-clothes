import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { createBootstrapOwner, createGetCurrentUser } from './auth.controller.js'
import {
  createRequireAuth,
  createRequireTenant,
  createRequireVerifiedIdentity,
} from './auth.middleware.js'
import { parseOwnerBootstrapInput } from './auth.schemas.js'
import { createAuthDependencies } from './auth.service.js'
import type {
  AuthDependencies,
  VerifiedIdentityContext,
} from './auth.types.js'

const authUserId = '11111111-1111-4111-8111-111111111111'
const verifiedEmail = 'owner@example.com'

interface TestAccount {
  id: string
  name: string
  status: AccountStatus
  baseCurrency: string
  reviewedAt: Date | null
  reviewedById: string | null
  rejectionReason: string | null
}

interface TestUser {
  id: string
  email: string
  firstName: string
  lastName: string
  employeeCode: string | null
  role: UserRole
  accountId: string | null
  isActive: boolean
}

interface TestState {
  accounts: Map<string, TestAccount>
  users: Map<string, TestUser>
}

class TransactionalPrismaDouble {
  private state: TestState = { accounts: new Map(), users: new Map() }
  private transactionTail: Promise<void> = Promise.resolve()
  private accountSequence = 0
  failUserCreate = false

  get accountCount(): number {
    return this.state.accounts.size
  }

  get userCount(): number {
    return this.state.users.size
  }

  addUser(role: UserRole, accountId: string | null = null): void {
    this.state.users.set(authUserId, {
      id: authUserId,
      email: verifiedEmail,
      firstName: 'Existing',
      lastName: 'User',
      employeeCode: role === UserRole.WAREHOUSE ? 'WH-1' : null,
      role,
      accountId,
      isActive: true,
    })
  }

  asClient(): PrismaClient {
    return this.createClient(this.state) as unknown as PrismaClient
  }

  private getUser(state: TestState, id: string) {
    const user = state.users.get(id)
    if (!user) return null

    return {
      ...user,
      account: user.accountId ? (state.accounts.get(user.accountId) ?? null) : null,
    }
  }

  private createClient(state: TestState) {
    return {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          this.getUser(state, where.id),
        create: async ({ data }: { data: TestUser }) => {
          if (this.failUserCreate) throw new Error('Simulated User failure')
          if (state.users.has(data.id)) throw new Error('Duplicate User')
          state.users.set(data.id, { ...data })
          return {
            id: data.id,
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            role: data.role,
            employeeCode: data.employeeCode,
          }
        },
      },
      account: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const account = state.accounts.get(where.id)
          return account ? { ...account } : null
        },
        create: async ({ data }: { data: Omit<TestAccount, 'id'> }) => {
          this.accountSequence += 1
          const account = { id: `account-${this.accountSequence}`, ...data }
          state.accounts.set(account.id, account)
          return {
            id: account.id,
            name: account.name,
            status: account.status,
            baseCurrency: account.baseCurrency,
          }
        },
      },
      $transaction: async <T>(
        operation: (transaction: unknown) => Promise<T>,
      ): Promise<T> => {
        let releaseTransaction!: () => void
        const previousTransaction = this.transactionTail
        this.transactionTail = new Promise<void>((resolve) => {
          releaseTransaction = resolve
        })
        await previousTransaction

        const draft: TestState = {
          accounts: new Map(
            [...this.state.accounts].map(([id, account]) => [
              id,
              { ...account },
            ]),
          ),
          users: new Map(
            [...this.state.users].map(([id, user]) => [id, { ...user }]),
          ),
        }

        try {
          const result = await operation(this.createClient(draft))
          this.state.accounts = draft.accounts
          this.state.users = draft.users
          return result
        } finally {
          releaseTransaction()
        }
      },
    }
  }
}

function createVerifier(options?: {
  anonymous?: boolean
  confirmed?: boolean
  invalid?: boolean
  email?: string
}): SupabaseClient {
  return {
    auth: {
      async getUser() {
        if (options?.invalid) {
          return { data: { user: null }, error: new Error('Invalid token') }
        }

        return {
          data: {
            user: {
              id: authUserId,
              email: options?.email ?? verifiedEmail,
              email_confirmed_at:
                options?.confirmed === false
                  ? null
                  : '2026-09-12T00:00:00.000Z',
              is_anonymous: options?.anonymous === true,
            },
          },
          error: null,
        }
      },
    },
  } as unknown as SupabaseClient
}

function createRequest(options?: {
  authorization?: string
  body?: unknown
}): Request {
  const authorization = options?.authorization
  return {
    headers: authorization ? { authorization } : {},
    rawHeaders: authorization ? ['Authorization', authorization] : [],
    body: options?.body ?? {},
    query: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request
}

function createResponse(capture: (status: number, body: unknown) => void): Response {
  let statusCode = 200
  const response = {
    status(status: number) {
      statusCode = status
      return response
    },
    json(body: unknown) {
      capture(statusCode, body)
      return response
    },
  }
  return response as unknown as Response
}

async function invoke(
  handler: RequestHandler,
  request: Request,
  response: Response = {} as Response,
): Promise<unknown> {
  let nextError: unknown
  const next: NextFunction = (error?: unknown) => {
    nextError = error
  }
  await handler(request, response, next)
  return nextError
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: ' Store ',
    lastName: ' Owner ',
    accountName: ' Example Store ',
    baseCurrency: 'usd',
    ...overrides,
  }
}

function assertHttpError(error: unknown, status: number, code: string): void {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
}

async function verifyIdentity(
  dependencies: AuthDependencies,
  request: Request,
): Promise<void> {
  const error = await invoke(createRequireVerifiedIdentity(dependencies), request)
  assert.equal(error, undefined)
  assert.ok(request.verifiedIdentity)
}

describe('bootstrap verified identity', () => {
  for (const testCase of [
    {
      name: 'missing Bearer token',
      request: createRequest(),
      verifier: createVerifier(),
      code: 'AUTHORIZATION_REQUIRED',
      status: 401,
    },
    {
      name: 'invalid token',
      request: createRequest({ authorization: 'Bearer invalid' }),
      verifier: createVerifier({ invalid: true }),
      code: 'INVALID_ACCESS_TOKEN',
      status: 401,
    },
    {
      name: 'anonymous identity',
      request: createRequest({ authorization: 'Bearer token' }),
      verifier: createVerifier({ anonymous: true }),
      code: 'ANONYMOUS_IDENTITY_FORBIDDEN',
      status: 403,
    },
    {
      name: 'unconfirmed identity',
      request: createRequest({ authorization: 'Bearer token' }),
      verifier: createVerifier({ confirmed: false }),
      code: 'EMAIL_NOT_CONFIRMED',
      status: 403,
    },
  ]) {
    test(`rejects ${testCase.name}`, async () => {
      const store = new TransactionalPrismaDouble()
      const dependencies = createAuthDependencies(store.asClient(), testCase.verifier)
      const error = await invoke(
        createRequireVerifiedIdentity(dependencies),
        testCase.request,
      )
      assertHttpError(error, testCase.status, testCase.code)
    })
  }
})

describe('bootstrap request validation', () => {
  for (const [name, body] of [
    ['missing firstName', validBody({ firstName: undefined })],
    ['blank lastName', validBody({ lastName: '   ' })],
    ['blank accountName', validBody({ accountName: '   ' })],
    ['unsupported currency', validBody({ baseCurrency: 'EUR' })],
    ['malformed employeeCode', validBody({ employeeCode: 'bad code!' })],
  ] as const) {
    test(`rejects ${name}`, () => {
      assert.throws(() => parseOwnerBootstrapInput(body), HttpError)
    })
  }

  for (const privilegedField of [
    'role',
    'accountId',
    'status',
    'email',
    'userId',
    'id',
    'isActive',
    'reviewedAt',
    'reviewedById',
    'rejectionReason',
  ]) {
    test(`rejects privileged field ${privilegedField}`, () => {
      assert.throws(
        () =>
          parseOwnerBootstrapInput(
            validBody({ [privilegedField]: 'attacker-controlled' }),
          ),
        HttpError,
      )
    })
  }
})

describe('OWNER bootstrap service', () => {
  test('creates a PENDING OWNER using verified identity fields', async () => {
    const store = new TransactionalPrismaDouble()
    const dependencies = createAuthDependencies(
      store.asClient(),
      createVerifier({ email: 'OWNER@EXAMPLE.COM' }),
    )
    const request = createRequest({
      authorization: 'Bearer token',
      body: validBody(),
    })
    await verifyIdentity(dependencies, request)

    let responseStatus = 0
    let responseBody: unknown
    const error = await invoke(
      createBootstrapOwner(dependencies),
      request,
      createResponse((status, body) => {
        responseStatus = status
        responseBody = body
      }),
    )

    assert.equal(error, undefined)
    assert.equal(responseStatus, 201)
    assert.equal(store.accountCount, 1)
    assert.equal(store.userCount, 1)
    assert.deepEqual(responseBody, {
      user: {
        id: authUserId,
        email: verifiedEmail,
        firstName: 'Store',
        lastName: 'Owner',
        role: UserRole.OWNER,
        employeeCode: null,
      },
      account: {
        id: 'account-1',
        name: 'Example Store',
        status: AccountStatus.PENDING,
        baseCurrency: 'USD',
      },
    })
  })

  for (const currency of ['USD', 'LBP']) {
    test(`accepts ${currency}`, () => {
      assert.equal(
        parseOwnerBootstrapInput(validBody({ baseCurrency: currency }))
          .baseCurrency,
        currency,
      )
    })
  }

  test('canonicalizes an optional OWNER employee code', () => {
    assert.equal(
      parseOwnerBootstrapInput(validBody({ employeeCode: ' own-1 ' }))
        .employeeCode,
      'OWN-1',
    )
  })

  test('returns the same Account on an idempotent retry', async () => {
    const store = new TransactionalPrismaDouble()
    const dependencies = createAuthDependencies(store.asClient(), createVerifier())
    const identity: VerifiedIdentityContext = {
      authUserId,
      verifiedEmail,
    }
    const input = parseOwnerBootstrapInput(validBody())

    const first = await dependencies.bootstrapOwner(identity, input)
    const retry = await dependencies.bootstrapOwner(identity, input)

    assert.equal(first.created, true)
    assert.equal(retry.created, false)
    assert.equal(first.data.account.id, retry.data.account.id)
    assert.equal(store.accountCount, 1)
    assert.equal(store.userCount, 1)
  })

  test('returns HTTP 200 for an idempotent endpoint retry', async () => {
    const store = new TransactionalPrismaDouble()
    const dependencies = createAuthDependencies(store.asClient(), createVerifier())
    const input = parseOwnerBootstrapInput(validBody())
    await dependencies.bootstrapOwner({ authUserId, verifiedEmail }, input)

    const request = createRequest({ body: validBody() })
    request.verifiedIdentity = Object.freeze({ authUserId, verifiedEmail })
    let responseStatus = 0
    const error = await invoke(
      createBootstrapOwner(dependencies),
      request,
      createResponse((status) => {
        responseStatus = status
      }),
    )

    assert.equal(error, undefined)
    assert.equal(responseStatus, 200)
    assert.equal(store.accountCount, 1)
  })

  for (const role of [UserRole.WAREHOUSE, UserRole.SUPER_ADMIN]) {
    test(`returns 409 for an existing ${role} UUID`, async () => {
      const store = new TransactionalPrismaDouble()
      store.addUser(role)
      const dependencies = createAuthDependencies(store.asClient(), createVerifier())

      await assert.rejects(
        dependencies.bootstrapOwner(
          { authUserId, verifiedEmail },
          parseOwnerBootstrapInput(validBody()),
        ),
        (error: unknown) => {
          assertHttpError(error, 409, 'AUTH_IDENTITY_ALREADY_PROVISIONED')
          return true
        },
      )
    })
  }

  test('returns an integrity error for an OWNER with a missing Account', async () => {
    const store = new TransactionalPrismaDouble()
    store.addUser(UserRole.OWNER, 'missing-account')
    const dependencies = createAuthDependencies(store.asClient(), createVerifier())

    await assert.rejects(
      dependencies.bootstrapOwner(
        { authUserId, verifiedEmail },
        parseOwnerBootstrapInput(validBody()),
      ),
      (error: unknown) => {
        assertHttpError(error, 500, 'OWNER_ACCOUNT_INTEGRITY_ERROR')
        return true
      },
    )
    assert.equal(store.accountCount, 0)
  })

  test('rolls back Account creation when User creation fails', async () => {
    const store = new TransactionalPrismaDouble()
    store.failUserCreate = true
    const dependencies = createAuthDependencies(store.asClient(), createVerifier())

    await assert.rejects(
      dependencies.bootstrapOwner(
        { authUserId, verifiedEmail },
        parseOwnerBootstrapInput(validBody()),
      ),
      /Simulated User failure/,
    )
    assert.equal(store.accountCount, 0)
    assert.equal(store.userCount, 0)
  })

  test('serializes concurrent same-identity bootstrap to one pair', async () => {
    const store = new TransactionalPrismaDouble()
    const dependencies = createAuthDependencies(store.asClient(), createVerifier())
    const identity = { authUserId, verifiedEmail }
    const input = parseOwnerBootstrapInput(validBody())

    const results = await Promise.all([
      dependencies.bootstrapOwner(identity, input),
      dependencies.bootstrapOwner(identity, input),
    ])

    assert.equal(results.filter((result) => result.created).length, 1)
    assert.equal(new Set(results.map((result) => result.data.account.id)).size, 1)
    assert.equal(store.accountCount, 1)
    assert.equal(store.userCount, 1)
  })

  test('keeps Step 8A behavior for a bootstrapped PENDING OWNER', async () => {
    const store = new TransactionalPrismaDouble()
    const dependencies = createAuthDependencies(store.asClient(), createVerifier())
    await dependencies.bootstrapOwner(
      { authUserId, verifiedEmail },
      parseOwnerBootstrapInput(validBody()),
    )

    const request = createRequest({ authorization: 'Bearer token' })
    assert.equal(await invoke(createRequireAuth(dependencies), request), undefined)
    assert.equal(request.auth?.role, UserRole.OWNER)

    let meBody: unknown
    assert.equal(
      await invoke(
        createGetCurrentUser(dependencies),
        request,
        createResponse((_status, body) => {
          meBody = body
        }),
      ),
      undefined,
    )
    assert.equal(
      (meBody as { account: { status: AccountStatus } }).account.status,
      AccountStatus.PENDING,
    )

    const tenantError = await invoke(createRequireTenant(dependencies), request)
    assertHttpError(tenantError, 403, 'ACCOUNT_PENDING')
  })
})
