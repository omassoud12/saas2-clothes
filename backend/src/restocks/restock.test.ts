import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, InventoryMovementType, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { createProductRouter } from '../products/product.routes.js'
import { createProductDependencies } from '../products/product.service.js'
import { parseIdempotencyKey, parseRestockInput, restockFingerprint } from './restock.schemas.js'
import { createRestockDependencies } from './restock.service.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const ownerA = '33333333-3333-4333-8333-333333333333'
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const productA = '44444444-4444-4444-8444-444444444444'
const productB = '55555555-5555-4555-8555-555555555555'
const productOther = '66666666-6666-4666-8666-666666666666'
const variantA = '77777777-7777-4777-8777-777777777777'
const variantB = '88888888-8888-4888-8888-888888888888'
const variantOther = '99999999-9999-4999-8999-999999999999'
const now = new Date('2026-09-17T00:00:00.000Z')

type ProductRow = { id: string; accountId: string; isActive: boolean }
type VariantRow = { id: string; accountId: string; productId: string; isActive: boolean; currentStock: number; lastPurchaseCost: Prisma.Decimal | null }
type MovementRow = {
  id: string; accountId: string; variantId: string; type: InventoryMovementType
  quantityChange: number; unitCost: Prisma.Decimal; performedById: string
  saleItemId: null; returnItemId: null; note: string | null
  idempotencyKey: string; requestFingerprint: string; createdAt: Date
}
type State = { products: Map<string, ProductRow>; variants: Map<string, VariantRow>; movements: MovementRow[] }

function knownError(code: string, target?: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('private database detail', {
    code, clientVersion: 'test', meta: target ? { target } : undefined,
  })
}

function expectHttp(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  assert.doesNotMatch(error.message, /prisma|database detail/i)
  return true
}

class RestockDouble {
  state: State = {
    products: new Map([
      [productA, { id: productA, accountId: accountA, isActive: true }],
      [productB, { id: productB, accountId: accountA, isActive: true }],
      [productOther, { id: productOther, accountId: accountB, isActive: true }],
    ]),
    variants: new Map([
      [variantA, { id: variantA, accountId: accountA, productId: productA, isActive: true, currentStock: 7, lastPurchaseCost: new Prisma.Decimal('9.0000') }],
      [variantB, { id: variantB, accountId: accountA, productId: productB, isActive: true, currentStock: 0, lastPurchaseCost: null }],
      [variantOther, { id: variantOther, accountId: accountB, productId: productOther, isActive: true, currentStock: 0, lastPurchaseCost: null }],
    ]),
    movements: [],
  }
  readonly locks: string[] = []
  readonly updates: unknown[] = []
  failMovementCreate = false
  raceWinner: 'same' | 'different' | null = null
  raceConstraint = 'InventoryMovement_accountId_restock_idempotencyKey_key'
  private tail: Promise<void> = Promise.resolve()

  private snapshot(): State {
    return {
      products: new Map([...this.state.products].map(([key, value]) => [key, { ...value }])),
      variants: new Map([...this.state.variants].map(([key, value]) => [key, { ...value }])),
      movements: [...this.state.movements],
    }
  }

  private client(state: State, transactional: boolean): PrismaClient {
    const store = this
    const current = () => transactional ? state : store.state
    return {
      product: {
        async findUnique({ where }: { where: { id_accountId: { id: string; accountId: string } } }) {
          const row = current().products.get(where.id_accountId.id)
          return row?.accountId === where.id_accountId.accountId ? { id: row.id } : null
        },
      },
      productVariant: {
        async findUnique({ where }: { where: { id_productId_accountId: { id: string; productId: string; accountId: string } } }) {
          const route = where.id_productId_accountId
          const row = current().variants.get(route.id)
          return row?.productId === route.productId && row.accountId === route.accountId ? { ...row } : null
        },
        async update({ where, data }: { where: { id_productId_accountId: { id: string; productId: string; accountId: string } }; data: { currentStock: { increment: number }; lastPurchaseCost: Prisma.Decimal } }) {
          const route = where.id_productId_accountId
          const row = current().variants.get(route.id)
          assert.ok(row && row.productId === route.productId && row.accountId === route.accountId)
          store.updates.push(data)
          row.currentStock += data.currentStock.increment
          row.lastPurchaseCost = data.lastPurchaseCost
          return { ...row }
        },
      },
      inventoryMovement: {
        async findFirst({ where }: { where: { accountId: string; type: InventoryMovementType; idempotencyKey: string } }) {
          return current().movements.find((row) => row.accountId === where.accountId && row.type === where.type && row.idempotencyKey === where.idempotencyKey) ?? null
        },
        async create({ data }: { data: Omit<MovementRow, 'id' | 'createdAt'> }) {
          if (store.failMovementCreate) throw new Error('private database detail')
          if (store.raceWinner) {
            const winner = store.raceWinner
            store.raceWinner = null
            const live = store.state.variants.get(data.variantId)!
            live.currentStock += data.quantityChange
            live.lastPurchaseCost = data.unitCost
            store.state.movements.push({ ...data, id: randomUUID(), createdAt: now, requestFingerprint: winner === 'same' ? data.requestFingerprint : 'f'.repeat(64) })
            throw knownError('P2002', store.raceConstraint)
          }
          if (current().movements.some((row) => row.accountId === data.accountId && row.idempotencyKey === data.idempotencyKey)) throw knownError('P2002', store.raceConstraint)
          const row = { ...data, id: randomUUID(), createdAt: now }
          current().movements.push(row)
          return row
        },
      },
      async $queryRaw(sql: Prisma.Sql) {
        assert.ok(transactional)
        assert.match(sql.sql, /FOR UPDATE/)
        const values = sql.values as string[]
        if (sql.sql.includes('FROM "ProductVariant"')) {
          store.locks.push('Variant')
          const row = current().variants.get(values[0])
          return row && row.productId === values[1] && row.accountId === values[2]
            ? [{ id: row.id, isActive: row.isActive, currentStock: row.currentStock }] : []
        }
        store.locks.push('Product')
        const row = current().products.get(values[0])
        return row?.accountId === values[1] ? [{ id: row.id, isActive: row.isActive }] : []
      },
      async $transaction<T>(callback: (tx: PrismaClient) => Promise<T>): Promise<T> {
        assert.equal(transactional, false)
        let release!: () => void
        const previous = store.tail
        store.tail = new Promise<void>((resolve) => { release = resolve })
        await previous
        try {
          const staged = store.snapshot()
          const outcome = await callback(store.client(staged, true))
          store.state = staged
          return outcome
        } finally { release() }
      },
    } as unknown as PrismaClient
  }

  asClient(): PrismaClient { return this.client(this.state, false) }
}

const request = { quantity: 5, unitCost: '12.3456', note: null } as const
const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('Restock input and canonical fingerprint', () => {
  test('requires exactly one valid client UUID header', () => {
    assert.throws(() => parseIdempotencyKey({}, []), (error) => expectHttp(error, 400, 'RESTOCK_IDEMPOTENCY_KEY_REQUIRED'))
    assert.throws(() => parseIdempotencyKey({ 'idempotency-key': 'bad' }, ['Idempotency-Key', 'bad']), (error) => expectHttp(error, 400, 'RESTOCK_IDEMPOTENCY_KEY_INVALID'))
    assert.throws(() => parseIdempotencyKey({ 'idempotency-key': key }, ['Idempotency-Key', key, 'idempotency-key', key]), (error) => expectHttp(error, 400, 'RESTOCK_IDEMPOTENCY_KEY_INVALID'))
    assert.equal(parseIdempotencyKey({ 'idempotency-key': key.toUpperCase() }, ['Idempotency-Key', key]), key)
  })

  test('rejects privileged fields, unsafe quantities, and invalid decimal costs', () => {
    for (const extra of ['accountId', 'performedById', 'productId', 'variantId', 'type', 'quantityChange', 'currentStock', 'lastPurchaseCost', 'idempotencyKey', 'requestFingerprint', 'id']) {
      assert.throws(() => parseRestockInput({ ...request, [extra]: 'forged' }), (error) => expectHttp(error, 422, 'INVALID_RESTOCK_INPUT'))
    }
    for (const quantity of [0, -1, 1.5, 1_000_001, Number.MAX_SAFE_INTEGER, '5', null]) {
      assert.throws(() => parseRestockInput({ ...request, quantity }), (error) => expectHttp(error, 422, 'INVALID_RESTOCK_QUANTITY'))
    }
    for (const unitCost of ['0', '-1', '12.34567', 'NaN', 'Infinity', '1e2', '100000000000000', 'x', 12.3, null]) {
      assert.throws(() => parseRestockInput({ ...request, unitCost }), (error) => expectHttp(error, 422, 'INVALID_RESTOCK_UNIT_COST'))
    }
  })

  test('normalizes costs and notes before hashing', () => {
    const a = parseRestockInput({ quantity: 5, unitCost: '12.3', note: '  Cafe\u0301  ' })
    const b = parseRestockInput({ quantity: 5, unitCost: '12.3000', note: 'Café' })
    assert.deepEqual(a, { quantity: 5, unitCost: '12.3000', note: 'Café' })
    assert.equal(restockFingerprint(accountA, ownerA, variantA, a), restockFingerprint(accountA, ownerA, variantA, b))
    assert.match(restockFingerprint(accountA, ownerA, variantA, a), /^[0-9a-f]{64}$/)
    assert.equal(parseRestockInput({ ...request, note: ' \t ' }).note, null)
    assert.throws(() => parseRestockInput({ ...request, note: 'x'.repeat(501) }), (error) => expectHttp(error, 422, 'INVALID_RESTOCK_NOTE'))
    assert.throws(() => parseRestockInput({ ...request, note: 5 }), (error) => expectHttp(error, 422, 'INVALID_RESTOCK_NOTE'))
  })
})

describe('transactional Restock service', () => {
  test('increments stock, replaces purchase cost, and appends one tenant/actor movement', async () => {
    const store = new RestockDouble()
    const service = createRestockDependencies(store.asClient())
    const result = await service.restock(accountA, ownerA, productA, variantA, key, request)
    assert.equal(result.idempotentReplay, false)
    assert.equal(result.variant.currentStock, 12)
    assert.equal(result.variant.lastPurchaseCost, '12.3456')
    assert.deepEqual(store.locks, ['Product', 'Variant'])
    assert.deepEqual(store.updates[0], { currentStock: { increment: 5 }, lastPurchaseCost: new Prisma.Decimal('12.3456') })
    assert.equal(store.state.movements.length, 1)
    const movement = store.state.movements[0]
    assert.equal(movement.accountId, accountA)
    assert.equal(movement.performedById, ownerA)
    assert.equal(movement.variantId, variantA)
    assert.equal(movement.type, InventoryMovementType.RESTOCK)
    assert.equal(movement.quantityChange, 5)
    assert.equal(movement.unitCost.toFixed(4), '12.3456')
    assert.equal(movement.idempotencyKey, key)
    assert.equal(movement.requestFingerprint, restockFingerprint(accountA, ownerA, variantA, request))
    assert.equal(movement.saleItemId, null)
    assert.equal(movement.returnItemId, null)
  })

  test('returns original movement on replay and current stock separately', async () => {
    const store = new RestockDouble()
    const service = createRestockDependencies(store.asClient())
    const first = await service.restock(accountA, ownerA, productA, variantA, key, parseRestockInput({ quantity: 5, unitCost: '12.3', note: ' note ' }))
    store.state.variants.get(variantA)!.currentStock = 20
    store.state.variants.get(variantA)!.lastPurchaseCost = new Prisma.Decimal('14.0000')
    const replay = await service.restock(accountA, ownerA, productA, variantA, key, parseRestockInput({ quantity: 5, unitCost: '12.3000', note: 'note' }))
    assert.equal(replay.restock.id, first.restock.id)
    assert.equal(replay.restock.unitCost, '12.3000')
    assert.equal(replay.variant.currentStock, 20)
    assert.equal(replay.variant.lastPurchaseCost, '14.0000')
    assert.equal(replay.idempotentReplay, true)
    assert.equal(store.state.movements.length, 1)
    for (const changed of [{ ...request, quantity: 6 }, { ...request, unitCost: '13.0000' }, { ...request, note: 'changed' }]) {
      await assert.rejects(service.restock(accountA, ownerA, productA, variantA, key, changed), (error) => expectHttp(error, 409, 'RESTOCK_IDEMPOTENCY_CONFLICT'))
    }
    assert.equal(store.state.movements.length, 1)
  })

  test('hides foreign resources and wrong-product variants; rejects inactive catalog', async () => {
    const store = new RestockDouble()
    const service = createRestockDependencies(store.asClient())
    await assert.rejects(service.restock(accountA, ownerA, productOther, variantOther, key, request), (error) => expectHttp(error, 404, 'PRODUCT_NOT_FOUND'))
    await assert.rejects(service.restock(accountA, ownerA, productA, variantOther, key, request), (error) => expectHttp(error, 404, 'VARIANT_NOT_FOUND'))
    await assert.rejects(service.restock(accountA, ownerA, productA, variantB, key, request), (error) => expectHttp(error, 404, 'VARIANT_NOT_FOUND'))
    store.state.products.get(productA)!.isActive = false
    await assert.rejects(service.restock(accountA, ownerA, productA, variantA, key, request), (error) => expectHttp(error, 409, 'PRODUCT_INACTIVE'))
    store.state.products.get(productA)!.isActive = true
    store.state.variants.get(variantA)!.isActive = false
    await assert.rejects(service.restock(accountA, ownerA, productA, variantA, key, request), (error) => expectHttp(error, 409, 'VARIANT_INACTIVE'))
    assert.equal(store.state.movements.length, 0)
  })

  test('rejects stock overflow and rolls back stock/cost when movement insertion fails', async () => {
    const store = new RestockDouble()
    const service = createRestockDependencies(store.asClient())
    store.state.variants.get(variantA)!.currentStock = 2_147_483_646
    await assert.rejects(service.restock(accountA, ownerA, productA, variantA, key, request), (error) => expectHttp(error, 409, 'RESTOCK_STOCK_OVERFLOW'))
    store.state.variants.get(variantA)!.currentStock = 7
    store.failMovementCreate = true
    await assert.rejects(service.restock(accountA, ownerA, productA, variantA, key, request), (error) => expectHttp(error, 503, 'RESTOCK_UNAVAILABLE'))
    assert.equal(store.state.variants.get(variantA)!.currentStock, 7)
    assert.equal(store.state.variants.get(variantA)!.lastPurchaseCost?.toFixed(4), '9.0000')
    assert.equal(store.state.movements.length, 0)
  })

  test('same key is tenant-scoped, concurrent distinct keys retain both increments', async () => {
    const store = new RestockDouble()
    store.state.variants.get(variantA)!.currentStock = 0
    const service = createRestockDependencies(store.asClient())
    await Promise.all([
      service.restock(accountA, ownerA, productA, variantA, randomUUID(), { quantity: 5, unitCost: '12.0000', note: null }),
      service.restock(accountA, ownerA, productA, variantA, randomUUID(), { quantity: 7, unitCost: '13.0000', note: null }),
    ])
    assert.equal(store.state.variants.get(variantA)!.currentStock, 12)
    assert.equal(store.state.movements.length, 2)
    await service.restock(accountB, ownerB, productOther, variantOther, key, request)
    await service.restock(accountA, ownerA, productA, variantA, key, request)
    assert.equal(store.state.movements.length, 4)
  })

  test('unique-index loser rolls back then returns winner or conflicts safely', async () => {
    const same = new RestockDouble()
    same.raceWinner = 'same'
    const success = await createRestockDependencies(same.asClient()).restock(accountA, ownerA, productA, variantA, key, request)
    assert.equal(success.idempotentReplay, true)
    assert.equal(same.state.variants.get(variantA)!.currentStock, 12)
    assert.equal(same.state.movements.length, 1)
    const different = new RestockDouble()
    different.raceWinner = 'different'
    await assert.rejects(createRestockDependencies(different.asClient()).restock(accountA, ownerA, productA, variantA, key, request), (error) => expectHttp(error, 409, 'RESTOCK_IDEMPOTENCY_CONFLICT'))
    assert.equal(different.state.movements.length, 1)
  })

  test('unrelated unique violation is not mistaken for an idempotent replay', async () => {
    const store = new RestockDouble()
    store.raceWinner = 'same'
    store.raceConstraint = 'unrelated_unique_index'
    await assert.rejects(
      createRestockDependencies(store.asClient()).restock(accountA, ownerA, productA, variantA, key, request),
      (error) => expectHttp(error, 503, 'RESTOCK_UNAVAILABLE'),
    )
    assert.equal(store.state.movements.length, 1)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 12)
  })
})

function auth(role: UserRole): AuthDependencies {
  return {
    async verifyAccessToken() { return { id: ownerA, email: 'owner@example.com', emailConfirmedAt: now.toISOString(), isAnonymous: false } },
    async findApplicationUser() { return { id: ownerA, role, accountId: accountA, isActive: true } },
    async findAccountById() { return { id: accountA, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw Error('unused') },
  }
}

async function withServer(role: UserRole, store: RestockDouble, run: (base: string) => Promise<void>) {
  const app = express()
  app.use(express.json())
  app.use('/api/products', createProductRouter(auth(role), createProductDependencies(store.asClient(), () => { throw Error('unused') })))
  app.use(errorHandler)
  const server = app.listen(0)
  try {
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`)
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('RESTOCK route authorization and response', () => {
  test('OWNER receives 201 then 200 replay; WAREHOUSE cannot mutate', async () => {
    const store = new RestockDouble()
    const path = `/api/products/${productA}/variants/${variantA}/restocks`
    await withServer(UserRole.OWNER, store, async (base) => {
      const options = { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(request) }
      const first = await fetch(base + path, options)
      assert.equal(first.status, 201)
      const body = await first.json() as { restock: { unitCost: string }; variant: { currentStock: number }; idempotentReplay: boolean }
      assert.equal(body.restock.unitCost, '12.3456')
      assert.equal(body.variant.currentStock, 12)
      assert.equal(body.idempotentReplay, false)
      assert.equal(Object.hasOwn(body.restock, 'requestFingerprint'), false)
      assert.equal(Object.hasOwn(body.restock, 'idempotencyKey'), false)
      const replay = await fetch(base + path, options)
      assert.equal(replay.status, 200)
      assert.equal((await replay.json() as { idempotentReplay: boolean }).idempotentReplay, true)
      assert.equal((await fetch(base + path, { ...options, headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' } })).status, 400)
      assert.equal((await fetch(base + path, { ...options, headers: { ...options.headers, 'Idempotency-Key': 'bad' } })).status, 400)
    })
    assert.equal(store.state.movements.length, 1)
    await withServer(UserRole.WAREHOUSE, store, async (base) => {
      const denied = await fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(request) })
      assert.equal(denied.status, 403)
      assert.equal((await denied.json() as { error: { code: string } }).error.code, 'ROLE_FORBIDDEN')
    })
    assert.equal(store.state.movements.length, 1)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 12)
    assert.equal(store.state.variants.get(variantA)!.lastPurchaseCost?.toFixed(4), '12.3456')
  })
})
