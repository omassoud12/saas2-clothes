import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { createApp } from '../app.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { createRequireAuth, requireRole } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import type { CategoryDependencies } from '../categories/category.types.js'
import type { InventoryAuditDependencies } from '../inventory/inventory.types.js'
import type { ProductDependencies } from '../products/product.types.js'
import type { SaleDependencies } from '../sales/sale.types.js'
import {
  createApproveAccount,
  createRejectAccount,
  createSuspendAccount,
} from './admin-account.controller.js'
import {
  assertEmptyReviewBody,
  parseRejectionReason,
} from './admin-account.schemas.js'
import { createAdminAccountDependencies } from './admin-account.service.js'
import type {
  AdminAccountDependencies,
  ReviewedAccount,
} from './admin-account.types.js'

const adminId = '11111111-1111-4111-8111-111111111111'
const otherAdminId = '22222222-2222-4222-8222-222222222222'
const pendingAccountId = '33333333-3333-4333-8333-333333333333'
const secondAccountId = '44444444-4444-4444-8444-444444444444'
const missingAccountId = '55555555-5555-4555-8555-555555555555'
const originalReviewedAt = new Date('2026-09-11T10:00:00.000Z')

interface TestOwner {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  createdAt: Date
}

interface TestAccount {
  id: string
  name: string
  baseCurrency: string
  status: AccountStatus
  createdAt: Date
  reviewedAt: Date | null
  reviewedById: string | null
  rejectionReason: string | null
  users: TestOwner[]
}

function owner(id: string, email = 'owner@example.com'): TestOwner {
  return {
    id,
    email,
    firstName: 'Store',
    lastName: 'Owner',
    role: UserRole.OWNER,
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
  }
}

function account(
  id: string,
  status: AccountStatus,
  createdAt = new Date('2026-09-12T00:00:00.000Z'),
): TestAccount {
  const reviewed = status !== AccountStatus.PENDING
  return {
    id,
    name: `Account ${id.slice(0, 4)}`,
    baseCurrency: 'USD',
    status,
    createdAt,
    reviewedAt: reviewed ? originalReviewedAt : null,
    reviewedById: reviewed ? otherAdminId : null,
    rejectionReason:
      status === AccountStatus.REJECTED ? 'Original rejection' : null,
    users: [owner(`owner-${id}`)],
  }
}

class PrismaDouble {
  readonly accounts = new Map<string, TestAccount>()

  addAccount(value: TestAccount): void {
    this.accounts.set(value.id, value)
  }

  asClient(): PrismaClient {
    return {
      account: {
        findMany: async ({ where }: { where: { status: AccountStatus } }) =>
          [...this.accounts.values()]
            .filter((value) => value.status === where.status)
            .sort((left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime(),
            )
            .map((value) => ({
              id: value.id,
              name: value.name,
              baseCurrency: value.baseCurrency,
              status: value.status,
              createdAt: value.createdAt,
              users: value.users
                .filter((user) => user.role === UserRole.OWNER)
                .sort(
                  (left, right) =>
                    left.createdAt.getTime() - right.createdAt.getTime(),
                )
                .slice(0, 2)
                .map(({ role: _role, createdAt: _createdAt, ...user }) => user),
            })),
        findUnique: async ({ where }: { where: { id: string } }) => {
          const value = this.accounts.get(where.id)
          return value ? { ...value } : null
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; status: AccountStatus }
          data: Partial<TestAccount>
        }) => {
          const current = this.accounts.get(where.id)
          if (!current || current.status !== where.status) return { count: 0 }

          this.accounts.set(where.id, { ...current, ...data })
          return { count: 1 }
        },
      },
    } as unknown as PrismaClient
  }
}

function authDependencies(
  role: UserRole,
  isActive = true,
  accountId: string | null = null,
): AuthDependencies {
  return {
    async verifyAccessToken() {
      return {
        id: adminId,
        email: 'admin@example.com',
        emailConfirmedAt: '2026-09-12T00:00:00.000Z',
        isAnonymous: false,
      }
    },
    async findApplicationUser() {
      return { id: adminId, role, accountId, isActive }
    },
    async findAccountById() {
      return null
    },
    async findCurrentUser() {
      return null
    },
    async bootstrapOwner() {
      throw new Error('Not implemented in admin tests')
    },
  }
}

function request(options: {
  accountId?: string
  body?: unknown
  auth?: Express.Request['auth']
} = {}): Request {
  return {
    headers: { authorization: 'Bearer token' },
    rawHeaders: ['Authorization', 'Bearer token'],
    params: { accountId: options.accountId ?? pendingAccountId },
    body: options.body ?? {},
    query: {},
    auth: options.auth,
  } as unknown as Request
}

function response(capture?: (body: unknown) => void): Response {
  const value = {
    json(body: unknown) {
      capture?.(body)
      return value
    },
  }
  return value as unknown as Response
}

async function invoke(
  handler: RequestHandler,
  request_: Request,
  response_: Response = response(),
): Promise<unknown> {
  let nextError: unknown
  const next: NextFunction = (error?: unknown) => {
    nextError = error
  }
  await handler(request_, response_, next)
  return nextError
}

function assertHttpError(error: unknown, status: number, code: string): void {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
}

async function authorize(
  role: UserRole,
  isActive = true,
  accountId: string | null = null,
): Promise<{ request: Request; error: unknown }> {
  const request_ = request()
  const authenticationError = await invoke(
    createRequireAuth(authDependencies(role, isActive, accountId)),
    request_,
  )
  if (authenticationError) return { request: request_, error: authenticationError }

  return {
    request: request_,
    error: await invoke(requireRole(UserRole.SUPER_ADMIN), request_),
  }
}

describe('admin Account authorization', () => {
  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
    test(`denies ${role}`, async () => {
      const result = await authorize(role, true, pendingAccountId)
      assertHttpError(result.error, 403, 'ROLE_FORBIDDEN')
    })
  }

  test('allows active SUPER_ADMIN without an Account', async () => {
    const result = await authorize(UserRole.SUPER_ADMIN)
    assert.equal(result.error, undefined)
    assert.equal(result.request.auth?.accountId, null)
  })

  test('rejects inactive SUPER_ADMIN in requireAuth', async () => {
    const result = await authorize(UserRole.SUPER_ADMIN, false)
    assertHttpError(result.error, 403, 'USER_INACTIVE')
  })

  test('mounts all review routes for a tenantless SUPER_ADMIN', async () => {
    const reviewedAccount: ReviewedAccount = {
      id: pendingAccountId,
      status: AccountStatus.ACTIVE,
      reviewedAt: new Date('2026-09-12T00:00:00.000Z'),
      reviewedById: adminId,
      rejectionReason: null,
    }
    const calls: string[] = []
    const adminAccounts: AdminAccountDependencies = {
      async listPendingAccounts() {
        calls.push('pending')
        return []
      },
      async approveAccount(_accountId, reviewerId) {
        calls.push(`approve:${reviewerId}`)
        return reviewedAccount
      },
      async rejectAccount(_accountId, reviewerId, reason) {
        calls.push(`reject:${reviewerId}:${reason}`)
        return {
          ...reviewedAccount,
          status: AccountStatus.REJECTED,
          rejectionReason: reason,
        }
      },
      async suspendAccount() {
        calls.push('suspend')
        return { ...reviewedAccount, status: AccountStatus.SUSPENDED }
      },
    }
    const app = createApp({
      auth: authDependencies(UserRole.SUPER_ADMIN),
      adminAccounts,
      products: {} as ProductDependencies,
      inventory: {} as InventoryAuditDependencies,
      sales: {} as SaleDependencies,
      categories: {
        async listCategories() {
          return []
        },
        async createCategory() {
          throw new Error('Not implemented in admin tests')
        },
        async updateCategory() {
          throw new Error('Not implemented in admin tests')
        },
        async deleteCategory() {
          throw new Error('Not implemented in admin tests')
        },
      } satisfies CategoryDependencies,
    })
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, '127.0.0.1', () =>
        resolve(listeningServer),
      )
    })

    try {
      const { port } = server.address() as AddressInfo
      const baseUrl = `http://127.0.0.1:${port}/api/admin/accounts`
      const headers = { Authorization: 'Bearer token' }
      const responses = await Promise.all([
        fetch(`${baseUrl}/pending`, { headers }),
        fetch(`${baseUrl}/${pendingAccountId}/approve`, {
          method: 'PATCH',
          headers,
        }),
        fetch(`${baseUrl}/${pendingAccountId}/reject`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Reason' }),
        }),
        fetch(`${baseUrl}/${pendingAccountId}/suspend`, {
          method: 'PATCH',
          headers,
        }),
      ])

      assert.deepEqual(
        responses.map((value) => value.status),
        [200, 200, 200, 200],
      )
      assert.deepEqual(calls.sort(), [
        `approve:${adminId}`,
        'pending',
        `reject:${adminId}:Reason`,
        'suspend',
      ])
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})

describe('pending Account review list', () => {
  test('returns only PENDING Accounts oldest first with safe OWNER details', async () => {
    const store = new PrismaDouble()
    const newest = account(
      secondAccountId,
      AccountStatus.PENDING,
      new Date('2026-09-12T12:00:00.000Z'),
    )
    const oldest = account(
      pendingAccountId,
      AccountStatus.PENDING,
      new Date('2026-09-11T12:00:00.000Z'),
    )
    oldest.users = [owner('oldest-owner', 'oldest@example.com')]
    store.addAccount(newest)
    store.addAccount(account('active', AccountStatus.ACTIVE))
    store.addAccount(account('rejected', AccountStatus.REJECTED))
    store.addAccount(account('suspended', AccountStatus.SUSPENDED))
    store.addAccount(oldest)

    const result = await createAdminAccountDependencies(
      store.asClient(),
    ).listPendingAccounts()

    assert.equal(result.length, 2)
    assert.deepEqual(
      result.map((entry) => entry.account.id),
      [pendingAccountId, secondAccountId],
    )
    assert.deepEqual(result[0].owner, {
      id: 'oldest-owner',
      email: 'oldest@example.com',
      firstName: 'Store',
      lastName: 'Owner',
    })
    assert.deepEqual(Object.keys(result[0].account).sort(), [
      'baseCurrency',
      'createdAt',
      'id',
      'name',
      'status',
    ])
  })

  test('reports a missing OWNER relationship safely', async () => {
    const store = new PrismaDouble()
    const pending = account(pendingAccountId, AccountStatus.PENDING)
    pending.users = []
    store.addAccount(pending)

    await assert.rejects(
      createAdminAccountDependencies(store.asClient()).listPendingAccounts(),
      (error: unknown) => {
        assertHttpError(error, 500, 'ACCOUNT_OWNER_INTEGRITY_ERROR')
        return true
      },
    )
  })
})

describe('Account approval', () => {
  test('atomically changes PENDING to ACTIVE with authenticated reviewer', async () => {
    const store = new PrismaDouble()
    store.addAccount(account(pendingAccountId, AccountStatus.PENDING))
    const dependencies = createAdminAccountDependencies(store.asClient())

    const result = await dependencies.approveAccount(pendingAccountId, adminId)

    assert.equal(result.status, AccountStatus.ACTIVE)
    assert.ok(result.reviewedAt instanceof Date)
    assert.equal(result.reviewedById, adminId)
    assert.equal(result.rejectionReason, null)
  })

  test('returns 409 on a second approval', async () => {
    const store = new PrismaDouble()
    store.addAccount(account(pendingAccountId, AccountStatus.PENDING))
    const dependencies = createAdminAccountDependencies(store.asClient())
    await dependencies.approveAccount(pendingAccountId, adminId)

    await assert.rejects(
      dependencies.approveAccount(pendingAccountId, adminId),
      (error: unknown) => {
        assertHttpError(error, 409, 'ACCOUNT_ALREADY_REVIEWED')
        return true
      },
    )
  })

  for (const status of [AccountStatus.REJECTED, AccountStatus.SUSPENDED]) {
    test(`returns 409 when approving ${status}`, async () => {
      const store = new PrismaDouble()
      store.addAccount(account(pendingAccountId, status))

      await assert.rejects(
        createAdminAccountDependencies(store.asClient()).approveAccount(
          pendingAccountId,
          adminId,
        ),
        (error: unknown) => {
          assertHttpError(error, 409, 'ACCOUNT_ALREADY_REVIEWED')
          return true
        },
      )
    })
  }

  test('returns 404 for a nonexistent Account', async () => {
    const store = new PrismaDouble()
    await assert.rejects(
      createAdminAccountDependencies(store.asClient()).approveAccount(
        missingAccountId,
        adminId,
      ),
      (error: unknown) => {
        assertHttpError(error, 404, 'ACCOUNT_NOT_FOUND')
        return true
      },
    )
  })
})

describe('Account rejection', () => {
  test('persists a trimmed reason and authenticated reviewer', async () => {
    const store = new PrismaDouble()
    store.addAccount(account(pendingAccountId, AccountStatus.PENDING))
    const dependencies = createAdminAccountDependencies(store.asClient())
    const normalizedReason = parseRejectionReason({ reason: ' Incomplete data ' })

    const result = await dependencies.rejectAccount(
      pendingAccountId,
      adminId,
      normalizedReason,
    )

    assert.equal(result.status, AccountStatus.REJECTED)
    assert.ok(result.reviewedAt instanceof Date)
    assert.equal(result.reviewedById, adminId)
    assert.equal(result.rejectionReason, 'Incomplete data')
  })

  for (const invalidBody of [
    { reason: '   ' },
    { reason: 'x'.repeat(2001) },
  ]) {
    test('rejects an invalid reason', () => {
      assert.throws(
        () => parseRejectionReason(invalidBody),
        (error: unknown) => {
          assertHttpError(error, 422, 'INVALID_REJECTION_REASON')
          return true
        },
      )
    })
  }

  test('returns 409 on a second rejection', async () => {
    const store = new PrismaDouble()
    store.addAccount(account(pendingAccountId, AccountStatus.PENDING))
    const dependencies = createAdminAccountDependencies(store.asClient())
    await dependencies.rejectAccount(pendingAccountId, adminId, 'Reason')

    await assert.rejects(
      dependencies.rejectAccount(pendingAccountId, adminId, 'Reason'),
      (error: unknown) => {
        assertHttpError(error, 409, 'ACCOUNT_ALREADY_REVIEWED')
        return true
      },
    )
  })

  test('allows exactly one concurrent approve/reject winner', async () => {
    const store = new PrismaDouble()
    store.addAccount(account(pendingAccountId, AccountStatus.PENDING))
    const dependencies = createAdminAccountDependencies(store.asClient())

    const outcomes = await Promise.allSettled([
      dependencies.approveAccount(pendingAccountId, adminId),
      dependencies.rejectAccount(pendingAccountId, adminId, 'Reason'),
    ])

    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      1,
    )
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    assert.ok(rejected?.status === 'rejected')
    assertHttpError(rejected.reason, 409, 'ACCOUNT_ALREADY_REVIEWED')
  })
})

describe('Account suspension', () => {
  test('changes ACTIVE to SUSPENDED and preserves original review fields', async () => {
    const store = new PrismaDouble()
    store.addAccount(account(pendingAccountId, AccountStatus.ACTIVE))
    const dependencies = createAdminAccountDependencies(store.asClient())

    const result = await dependencies.suspendAccount(pendingAccountId)

    assert.equal(result.status, AccountStatus.SUSPENDED)
    assert.equal(result.reviewedAt, originalReviewedAt)
    assert.equal(result.reviewedById, otherAdminId)
    assert.equal(result.rejectionReason, null)
  })

  for (const status of [
    AccountStatus.PENDING,
    AccountStatus.REJECTED,
    AccountStatus.SUSPENDED,
  ]) {
    test(`returns 409 when suspending ${status}`, async () => {
      const store = new PrismaDouble()
      store.addAccount(account(pendingAccountId, status))

      await assert.rejects(
        createAdminAccountDependencies(store.asClient()).suspendAccount(
          pendingAccountId,
        ),
        (error: unknown) => {
          assertHttpError(error, 409, 'ACCOUNT_NOT_ACTIVE')
          return true
        },
      )
    })
  }

  test('returns 404 for a nonexistent Account', async () => {
    const store = new PrismaDouble()
    await assert.rejects(
      createAdminAccountDependencies(store.asClient()).suspendAccount(
        missingAccountId,
      ),
      (error: unknown) => {
        assertHttpError(error, 404, 'ACCOUNT_NOT_FOUND')
        return true
      },
    )
  })
})

describe('admin Account request authority', () => {
  const auth = Object.freeze({
    userId: adminId,
    role: UserRole.SUPER_ADMIN,
    accountId: null,
  })

  test('approval body cannot override reviewer or status', async () => {
    const store = new PrismaDouble()
    store.addAccount(account(pendingAccountId, AccountStatus.PENDING))
    const error = await invoke(
      createApproveAccount(createAdminAccountDependencies(store.asClient())),
      request({
        auth,
        body: { reviewedById: otherAdminId, status: AccountStatus.ACTIVE },
      }),
    )

    assertHttpError(error, 400, 'INVALID_REQUEST_BODY')
    assert.equal(store.accounts.get(pendingAccountId)?.status, AccountStatus.PENDING)
  })

  test('rejection reviewer comes only from auth context', async () => {
    const store = new PrismaDouble()
    store.addAccount(account(pendingAccountId, AccountStatus.PENDING))
    let body: unknown
    const error = await invoke(
      createRejectAccount(createAdminAccountDependencies(store.asClient())),
      request({ auth, body: { reason: 'Reason' } }),
      response((value) => {
        body = value
      }),
    )

    assert.equal(error, undefined)
    assert.equal(
      (body as { account: TestAccount }).account.reviewedById,
      adminId,
    )
  })

  test('rejection body cannot override reviewer or status', async () => {
    assert.throws(
      () =>
        parseRejectionReason({
          reason: 'Reason',
          reviewedById: otherAdminId,
          status: AccountStatus.ACTIVE,
        }),
      (error: unknown) => {
        assertHttpError(error, 422, 'INVALID_REJECTION_REASON')
        return true
      },
    )
  })

  test('suspension accepts no arbitrary status fields', async () => {
    assert.throws(
      () => assertEmptyReviewBody({ status: AccountStatus.REJECTED }),
      (error: unknown) => {
        assertHttpError(error, 400, 'INVALID_REQUEST_BODY')
        return true
      },
    )
  })

  test('suspension controller does not use SUPER_ADMIN accountId', async () => {
    const store = new PrismaDouble()
    store.addAccount(account(pendingAccountId, AccountStatus.ACTIVE))
    const error = await invoke(
      createSuspendAccount(createAdminAccountDependencies(store.asClient())),
      request({ auth, accountId: pendingAccountId }),
    )

    assert.equal(error, undefined)
    assert.equal(
      store.accounts.get(pendingAccountId)?.status,
      AccountStatus.SUSPENDED,
    )
  })
})
