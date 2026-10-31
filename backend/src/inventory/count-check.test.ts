import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, InventoryMovementType, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { countNote, createCountCheckDependencies, createCountCheckRouter, parseCountCheckInput, parseCountIdempotencyKey } from './count-check.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const ownerA = '33333333-3333-4333-8333-333333333333'
const warehouseA = '44444444-4444-4444-8444-444444444444'
const variantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const key = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const now = new Date('2026-10-01T00:00:00.000Z')

type Row = Record<string, any>

function expectHttp(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  return true
}

class StockDouble {
  stock = 7
  cost: Prisma.Decimal | null = new Prisma.Decimal('12.5000')
  variantActive = true
  productActive = true
  actorRole: UserRole = UserRole.OWNER
  actorActive = true
  movements: Row[] = []
  locks: string[] = []
  failMovement = false

  asClient(): PrismaClient {
    const store = this
    const client = {
      async $transaction<T>(callback: (transaction: unknown) => Promise<T>): Promise<T> {
        const stock = store.stock; const movements = [...store.movements]
        try { return await callback(client) } catch (error) { store.stock = stock; store.movements = movements; throw error }
      },
      async $queryRaw(sql: Prisma.Sql) {
        const values = sql.values as string[]
        if (sql.sql.includes('FROM "User"')) {
          store.locks.push('User')
          return values[1] === accountA ? [{ id: values[0], role: store.actorRole, isActive: store.actorActive }] : []
        }
        store.locks.push('Variant')
        return values[0] === variantA && values[1] === accountA
          ? [{ id: variantA, productId: 'p', currentStock: store.stock, lastPurchaseCost: store.cost, isActive: store.variantActive, productActive: store.productActive }]
          : []
      },
      inventoryMovement: {
        async findFirst({ where }: Row) { return store.movements.find((row) => row.id === where.id && row.accountId === where.accountId) ?? null },
        async create({ data }: Row) {
          if (store.failMovement) throw new Error('private failure')
          store.movements.push({ ...data }); return { id: data.id }
        },
      },
      productVariant: {
        async updateMany({ where, data }: Row) {
          if (where.id !== variantA || where.accountId !== accountA || store.stock !== where.currentStock) return { count: 0 }
          store.stock = data.currentStock; return { count: 1 }
        },
      },
    }
    return client as unknown as PrismaClient
  }
}

describe('count check input', () => {
  test('needs whole, non-negative counted and expected numbers and nothing else', () => {
    assert.deepEqual(parseCountCheckInput({ countedQuantity: 10, expectedStock: 7 }), { countedQuantity: 10, expectedStock: 7 })
    assert.deepEqual(parseCountCheckInput({ countedQuantity: 0, expectedStock: 0 }), { countedQuantity: 0, expectedStock: 0 })
    for (const bad of [{}, { countedQuantity: 1 }, { expectedStock: 1 }, { countedQuantity: -1, expectedStock: 0 }, { countedQuantity: 1.5, expectedStock: 0 },
      { countedQuantity: '3', expectedStock: 0 }, { countedQuantity: 2147483648, expectedStock: 0 }, { countedQuantity: 1, expectedStock: 0, extra: 1 }, [], null, 'x']) {
      assert.throws(() => parseCountCheckInput(bad), (e) => expectHttp(e, 422, 'INVALID_COUNT_CHECK'))
    }
  })

  test('needs exactly one UUID idempotency key', () => {
    assert.equal(parseCountIdempotencyKey({ 'idempotency-key': key.toUpperCase() }, ['Idempotency-Key', key]), key)
    assert.throws(() => parseCountIdempotencyKey({}, []), (e) => expectHttp(e, 400, 'COUNT_IDEMPOTENCY_KEY_REQUIRED'))
    assert.throws(() => parseCountIdempotencyKey({ 'idempotency-key': 'nope' }, ['Idempotency-Key', 'nope']), (e) => expectHttp(e, 400, 'COUNT_IDEMPOTENCY_KEY_INVALID'))
  })
})

describe('count check service', () => {
  const input = (counted: number, expected = 7) => ({ countedQuantity: counted, expectedStock: expected })

  test('stores one adjustment for the difference and sets the stock to the counted number', async () => {
    const store = new StockDouble()
    const service = createCountCheckDependencies(store.asClient())
    const up = await service.countVariant(accountA, ownerA, variantA, key, input(10))
    assert.deepEqual(up, { count: { variantId: variantA, previousStock: 7, countedQuantity: 10, difference: 3, currentStock: 10 }, idempotentReplay: false })
    assert.equal(store.stock, 10); assert.equal(store.movements.length, 1)
    assert.deepEqual(store.movements[0], { id: key, accountId: accountA, variantId: variantA, type: InventoryMovementType.ADJUSTMENT, quantityChange: 3,
      unitCost: store.movements[0].unitCost, performedById: ownerA, note: 'Count check: expected 7, counted 10.' })
    assert.equal(store.movements[0].unitCost.toFixed(4), '12.5000')
    assert.deepEqual(store.locks, ['User', 'Variant'])

    const down = new StockDouble()
    const removed = await createCountCheckDependencies(down.asClient()).countVariant(accountA, ownerA, variantA, key, input(2))
    assert.equal(removed.count.difference, -5); assert.equal(down.stock, 2); assert.equal(down.movements[0].quantityChange, -5)
    const zero = new StockDouble()
    await createCountCheckDependencies(zero.asClient()).countVariant(accountA, ownerA, variantA, key, input(0))
    assert.equal(zero.stock, 0)
  })

  test('a count that matches the system writes nothing', async () => {
    const store = new StockDouble()
    const result = await createCountCheckDependencies(store.asClient()).countVariant(accountA, ownerA, variantA, key, input(7))
    assert.equal(result.count.difference, 0); assert.equal(store.movements.length, 0); assert.equal(store.stock, 7)
  })

  test('an unknown cost is stored as unknown, never zero', async () => {
    const store = new StockDouble(); store.cost = null
    await createCountCheckDependencies(store.asClient()).countVariant(accountA, ownerA, variantA, key, input(9))
    assert.equal(store.movements[0].unitCost, null)
  })

  test('repeating the same request returns the stored result without a second movement', async () => {
    const store = new StockDouble()
    const service = createCountCheckDependencies(store.asClient())
    await service.countVariant(accountA, ownerA, variantA, key, input(10))
    const replay = await service.countVariant(accountA, ownerA, variantA, key, input(10))
    assert.equal(replay.idempotentReplay, true); assert.equal(replay.count.difference, 3); assert.equal(replay.count.currentStock, 10)
    assert.equal(store.movements.length, 1); assert.equal(store.stock, 10)
    await assert.rejects(service.countVariant(accountA, ownerA, variantA, key, input(11)), (e) => expectHttp(e, 409, 'COUNT_IDEMPOTENCY_CONFLICT'))
    assert.equal(countNote(7, 10), store.movements[0].note)
  })

  test('refuses when the stock changed since the owner looked, and writes nothing', async () => {
    const store = new StockDouble(); store.stock = 8
    await assert.rejects(createCountCheckDependencies(store.asClient()).countVariant(accountA, ownerA, variantA, key, input(10)), (e) => expectHttp(e, 409, 'COUNT_STOCK_CHANGED'))
    assert.equal(store.stock, 8); assert.equal(store.movements.length, 0)
  })

  test('only an active owner may count, only active items can be counted, and variants stay inside the account', async () => {
    for (const mutate of [(s: StockDouble) => { s.actorRole = UserRole.WAREHOUSE }, (s: StockDouble) => { s.actorActive = false }]) {
      const store = new StockDouble(); mutate(store)
      await assert.rejects(createCountCheckDependencies(store.asClient()).countVariant(accountA, ownerA, variantA, key, input(10)), (e) => expectHttp(e, 403, 'COUNT_ACTOR_UNAVAILABLE'))
      assert.equal(store.stock, 7)
    }
    for (const mutate of [(s: StockDouble) => { s.variantActive = false }, (s: StockDouble) => { s.productActive = false }]) {
      const store = new StockDouble(); mutate(store)
      await assert.rejects(createCountCheckDependencies(store.asClient()).countVariant(accountA, ownerA, variantA, key, input(10)), (e) => expectHttp(e, 409, 'COUNT_VARIANT_INACTIVE'))
    }
    await assert.rejects(createCountCheckDependencies(new StockDouble().asClient()).countVariant(accountA, ownerA, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', key, input(10)), (e) => expectHttp(e, 404, 'VARIANT_NOT_FOUND'))
  })

  test('a failure while writing the movement rolls the stock back and hides the cause', async () => {
    const store = new StockDouble(); store.failMovement = true
    await assert.rejects(createCountCheckDependencies(store.asClient()).countVariant(accountA, ownerA, variantA, key, input(10)), (e) => expectHttp(e, 503, 'COUNT_UNAVAILABLE'))
    assert.equal(store.stock, 7); assert.equal(store.movements.length, 0)
  })
})

function auth(role: UserRole): AuthDependencies {
  const userId = role === UserRole.WAREHOUSE ? warehouseA : ownerA
  return {
    async verifyAccessToken() { return { id: userId, email: 'user@example.com', emailConfirmedAt: now.toISOString(), isAnonymous: false } },
    async findApplicationUser() { return { id: userId, role, accountId: role === UserRole.SUPER_ADMIN ? null : accountA, isActive: true } },
    async findAccountById() { return { id: accountA, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null }, async bootstrapOwner() { throw Error('unused') },
  }
}

async function withServer(role: UserRole, store: StockDouble, run: (base: string) => Promise<void>) {
  const app = express(); app.use(express.json())
  app.use('/api/inventory', createCountCheckRouter(auth(role), createCountCheckDependencies(store.asClient())))
  app.use(errorHandler)
  const server = app.listen(0)
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`) }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('count check route', () => {
  const options = (payload: unknown, idempotencyKey: string | null = key) => ({
    method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: JSON.stringify(payload),
  })

  test('201 for a correction, 200 for a repeat or no difference, 422 for bad input, 400 without a key', async () => {
    const store = new StockDouble()
    await withServer(UserRole.OWNER, store, async (base) => {
      const url = `${base}/api/inventory/variants/${variantA}/count-check`
      assert.equal((await fetch(url, options({ countedQuantity: 10, expectedStock: 7 }))).status, 201)
      assert.equal((await fetch(url, options({ countedQuantity: 10, expectedStock: 7 }))).status, 200)
      assert.equal((await fetch(url, options({ countedQuantity: 10, expectedStock: 10 }, 'ffffffff-ffff-4fff-8fff-ffffffffffff'))).status, 200)
      assert.equal((await fetch(url, options({ countedQuantity: -1, expectedStock: 10 }))).status, 422)
      assert.equal((await fetch(url, options({ countedQuantity: 1, expectedStock: 10 }, null))).status, 400)
      assert.equal((await fetch(`${base}/api/inventory/variants/not-a-uuid/count-check`, options({ countedQuantity: 1, expectedStock: 10 }))).status, 422)
    })
    assert.equal(store.movements.length, 1)
  })

  test('a warehouse user and the platform admin are refused', async () => {
    for (const role of [UserRole.WAREHOUSE, UserRole.SUPER_ADMIN]) {
      const store = new StockDouble()
      await withServer(role, store, async (base) => {
        assert.equal((await fetch(`${base}/api/inventory/variants/${variantA}/count-check`, options({ countedQuantity: 10, expectedStock: 7 }))).status, 403)
      })
      assert.equal(store.stock, 7)
    }
  })
})
