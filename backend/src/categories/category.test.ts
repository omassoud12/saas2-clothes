import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import { createRequireAuth, createRequireTenant } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { createCreateCategory } from './category.controller.js'
import { createCategoryRouter } from './category.routes.js'
import {
  CATEGORY_NAME_MAX_LENGTH,
  parseCategoryInput,
} from './category.schemas.js'
import { createCategoryDependencies } from './category.service.js'
import type {
  CategoryDependencies,
  CategoryRecord,
} from './category.types.js'

const userId = '11111111-1111-4111-8111-111111111111'
const accountA = '22222222-2222-4222-8222-222222222222'
const accountB = '33333333-3333-4333-8333-333333333333'
const categoryA = '44444444-4444-4444-8444-444444444444'
const categoryB = '55555555-5555-4555-8555-555555555555'
const missingCategory = '66666666-6666-4666-8666-666666666666'
const initialDate = new Date('2026-09-15T08:00:00.000Z')

interface TestCategory extends CategoryRecord {
  accountId: string
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('database detail', {
    code,
    clientVersion: 'test',
  })
}

class PrismaDouble {
  readonly categories = new Map<string, TestCategory>()
  readonly productCategoryIds = new Set<string>()
  nextId = 1

  addCategory(id: string, accountId: string, name: string): void {
    this.categories.set(id, {
      id,
      accountId,
      name,
      createdAt: initialDate,
      updatedAt: initialDate,
    })
  }

  addProduct(categoryId: string): void {
    this.productCategoryIds.add(categoryId)
  }

  private safeCategory(value: TestCategory): CategoryRecord {
    return {
      id: value.id,
      name: value.name,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    }
  }

  asClient(): PrismaClient {
    return {
      category: {
        findMany: async ({ where }: { where: { accountId: string } }) =>
          [...this.categories.values()]
            .filter((value) => value.accountId === where.accountId)
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((value) => this.safeCategory(value)),
        create: async ({
          data,
        }: {
          data: { accountId: string; name: string }
        }) => {
          if (
            [...this.categories.values()].some(
              (value) =>
                value.accountId === data.accountId && value.name === data.name,
            )
          ) {
            throw prismaError('P2002')
          }

          const suffix = String(this.nextId++).padStart(12, '0')
          const id = `77777777-7777-4777-8777-${suffix}`
          this.addCategory(id, data.accountId, data.name)
          return this.safeCategory(this.categories.get(id)!)
        },
        update: async ({
          where,
          data,
        }: {
          where: { id_accountId: { id: string; accountId: string } }
          data: { name: string }
        }) => {
          const { id, accountId } = where.id_accountId
          const current = this.categories.get(id)
          if (!current || current.accountId !== accountId) {
            throw prismaError('P2025')
          }
          if (
            [...this.categories.values()].some(
              (value) =>
                value.id !== id &&
                value.accountId === accountId &&
                value.name === data.name,
            )
          ) {
            throw prismaError('P2002')
          }

          const updated = {
            ...current,
            name: data.name,
            updatedAt: new Date('2026-09-15T09:00:00.000Z'),
          }
          this.categories.set(id, updated)
          return this.safeCategory(updated)
        },
        delete: async ({
          where,
        }: {
          where: { id_accountId: { id: string; accountId: string } }
        }) => {
          const { id, accountId } = where.id_accountId
          const current = this.categories.get(id)
          if (!current || current.accountId !== accountId) {
            throw prismaError('P2025')
          }
          if (this.productCategoryIds.has(id)) throw prismaError('P2003')

          this.categories.delete(id)
          return { id }
        },
      },
    } as unknown as PrismaClient
  }
}

function authDependencies(
  role: UserRole,
  status: AccountStatus = AccountStatus.ACTIVE,
): AuthDependencies {
  const accountId = role === UserRole.SUPER_ADMIN ? null : accountA
  return {
    async verifyAccessToken() {
      return {
        id: userId,
        email: 'user@example.com',
        emailConfirmedAt: '2026-09-15T00:00:00.000Z',
        isAnonymous: false,
      }
    },
    async findApplicationUser() {
      return { id: userId, role, accountId, isActive: true }
    },
    async findAccountById() {
      return { id: accountA, status }
    },
    async findCurrentUser() {
      return null
    },
    async bootstrapOwner() {
      throw new Error('Not implemented in Category tests')
    },
  }
}

function request(options: {
  authorization?: boolean
  body?: unknown
  auth?: Express.Request['auth']
} = {}): Request {
  const authorization = options.authorization === false ? undefined : 'Bearer token'
  return {
    headers: authorization ? { authorization } : {},
    rawHeaders: authorization ? ['Authorization', authorization] : [],
    params: {},
    query: {},
    body: options.body ?? {},
    auth: options.auth,
  } as unknown as Request
}

async function invoke(
  handler: RequestHandler,
  request_: Request,
  response_: Response = {} as Response,
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
  assert.doesNotMatch(error.message, /prisma|constraint|database detail/i)
}

async function authorize(
  role: UserRole,
  status: AccountStatus = AccountStatus.ACTIVE,
  hasAuthorization = true,
) {
  const dependencies = authDependencies(role, status)
  const request_ = request({ authorization: hasAuthorization })
  const authenticationError = await invoke(
    createRequireAuth(dependencies),
    request_,
  )
  if (authenticationError) return { request: request_, error: authenticationError }

  return {
    request: request_,
    error: await invoke(createRequireTenant(dependencies), request_),
  }
}

describe('Category authorization', () => {
  test('rejects unauthenticated requests', async () => {
    const result = await authorize(UserRole.OWNER, AccountStatus.ACTIVE, false)
    assertHttpError(result.error, 401, 'AUTHORIZATION_REQUIRED')
  })

  test('rejects SUPER_ADMIN from tenant Categories', async () => {
    const result = await authorize(UserRole.SUPER_ADMIN)
    assertHttpError(result.error, 403, 'TENANT_ACCESS_REQUIRED')
  })

  test('rejects a PENDING tenant', async () => {
    const result = await authorize(UserRole.OWNER, AccountStatus.PENDING)
    assertHttpError(result.error, 403, 'ACCOUNT_PENDING')
  })

  for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
    test(`allows an ACTIVE ${role}`, async () => {
      const result = await authorize(role)
      assert.equal(result.error, undefined)
      assert.equal(result.request.auth?.accountId, accountA)
      assert.equal(result.request.auth?.accountStatus, AccountStatus.ACTIVE)
    })
  }
})

describe('Category routes', () => {
  test('mounts list, create, update, and delete behind tenant middleware', async () => {
    const calls: string[] = []
    const record: CategoryRecord = {
      id: categoryA,
      name: 'Shirts',
      createdAt: initialDate,
      updatedAt: initialDate,
    }
    const categories: CategoryDependencies = {
      async listCategories(receivedAccountId) {
        calls.push(`list:${receivedAccountId}`)
        return [record]
      },
      async createCategory(receivedAccountId, input) {
        calls.push(`create:${receivedAccountId}:${input.name}`)
        return { ...record, name: input.name }
      },
      async updateCategory(receivedAccountId, receivedCategoryId, input) {
        calls.push(
          `update:${receivedAccountId}:${receivedCategoryId}:${input.name}`,
        )
        return { ...record, name: input.name }
      },
      async deleteCategory(receivedAccountId, receivedCategoryId) {
        calls.push(`delete:${receivedAccountId}:${receivedCategoryId}`)
      },
    }
    const app = express()
    app.use(express.json())
    app.use(
      '/api/categories',
      createCategoryRouter(authDependencies(UserRole.OWNER), categories),
    )
    app.use(errorHandler)
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, '127.0.0.1', () =>
        resolve(listeningServer),
      )
    })

    try {
      const { port } = server.address() as AddressInfo
      const baseUrl = `http://127.0.0.1:${port}/api/categories`
      const headers = { Authorization: 'Bearer token' }
      const responses = await Promise.all([
        fetch(baseUrl, { headers }),
        fetch(baseUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Dresses' }),
        }),
        fetch(`${baseUrl}/${categoryA}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Tops' }),
        }),
        fetch(`${baseUrl}/${categoryA}`, { method: 'DELETE', headers }),
      ])

      assert.deepEqual(
        responses.map(({ status }) => status),
        [200, 201, 200, 204],
      )
      assert.deepEqual(calls.sort(), [
        `create:${accountA}:Dresses`,
        `delete:${accountA}:${categoryA}`,
        `list:${accountA}`,
        `update:${accountA}:${categoryA}:Tops`,
      ])
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})

describe('Category listing and creation', () => {
  test('returns only the authenticated tenant Categories in name order', async () => {
    const store = new PrismaDouble()
    store.addCategory(categoryA, accountA, 'Shirts')
    store.addCategory(categoryB, accountA, 'Accessories')
    store.addCategory(missingCategory, accountB, 'Foreign Category')

    const result = await createCategoryDependencies(
      store.asClient(),
    ).listCategories(accountA)

    assert.deepEqual(result.map(({ name }) => name), ['Accessories', 'Shirts'])
    assert.equal(result.some(({ id }) => id === missingCategory), false)
    assert.deepEqual(Object.keys(result[0]).sort(), [
      'createdAt',
      'id',
      'name',
      'updatedAt',
    ])
  })

  test('creates a trimmed Category using only authenticated accountId', async () => {
    const store = new PrismaDouble()
    const input = parseCategoryInput({ name: '  Dresses  ' })
    const result = await createCategoryDependencies(
      store.asClient(),
    ).createCategory(accountA, input)

    assert.equal(result.name, 'Dresses')
    assert.equal([...store.categories.values()][0].accountId, accountA)
  })

  test('controller supplies accountId only from the tenant context', async () => {
    let capturedAccountId: string | undefined
    const dependencies: CategoryDependencies = {
      async listCategories() {
        return []
      },
      async createCategory(accountId, input) {
        capturedAccountId = accountId
        return { id: categoryA, name: input.name, createdAt: initialDate, updatedAt: initialDate }
      },
      async updateCategory() {
        throw new Error('Not used')
      },
      async deleteCategory() {},
    }
    const request_ = request({
      body: { name: 'Shirts' },
      auth: Object.freeze({
        userId,
        role: UserRole.OWNER,
        accountId: accountA,
        accountStatus: AccountStatus.ACTIVE,
      }),
    })
    const response_ = {
      status() {
        return response_
      },
      json() {
        return response_
      },
    } as unknown as Response

    const error = await invoke(
      createCreateCategory(dependencies),
      request_,
      response_,
    )

    assert.equal(error, undefined)
    assert.equal(capturedAccountId, accountA)
  })

  for (const body of [
    { name: '   ' },
    { name: 'x'.repeat(CATEGORY_NAME_MAX_LENGTH + 1) },
    { name: 'Shirts', accountId: accountB },
    { name: 'Shirts', role: UserRole.SUPER_ADMIN },
  ]) {
    test('rejects blank, oversized, or privileged Category input', () => {
      assert.throws(
        () => parseCategoryInput(body),
        (error: unknown) => {
          assertHttpError(error, 422, 'INVALID_CATEGORY_NAME')
          return true
        },
      )
    })
  }

  test('rejects an exact duplicate name in the same tenant', async () => {
    const store = new PrismaDouble()
    store.addCategory(categoryA, accountA, 'Shirts')

    await assert.rejects(
      createCategoryDependencies(store.asClient()).createCategory(accountA, {
        name: 'Shirts',
      }),
      (error: unknown) => {
        assertHttpError(error, 409, 'CATEGORY_ALREADY_EXISTS')
        return true
      },
    )
  })

  test('allows the same name in different tenants', async () => {
    const store = new PrismaDouble()
    store.addCategory(categoryA, accountA, 'Shirts')

    const result = await createCategoryDependencies(
      store.asClient(),
    ).createCategory(accountB, { name: 'Shirts' })

    assert.equal(result.name, 'Shirts')
    assert.equal([...store.categories.values()].at(-1)?.accountId, accountB)
  })
})

describe('Category updates', () => {
  test('updates an authenticated tenant Category', async () => {
    const store = new PrismaDouble()
    store.addCategory(categoryA, accountA, 'Shirts')

    const result = await createCategoryDependencies(
      store.asClient(),
    ).updateCategory(accountA, categoryA, { name: 'Tops' })

    assert.equal(result.name, 'Tops')
    assert.equal(store.categories.get(categoryA)?.name, 'Tops')
  })

  test('does not reveal or update a foreign-tenant Category', async () => {
    const store = new PrismaDouble()
    store.addCategory(categoryB, accountB, 'Foreign')

    await assert.rejects(
      createCategoryDependencies(store.asClient()).updateCategory(
        accountA,
        categoryB,
        { name: 'Changed' },
      ),
      (error: unknown) => {
        assertHttpError(error, 404, 'CATEGORY_NOT_FOUND')
        return true
      },
    )
    assert.equal(store.categories.get(categoryB)?.name, 'Foreign')
  })

  test('returns 404 for a nonexistent Category', async () => {
    const store = new PrismaDouble()
    await assert.rejects(
      createCategoryDependencies(store.asClient()).updateCategory(
        accountA,
        missingCategory,
        { name: 'Missing' },
      ),
      (error: unknown) => {
        assertHttpError(error, 404, 'CATEGORY_NOT_FOUND')
        return true
      },
    )
  })

  test('returns a safe conflict for a duplicate rename', async () => {
    const store = new PrismaDouble()
    store.addCategory(categoryA, accountA, 'Shirts')
    store.addCategory(categoryB, accountA, 'Accessories')

    await assert.rejects(
      createCategoryDependencies(store.asClient()).updateCategory(
        accountA,
        categoryA,
        { name: 'Accessories' },
      ),
      (error: unknown) => {
        assertHttpError(error, 409, 'CATEGORY_ALREADY_EXISTS')
        return true
      },
    )
  })
})

describe('Category deletion', () => {
  test('deletes an unused authenticated tenant Category', async () => {
    const store = new PrismaDouble()
    store.addCategory(categoryA, accountA, 'Shirts')

    await createCategoryDependencies(store.asClient()).deleteCategory(
      accountA,
      categoryA,
    )

    assert.equal(store.categories.has(categoryA), false)
  })

  test('does not reveal or delete a foreign-tenant Category', async () => {
    const store = new PrismaDouble()
    store.addCategory(categoryB, accountB, 'Foreign')

    await assert.rejects(
      createCategoryDependencies(store.asClient()).deleteCategory(
        accountA,
        categoryB,
      ),
      (error: unknown) => {
        assertHttpError(error, 404, 'CATEGORY_NOT_FOUND')
        return true
      },
    )
    assert.equal(store.categories.has(categoryB), true)
  })

  test('returns 404 for a nonexistent Category', async () => {
    const store = new PrismaDouble()
    await assert.rejects(
      createCategoryDependencies(store.asClient()).deleteCategory(
        accountA,
        missingCategory,
      ),
      (error: unknown) => {
        assertHttpError(error, 404, 'CATEGORY_NOT_FOUND')
        return true
      },
    )
  })

  test('does not delete a Category or cascade Products when it is in use', async () => {
    const store = new PrismaDouble()
    store.addCategory(categoryA, accountA, 'Shirts')
    store.addProduct(categoryA)

    await assert.rejects(
      createCategoryDependencies(store.asClient()).deleteCategory(
        accountA,
        categoryA,
      ),
      (error: unknown) => {
        assertHttpError(error, 409, 'CATEGORY_IN_USE')
        return true
      },
    )
    assert.equal(store.categories.has(categoryA), true)
    assert.equal(store.productCategoryIds.has(categoryA), true)
  })
})
