import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { createExpenseRouter } from './expense.routes.js'
import {
  encodeExpenseCursor,
  parseExpenseHistoryQuery,
  parseExpenseInput,
} from './expense.schemas.js'
import { createExpenseDependencies } from './expense.service.js'
import type { ExpenseDependencies } from './expense.types.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const ownerA = '33333333-3333-4333-8333-333333333333'
const ownerB = '44444444-4444-4444-8444-444444444444'
const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
type Row = Record<string, any>

function expectHttp(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  return true
}

class ExpenseStore {
  readonly accounts = new Map<string, { id: string; baseCurrency: string; status: AccountStatus }>([
    [accountA, { id: accountA, baseCurrency: 'USD', status: AccountStatus.ACTIVE }],
    [accountB, { id: accountB, baseCurrency: 'LBP', status: AccountStatus.ACTIVE }],
  ])
  readonly users = new Map<string, { id: string; accountId: string; role: UserRole; isActive: boolean }>([
    [ownerA, { id: ownerA, accountId: accountA, role: UserRole.OWNER, isActive: true }],
    [ownerB, { id: ownerB, accountId: accountB, role: UserRole.OWNER, isActive: true }],
  ])
  readonly rows: Row[] = []
  readonly locks: string[] = []
  transactionCount = 0
  listQueries = 0
  createFailure = false
  listFailure = false

  add(row: Partial<Row> & { id: string; accountId: string; expenseDate: Date }): void {
    this.rows.push({
      amount: new Prisma.Decimal('10.00'),
      currency: 'USD',
      description: 'Stored expense',
      createdById: ownerA,
      createdAt: new Date('2026-09-24T12:00:00.000Z'),
      ...row,
    })
  }

  asClient(): PrismaClient {
    const store = this
    const client: Row = {
      async $queryRaw(sql: Prisma.Sql) {
        const text = sql.sql
        const id = sql.values[0] as string
        if (text.includes('FROM "Account"')) {
          store.locks.push('Account')
          const account = store.accounts.get(id)
          return account ? [account] : []
        }
        if (text.includes('FROM "User"')) {
          store.locks.push('User')
          const accountId = sql.values[1] as string
          const user = store.users.get(id)
          return user?.accountId === accountId ? [user] : []
        }
        throw new Error('Unexpected lock query')
      },
      expense: {
        async create({ data }: Row) {
          if (store.createFailure) throw new Error('sensitive SQL failure')
          store.locks.push('Expense')
          const row = {
            id: randomUUID(),
            ...data,
            createdAt: new Date('2026-09-24T12:00:00.000Z'),
          }
          store.rows.push(row)
          return row
        },
        async findMany({ where, take }: Row) {
          if (store.listFailure) throw new Error('sensitive SQL failure')
          store.listQueries += 1
          let rows = store.rows.filter((row) => row.accountId === where.accountId)
          if (where.expenseDate?.gte) {
            rows = rows.filter((row) => row.expenseDate >= where.expenseDate.gte)
          }
          if (where.expenseDate?.lte) {
            rows = rows.filter((row) => row.expenseDate <= where.expenseDate.lte)
          }
          if (where.OR) {
            const cursorDate = where.OR[0].expenseDate.lt as Date
            const cursorId = where.OR[1].id.lt as string
            rows = rows.filter((row) => row.expenseDate < cursorDate ||
              (row.expenseDate.getTime() === cursorDate.getTime() && row.id < cursorId))
          }
          return rows.sort((left, right) =>
            right.expenseDate.getTime() - left.expenseDate.getTime() || right.id.localeCompare(left.id))
            .slice(0, take)
        },
      },
    }
    client.$transaction = async (callback: (transaction: PrismaClient) => Promise<unknown>) => {
      store.transactionCount += 1
      return callback(client as PrismaClient)
    }
    return client as PrismaClient
  }
}

describe('Expense input and history validation', () => {
  test('normalizes valid Decimal strings without JavaScript number authority', () => {
    for (const [input, expected] of [['10', '10.00'], ['10.5', '10.50'], ['10.50', '10.50'], ['0.01', '0.01']]) {
      assert.equal(parseExpenseInput({ amount: input, description: 'Rent', expenseDate: '2026-09-24' }).amount, expected)
    }
    assert.equal(parseExpenseInput({ amount: '9999999999999999.99', description: 'Rent', expenseDate: '2026-09-24' }).amount, '9999999999999999.99')
  })

  test('rejects invalid amounts and numeric(18,2) overflow', () => {
    for (const amount of [0, '0', '0.00', '-1.00', '1.001', '1e3', '1,000.00', '', '   ', '10000000000000000']) {
      assert.throws(
        () => parseExpenseInput({ amount, description: 'Rent', expenseDate: '2026-09-24' }),
        (error) => expectHttp(error, 422, 'INVALID_EXPENSE_AMOUNT'),
      )
    }
  })

  test('NFC-normalizes and trims descriptions with exact character bounds', () => {
    const normalized = parseExpenseInput({ amount: '1', description: '  Cafe\u0301  ', expenseDate: '2026-09-24' })
    assert.equal(normalized.description, 'Café')
    assert.equal(parseExpenseInput({ amount: '1', description: 'x'.repeat(2000), expenseDate: '2026-09-24' }).description.length, 2000)
    for (const description of ['', '   ', 'x'.repeat(2001)]) {
      assert.throws(
        () => parseExpenseInput({ amount: '1', description, expenseDate: '2026-09-24' }),
        (error) => expectHttp(error, 422, 'INVALID_EXPENSE_DESCRIPTION'),
      )
    }
  })

  test('accepts exact calendar dates and rejects timestamps or impossible dates', () => {
    for (const expenseDate of ['2026-02-28', '2024-02-29']) {
      assert.equal(parseExpenseInput({ amount: '1', description: 'Rent', expenseDate }).expenseDate.toISOString().slice(0, 10), expenseDate)
    }
    for (const expenseDate of ['2023-02-29', '2026-02-30', '2026-13-01', '2026-09-24T00:00:00Z', '2026-09-24+03:00']) {
      assert.throws(
        () => parseExpenseInput({ amount: '1', description: 'Rent', expenseDate }),
        (error) => expectHttp(error, 422, 'INVALID_EXPENSE_DATE'),
      )
    }
  })

  test('rejects missing, unknown, and privileged create fields', () => {
    const base = { amount: '1.00', description: 'Rent', expenseDate: '2026-09-24' }
    for (const field of ['id', 'accountId', 'createdById', 'currency', 'category', 'note', 'occurredAt', 'createdAt', 'updatedAt', 'unknown']) {
      assert.throws(() => parseExpenseInput({ ...base, [field]: 'forbidden' }), (error) => expectHttp(error, 422, 'INVALID_EXPENSE_INPUT'))
    }
    assert.throws(() => parseExpenseInput({ amount: '1.00', description: 'Rent' }), (error) => expectHttp(error, 422, 'INVALID_EXPENSE_INPUT'))
  })

  test('validates bounded date/id cursors and inclusive date filters', () => {
    assert.equal(parseExpenseHistoryQuery({}).limit, 25)
    assert.equal(parseExpenseHistoryQuery({ limit: '100' }).limit, 100)
    for (const query of [{ limit: '101' }, { limit: '0' }, { cursor: 'bad!' }, { category: 'Rent' }, { accountId: accountA }]) {
      assert.throws(() => parseExpenseHistoryQuery(query), (error) => expectHttp(error, 422, 'INVALID_EXPENSE_FILTER'))
    }
    assert.throws(() => parseExpenseHistoryQuery({ from: '2026-09-25', to: '2026-09-24' }), (error) => expectHttp(error, 422, 'INVALID_EXPENSE_FILTER'))
    assert.throws(() => parseExpenseHistoryQuery({ from: '2026-02-30' }), (error) => expectHttp(error, 422, 'INVALID_EXPENSE_FILTER'))
    const cursor = encodeExpenseCursor(date('2026-09-24'), ownerA)
    assert.deepEqual(parseExpenseHistoryQuery({ cursor }).cursor, { expenseDate: date('2026-09-24'), id: ownerA })
  })
})

describe('Expense service', () => {
  test('locks Account then active OWNER and inserts only trusted normalized values', async () => {
    const store = new ExpenseStore()
    const service = createExpenseDependencies(store.asClient())
    const result = await service.createExpense(accountA, ownerA, parseExpenseInput({
      amount: '10.5', description: '  Internet  ', expenseDate: '2026-09-24',
    }))
    assert.deepEqual(store.locks, ['Account', 'User', 'Expense'])
    assert.equal(store.transactionCount, 1)
    assert.equal(store.rows[0]?.accountId, accountA)
    assert.equal(store.rows[0]?.createdById, ownerA)
    assert.equal(store.rows[0]?.currency, 'USD')
    assert.equal(result.expense.amount, '10.50')
    assert.equal(result.expense.description, 'Internet')
    assert.equal(result.expense.expenseDate, '2026-09-24')
    assert.deepEqual(Object.keys(result.expense).sort(), ['amount', 'createdAt', 'createdById', 'currency', 'description', 'expenseDate', 'id'].sort())
  })

  test('rejects missing, inactive, non-OWNER, and cross-tenant actors before insert', async () => {
    for (const mutate of [
      (store: ExpenseStore) => store.users.delete(ownerA),
      (store: ExpenseStore) => { store.users.get(ownerA)!.isActive = false },
      (store: ExpenseStore) => { store.users.get(ownerA)!.role = UserRole.WAREHOUSE },
      (store: ExpenseStore) => { store.users.get(ownerA)!.accountId = accountB },
    ]) {
      const store = new ExpenseStore(); mutate(store)
      await assert.rejects(
        createExpenseDependencies(store.asClient()).createExpense(accountA, ownerA, {
          amount: '1.00', description: 'Rent', expenseDate: date('2026-09-24'),
        }),
        (error) => expectHttp(error, 403, 'EXPENSE_CREATOR_UNAVAILABLE'),
      )
      assert.equal(store.rows.length, 0)
    }
  })

  test('rechecks that the tenant Account is active while holding its transaction lock', async () => {
    const store = new ExpenseStore()
    store.accounts.get(accountA)!.status = AccountStatus.SUSPENDED

    await assert.rejects(
      createExpenseDependencies(store.asClient()).createExpense(accountA, ownerA, {
        amount: '1.00', description: 'Rent', expenseDate: date('2026-09-24'),
      }),
      (error) => expectHttp(error, 409, 'EXPENSE_ACCOUNT_UNAVAILABLE'),
    )

    assert.deepEqual(store.locks, ['Account'])
    assert.equal(store.rows.length, 0)
  })

  test('lists one bounded tenant query using stored currency and exact Decimal serialization', async () => {
    const store = new ExpenseStore()
    store.add({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', accountId: accountA, expenseDate: date('2026-09-24'), amount: new Prisma.Decimal('10.5'), currency: 'USD' })
    store.add({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', accountId: accountA, expenseDate: date('2026-09-24'), amount: new Prisma.Decimal('20'), currency: 'USD' })
    store.add({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', accountId: accountA, expenseDate: date('2026-09-23'), amount: new Prisma.Decimal('30.00'), currency: 'USD' })
    store.add({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', accountId: accountB, expenseDate: date('2026-09-25'), amount: new Prisma.Decimal('99.00'), currency: 'LBP', createdById: ownerB })
    const service = createExpenseDependencies(store.asClient())
    const first = await service.listExpenses(accountA, { limit: 2 })
    assert.deepEqual(first.expenses.map((row) => row.id), ['ffffffff-ffff-4fff-8fff-ffffffffffff', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'])
    assert.deepEqual(first.expenses.map((row) => row.amount), ['10.50', '20.00'])
    assert.ok(first.nextCursor)
    store.accounts.get(accountA)!.baseCurrency = 'LBP'
    const second = await service.listExpenses(accountA, parseExpenseHistoryQuery({ limit: '2', cursor: first.nextCursor }))
    assert.deepEqual(second.expenses.map((row) => row.id), ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'])
    assert.equal(second.expenses[0]?.currency, 'USD')
    assert.equal(second.nextCursor, null)
    assert.equal(store.listQueries, 2)
  })

  test('returns an empty page and applies inclusive from/to filters without timezone shifts', async () => {
    const store = new ExpenseStore()
    const service = createExpenseDependencies(store.asClient())
    assert.deepEqual(await service.listExpenses(accountA, { limit: 25 }), { expenses: [], nextCursor: null })
    store.add({ id: randomUUID(), accountId: accountA, expenseDate: date('2026-09-23') })
    store.add({ id: randomUUID(), accountId: accountA, expenseDate: date('2026-09-24') })
    store.add({ id: randomUUID(), accountId: accountA, expenseDate: date('2026-09-25') })
    const oneDay = await service.listExpenses(accountA, parseExpenseHistoryQuery({ from: '2026-09-24', to: '2026-09-24' }))
    assert.deepEqual(oneDay.expenses.map((row) => row.expenseDate), ['2026-09-24'])
    const from = await service.listExpenses(accountA, parseExpenseHistoryQuery({ from: '2026-09-24' }))
    assert.deepEqual(from.expenses.map((row) => row.expenseDate), ['2026-09-25', '2026-09-24'])
    const to = await service.listExpenses(accountA, parseExpenseHistoryQuery({ to: '2026-09-24' }))
    assert.deepEqual(to.expenses.map((row) => row.expenseDate), ['2026-09-24', '2026-09-23'])
  })

  test('applies the default page of 25 without duplicates or skips', async () => {
    const store = new ExpenseStore()
    for (let index = 1; index <= 26; index += 1) {
      store.add({
        id: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
        accountId: accountA,
        expenseDate: date('2026-09-24'),
      })
    }
    const service = createExpenseDependencies(store.asClient())
    const first = await service.listExpenses(accountA, parseExpenseHistoryQuery({}))
    assert.equal(first.expenses.length, 25)
    assert.ok(first.nextCursor)
    const second = await service.listExpenses(accountA, parseExpenseHistoryQuery({ cursor: first.nextCursor }))
    assert.equal(second.expenses.length, 1)
    assert.equal(second.nextCursor, null)
    const ids = [...first.expenses, ...second.expenses].map((row) => row.id)
    assert.equal(new Set(ids).size, 26)
  })

  test('maps unexpected create/list failures to safe application errors', async () => {
    const createStore = new ExpenseStore(); createStore.createFailure = true
    await assert.rejects(
      createExpenseDependencies(createStore.asClient()).createExpense(accountA, ownerA, { amount: '1.00', description: 'Rent', expenseDate: date('2026-09-24') }),
      (error) => expectHttp(error, 503, 'EXPENSE_CREATE_UNAVAILABLE'),
    )
    const listStore = new ExpenseStore(); listStore.listFailure = true
    await assert.rejects(
      createExpenseDependencies(listStore.asClient()).listExpenses(accountA, { limit: 25 }),
      (error) => expectHttp(error, 503, 'EXPENSE_HISTORY_UNAVAILABLE'),
    )
  })
})

function auth(role: UserRole, options: { active?: boolean; status?: AccountStatus } = {}): AuthDependencies {
  return {
    async verifyAccessToken() {
      return { id: ownerA, email: 'owner@example.com', emailConfirmedAt: new Date().toISOString(), isAnonymous: false }
    },
    async findApplicationUser() {
      return { id: ownerA, role, accountId: role === UserRole.SUPER_ADMIN ? null : accountA, isActive: options.active ?? true }
    },
    async findAccountById() { return { id: accountA, status: options.status ?? AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw new Error('unused') },
  }
}

const routeDependencies: ExpenseDependencies = {
  async createExpense(accountId, createdById, input) {
    return { expense: {
      id: randomUUID(), amount: input.amount, currency: 'USD',
      description: input.description, expenseDate: input.expenseDate.toISOString().slice(0, 10),
      createdById, createdAt: new Date('2026-09-24T12:00:00.000Z'),
    } }
  },
  async listExpenses() { return { expenses: [], nextCursor: null } },
}

async function request(
  role: UserRole,
  method: string,
  path: string,
  body?: unknown,
  options: { authorization?: boolean; active?: boolean; status?: AccountStatus } = {},
) {
  const app = express()
  app.use(express.json())
  app.use('/api/expenses', createExpenseRouter(auth(role, options), routeDependencies))
  app.use(errorHandler)
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(options.authorization === false ? {} : { Authorization: 'Bearer token' }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('Expense routes', () => {
  test('allows active OWNER create/list and returns the safe 201 shape', async () => {
    const create = await request(UserRole.OWNER, 'POST', '/api/expenses', {
      amount: '10.5', description: '  Rent  ', expenseDate: '2026-09-24',
    })
    assert.equal(create.status, 201)
    const json = await create.json() as Row
    assert.equal(json.expense.amount, '10.50')
    assert.equal(json.expense.description, 'Rent')
    assert.equal(json.expense.createdById, ownerA)
    assert.equal(Object.hasOwn(json.expense, 'accountId'), false)
    assert.equal(Object.hasOwn(json.expense, 'updatedAt'), false)
    assert.equal((await request(UserRole.OWNER, 'GET', '/api/expenses')).status, 200)
  })

  test('rejects WAREHOUSE, SUPER_ADMIN, unauthenticated, inactive, and inactive-tenant access', async () => {
    assert.equal((await request(UserRole.WAREHOUSE, 'GET', '/api/expenses')).status, 403)
    assert.equal((await request(UserRole.SUPER_ADMIN, 'POST', '/api/expenses', { amount: '1', description: 'Rent', expenseDate: '2026-09-24' })).status, 403)
    assert.equal((await request(UserRole.OWNER, 'GET', '/api/expenses', undefined, { authorization: false })).status, 401)
    assert.equal((await request(UserRole.OWNER, 'GET', '/api/expenses', undefined, { active: false })).status, 403)
    assert.equal((await request(UserRole.OWNER, 'GET', '/api/expenses', undefined, { status: AccountStatus.SUSPENDED })).status, 403)
  })

  test('exposes no PATCH, PUT, or DELETE Expense route', async () => {
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      assert.equal((await request(UserRole.OWNER, method, `/api/expenses/${randomUUID()}`, {})).status, 404)
    }
  })
})
