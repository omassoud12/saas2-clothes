import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, InventoryMovementType, SaleStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import type { ReturnDependencies } from '../returns/return.types.js'
import { createSaleRouter } from './sale.routes.js'
import { maxSaleVoidReasonCharacters, parseSaleVoidInput } from './sale.schemas.js'
import { createSaleDependencies } from './sale.service.js'
import type { SaleDependencies } from './sale.types.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const ownerA = '33333333-3333-4333-8333-333333333333'
const ownerA2 = '44444444-4444-4444-8444-444444444444'
const warehouseA = '55555555-5555-4555-8555-555555555555'
const saleA = '66666666-6666-4666-8666-666666666666'
const saleForeign = '77777777-7777-4777-8777-777777777777'
const itemA = '88888888-8888-4888-8888-888888888888'
const itemB = '99999999-9999-4999-8999-999999999999'
const variantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const variantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const productA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const productB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const now = new Date('2026-09-23T18:00:00.000Z')

type Row = Record<string, any>
type State = {
  accounts: Map<string, Row>
  users: Map<string, Row>
  sales: Map<string, Row>
  items: Map<string, Row>
  returns: Row[]
  variants: Map<string, Row>
  movements: Row[]
}

function expectHttp(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  assert.doesNotMatch(error.message, /prisma|sql|constraint|stack/i)
  return true
}

class VoidDouble {
  state: State = {
    accounts: new Map([[accountA, { id: accountA }], [accountB, { id: accountB }]]),
    users: new Map([
      [ownerA, { id: ownerA, accountId: accountA, firstName: 'Ada', lastName: 'Owner', employeeCode: 'OWN-1', role: UserRole.OWNER, isActive: true }],
      [ownerA2, { id: ownerA2, accountId: accountA, firstName: 'Bea', lastName: 'Owner', employeeCode: 'OWN-2', role: UserRole.OWNER, isActive: true }],
      [warehouseA, { id: warehouseA, accountId: accountA, firstName: 'Will', lastName: 'Stock', employeeCode: 'WH-1', role: UserRole.WAREHOUSE, isActive: true }],
    ]),
    sales: new Map([
      [saleA, {
        id: saleA, accountId: accountA, status: SaleStatus.COMPLETED, currency: 'USD',
        subtotal: new Prisma.Decimal('85.00'), totalAmount: new Prisma.Decimal('85.00'), createdAt: now,
        sellerNameAtSale: 'Historical Seller', sellerCodeAtSale: 'SELL-1',
        voidedAt: null, voidedById: null, voidedByName: null, voidedByCode: null, voidReason: null,
      }],
      [saleForeign, {
        id: saleForeign, accountId: accountB, status: SaleStatus.COMPLETED, currency: 'USD',
        subtotal: new Prisma.Decimal('1.00'), totalAmount: new Prisma.Decimal('1.00'), createdAt: now,
        sellerNameAtSale: 'Foreign Seller', sellerCodeAtSale: null,
        voidedAt: null, voidedById: null, voidedByName: null, voidedByCode: null, voidReason: null,
      }],
    ]),
    items: new Map([
      [itemA, {
        id: itemA, accountId: accountA, saleId: saleA, productId: productA, variantId: variantA,
        productNameAtSale: 'Historical Tee', categoryNameAtSale: 'Historical Shirts', skuAtSale: 'OLD-TEE',
        colorAtSale: 'Black', sizeAtSale: 'M', quantity: 2, unitSoldPrice: new Prisma.Decimal('12.50'),
        unitCostAtSale: new Prisma.Decimal('7.1234'), lineTotal: new Prisma.Decimal('25.00'),
      }],
      [itemB, {
        id: itemB, accountId: accountA, saleId: saleA, productId: productB, variantId: variantB,
        productNameAtSale: 'Historical Jeans', categoryNameAtSale: 'Historical Denim', skuAtSale: 'OLD-JEAN',
        colorAtSale: 'Blue', sizeAtSale: 'L', quantity: 3, unitSoldPrice: new Prisma.Decimal('20.00'),
        unitCostAtSale: new Prisma.Decimal('9.9999'), lineTotal: new Prisma.Decimal('60.00'),
      }],
    ]),
    returns: [],
    variants: new Map([
      [variantA, { id: variantA, accountId: accountA, currentStock: 5, lastPurchaseCost: new Prisma.Decimal('20.0000'), isActive: false }],
      [variantB, { id: variantB, accountId: accountA, currentStock: 7, lastPurchaseCost: new Prisma.Decimal('30.0000'), isActive: false }],
    ]),
    movements: [],
  }
  readonly locks: { kind: string; ids: string[] }[] = []
  failAt: 'stock' | 'movement' | 'transition' | null = null
  stockUpdateAttempts = 0
  private tail: Promise<void> = Promise.resolve()

  private snapshot(): State {
    return {
      accounts: new Map([...this.state.accounts].map(([id, row]) => [id, { ...row }])),
      users: new Map([...this.state.users].map(([id, row]) => [id, { ...row }])),
      sales: new Map([...this.state.sales].map(([id, row]) => [id, { ...row }])),
      items: new Map([...this.state.items].map(([id, row]) => [id, { ...row }])),
      returns: this.state.returns.map((row) => ({ ...row })),
      variants: new Map([...this.state.variants].map(([id, row]) => [id, { ...row }])),
      movements: this.state.movements.map((row) => ({ ...row })),
    }
  }

  private persisted(state: State, sale: Row): Row {
    return {
      ...sale,
      items: [...state.items.values()].filter((item) => item.accountId === sale.accountId && item.saleId === sale.id)
        .sort((left, right) => left.id.localeCompare(right.id)).map((item) => ({ ...item })),
    }
  }

  private client(state: State, transactional: boolean): PrismaClient {
    const store = this
    const current = () => transactional ? state : store.state
    return {
      sale: {
        async findUnique({ where }: Row) {
          const key = where.id_accountId
          const sale = current().sales.get(key.id)
          if (!sale || sale.accountId !== key.accountId) return null
          return store.persisted(current(), sale)
        },
        async update({ where, data }: Row) {
          if (store.failAt === 'transition') throw new Error('private transition failure')
          const key = where.id_accountId
          const sale = current().sales.get(key.id)
          if (!sale || sale.accountId !== key.accountId) throw new Error('private missing sale')
          Object.assign(sale, data)
          return { id: sale.id }
        },
      },
      saleReturn: {
        async findFirst({ where }: Row) {
          const row = current().returns.find((candidate) => candidate.accountId === where.accountId && candidate.saleId === where.saleId)
          return row ? { id: row.id } : null
        },
      },
      saleItem: {
        async findMany({ where }: Row) {
          return [...current().items.values()].filter((item) => item.accountId === where.accountId && item.saleId === where.saleId)
            .sort((left, right) => left.id.localeCompare(right.id)).map((item) => ({ ...item }))
        },
      },
      productVariant: {
        async updateMany({ where, data }: Row) {
          store.stockUpdateAttempts += 1
          if (store.failAt === 'stock' && store.stockUpdateAttempts === 2) return { count: 0 }
          const variant = current().variants.get(where.id)
          if (!variant || variant.accountId !== where.accountId || variant.currentStock > where.currentStock.lte) return { count: 0 }
          variant.currentStock += data.currentStock.increment
          return { count: 1 }
        },
      },
      inventoryMovement: {
        async create({ data }: Row) {
          if (store.failAt === 'movement') throw new Error('private movement failure')
          const row = { ...data, id: crypto.randomUUID(), createdAt: now }
          current().movements.push(row)
          return { id: row.id }
        },
      },
      async $queryRaw(sql: Prisma.Sql) {
        assert.ok(transactional)
        const values = sql.values as string[]
        if (sql.sql.includes('FROM "Account"')) {
          store.locks.push({ kind: 'Account', ids: [values[0]] })
          const row = current().accounts.get(values[0]); return row ? [{ ...row }] : []
        }
        if (sql.sql.includes('FROM "User"')) {
          store.locks.push({ kind: 'User', ids: [values[0]] })
          const row = current().users.get(values[0])
          return row?.accountId === values[1] ? [{ ...row, voidedByName: `${row.firstName} ${row.lastName}`.trim() }] : []
        }
        if (sql.sql.includes('FROM "ProductVariant"')) {
          const ids = values.slice(1)
          store.locks.push({ kind: 'Variant', ids })
          return ids.map((id) => current().variants.get(id)).filter((row): row is Row => row?.accountId === values[0])
            .map((row) => ({ id: row.id, currentStock: row.currentStock }))
        }
        store.locks.push({ kind: 'Sale', ids: [values[0]] })
        const sale = current().sales.get(values[0])
        return sale?.accountId === values[1] ? [{ id: sale.id, status: sale.status, voidedById: sale.voidedById, voidReason: sale.voidReason }] : []
      },
      async $transaction<T>(callback: (transaction: PrismaClient) => Promise<T>): Promise<T> {
        assert.equal(transactional, false)
        let release!: () => void
        const previous = store.tail
        store.tail = new Promise<void>((resolve) => { release = resolve })
        await previous
        try {
          const staged = store.snapshot()
          const result = await callback(store.client(staged, true))
          store.state = staged
          return result
        } finally {
          release()
        }
      },
    } as unknown as PrismaClient
  }

  asClient(): PrismaClient { return this.client(this.state, false) }
}

describe('Sale Void request validation', () => {
  test('requires one nonblank normalized reason', () => {
    assert.equal(parseSaleVoidInput({ reason: '  Cafe\u0301 mistake  ' }).reason, 'Café mistake')
    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: null }, { reason: 7 }]) {
      assert.throws(() => parseSaleVoidInput(body), (error) => expectHttp(error, 422, body && 'reason' in body ? 'INVALID_SALE_VOID_REASON' : 'INVALID_SALE_VOID_INPUT'))
    }
    assert.throws(() => parseSaleVoidInput({ reason: 'x'.repeat(maxSaleVoidReasonCharacters + 1) }), (error) => expectHttp(error, 422, 'INVALID_SALE_VOID_REASON'))
  })

  test('rejects every unknown or privileged field', () => {
    for (const field of ['accountId', 'voidedById', 'voidedByName', 'voidedByCode', 'voidedAt', 'status', 'saleItemIds', 'quantity', 'stock', 'unitCost', 'movement']) {
      assert.throws(() => parseSaleVoidInput({ reason: 'Valid', [field]: 'forged' }), (error) => expectHttp(error, 422, 'INVALID_SALE_VOID_INPUT'))
    }
  })
})

describe('transactional Sale Void service', () => {
  test('restores every line, writes exact historical-cost movements, and transitions Sale', async () => {
    const store = new VoidDouble()
    const result = await createSaleDependencies(store.asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Cashier mistake' })
    assert.equal(result.idempotentReplay, false); assert.equal(result.sale.status, SaleStatus.VOIDED)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 7)
    assert.equal(store.state.variants.get(variantB)!.currentStock, 10)
    assert.equal(store.state.movements.length, 2)
    assert.deepEqual(store.state.movements.map((movement) => movement.quantityChange), [2, 3])
    assert.deepEqual(store.state.movements.map((movement) => movement.unitCost.toFixed(4)), ['7.1234', '9.9999'])
    for (const movement of store.state.movements) {
      assert.equal(movement.type, InventoryMovementType.SALE_VOID)
      assert.equal(movement.performedById, ownerA); assert.equal(movement.returnItemId, null)
      assert.equal(movement.idempotencyKey, null); assert.equal(movement.requestFingerprint, null)
    }
    const sale = store.state.sales.get(saleA)!
    assert.equal(sale.voidedById, ownerA); assert.equal(sale.voidedByName, 'Ada Owner'); assert.equal(sale.voidReason, 'Cashier mistake')
    assert.equal(store.state.returns.length, 0)
  })

  test('uses deterministic Account/User/Sale/sorted-Variant lock order without SaleItem locks', async () => {
    const store = new VoidDouble()
    await createSaleDependencies(store.asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Mistake' })
    assert.deepEqual(store.locks.map((lock) => lock.kind), ['Account', 'User', 'Sale', 'Variant'])
    assert.deepEqual(store.locks[3].ids, [variantA, variantB].sort())
  })

  test('allows inactive historical Variants without reactivation and ignores current costs', async () => {
    const store = new VoidDouble()
    assert.equal(store.state.variants.get(variantA)!.isActive, false)
    await createSaleDependencies(store.asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Mistake' })
    assert.equal(store.state.variants.get(variantA)!.isActive, false)
    assert.equal(store.state.variants.get(variantA)!.lastPurchaseCost.toFixed(4), '20.0000')
    assert.equal(store.state.movements[0].unitCost.toFixed(4), '7.1234')
  })

  test('replays same actor and normalized reason exactly once using stored snapshots/time', async () => {
    const store = new VoidDouble(); const service = createSaleDependencies(store.asClient())
    const first = await service.voidSale(accountA, ownerA, saleA, { reason: 'Café mistake' })
    const timestamp = first.sale.void.voidedAt
    store.state.users.get(ownerA)!.firstName = 'Changed'
    store.state.users.get(ownerA)!.employeeCode = 'NEW-CODE'
    const replay = await service.voidSale(accountA, ownerA, saleA, { reason: 'Café mistake' })
    assert.equal(replay.idempotentReplay, true); assert.equal(replay.sale.void.voidedAt, timestamp)
    assert.equal(replay.sale.void.voidedByName, 'Ada Owner'); assert.equal(replay.sale.void.voidedByCode, 'OWN-1')
    assert.equal(store.state.movements.length, 2); assert.equal(store.state.variants.get(variantA)!.currentStock, 7)
  })

  test('conflicts on a changed reason or actor with zero replay mutation', async () => {
    const store = new VoidDouble(); const service = createSaleDependencies(store.asClient())
    await service.voidSale(accountA, ownerA, saleA, { reason: 'Cashier mistake' })
    const before = [store.state.movements.length, store.state.variants.get(variantA)!.currentStock]
    await assert.rejects(service.voidSale(accountA, ownerA, saleA, { reason: 'Wrong price' }), (error) => expectHttp(error, 409, 'SALE_VOID_CONFLICT'))
    await assert.rejects(service.voidSale(accountA, ownerA2, saleA, { reason: 'Cashier mistake' }), (error) => expectHttp(error, 409, 'SALE_VOID_CONFLICT'))
    assert.deepEqual([store.state.movements.length, store.state.variants.get(variantA)!.currentStock], before)
  })

  test('rejects a Sale with any Return before inventory mutation', async () => {
    const store = new VoidDouble(); store.state.returns.push({ id: crypto.randomUUID(), accountId: accountA, saleId: saleA })
    await assert.rejects(createSaleDependencies(store.asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Mistake' }), (error) => expectHttp(error, 409, 'SALE_VOID_HAS_RETURNS'))
    assert.equal(store.state.sales.get(saleA)!.status, SaleStatus.COMPLETED)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 5); assert.equal(store.state.movements.length, 0)
  })

  test('tenant-scopes Sale and rechecks active OWNER authority inside the transaction', async () => {
    const foreign = new VoidDouble()
    await assert.rejects(createSaleDependencies(foreign.asClient()).voidSale(accountA, ownerA, saleForeign, { reason: 'Mistake' }), (error) => expectHttp(error, 404, 'SALE_NOT_FOUND'))
    for (const change of [{ isActive: false }, { role: UserRole.WAREHOUSE }, { accountId: accountB }]) {
      const store = new VoidDouble(); Object.assign(store.state.users.get(ownerA)!, change)
      await assert.rejects(createSaleDependencies(store.asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Mistake' }), (error) => expectHttp(error, 403, 'SALE_VOID_ACTOR_UNAVAILABLE'))
      assert.equal(store.state.sales.get(saleA)!.status, SaleStatus.COMPLETED)
    }
  })

  test('fails safely for zero items or an unavailable historical Variant', async () => {
    const empty = new VoidDouble(); empty.state.items.clear()
    await assert.rejects(createSaleDependencies(empty.asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Mistake' }), (error) => expectHttp(error, 409, 'SALE_VOID_NO_ITEMS'))
    const missing = new VoidDouble(); missing.state.variants.delete(variantB)
    await assert.rejects(createSaleDependencies(missing.asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Mistake' }), (error) => expectHttp(error, 409, 'SALE_VOID_VARIANT_UNAVAILABLE'))
  })

  test('rejects stock overflow before any mutation', async () => {
    const store = new VoidDouble(); store.state.variants.get(variantA)!.currentStock = 2_147_483_647
    await assert.rejects(createSaleDependencies(store.asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Mistake' }), (error) => expectHttp(error, 409, 'INVENTORY_STOCK_OVERFLOW'))
    assert.equal(store.state.sales.get(saleA)!.status, SaleStatus.COMPLETED); assert.equal(store.state.movements.length, 0)
  })

  test('rolls back every line on stock, movement, or final transition failure', async () => {
    for (const failAt of ['stock', 'movement', 'transition'] as const) {
      const store = new VoidDouble(); store.failAt = failAt
      const before = [store.state.variants.get(variantA)!.currentStock, store.state.variants.get(variantB)!.currentStock]
      await assert.rejects(createSaleDependencies(store.asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Mistake' }), (error) => expectHttp(error, failAt === 'stock' ? 409 : 503, failAt === 'stock' ? 'INVENTORY_STOCK_OVERFLOW' : 'SALE_VOID_UNAVAILABLE'))
      assert.deepEqual([store.state.variants.get(variantA)!.currentStock, store.state.variants.get(variantB)!.currentStock], before)
      assert.equal(store.state.sales.get(saleA)!.status, SaleStatus.COMPLETED); assert.equal(store.state.movements.length, 0)
    }
  })

  test('returns immutable historical display with no inventory economics or internals', async () => {
    const result = await createSaleDependencies(new VoidDouble().asClient()).voidSale(accountA, ownerA, saleA, { reason: 'Mistake' })
    assert.equal(result.sale.items[0].productName, 'Historical Tee'); assert.equal(result.sale.items[0].sku, 'OLD-TEE')
    const json = JSON.stringify(result)
    for (const forbidden of ['unitCostAtSale', 'lastPurchaseCost', 'profit', 'margin', 'currentStock', 'movementId', 'idempotencyKey', 'requestFingerprint']) {
      assert.equal(json.includes(forbidden), false)
    }
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

async function withServer(role: UserRole, sales: SaleDependencies, run: (base: string) => Promise<void>) {
  const returns = {} as ReturnDependencies
  const app = express(); app.use(express.json()); app.use('/api/sales', createSaleRouter(auth(role), sales, returns)); app.use(errorHandler)
  const server = app.listen(0)
  try { const address = server.address() as AddressInfo; await run(`http://127.0.0.1:${address.port}`) }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('Sale Void route authorization and status', () => {
  test('OWNER receives 201 then 200 replay; WAREHOUSE and SUPER_ADMIN are forbidden', async () => {
    const store = new VoidDouble()
    await withServer(UserRole.OWNER, createSaleDependencies(store.asClient()), async (base) => {
      const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' }
      assert.equal((await fetch(`${base}/api/sales/${saleA}/void`, { method: 'POST', headers, body: JSON.stringify({ reason: ' Cafe\u0301 mistake ' }) })).status, 201)
      assert.equal(store.state.sales.get(saleA)!.voidReason, 'Café mistake')
      assert.equal((await fetch(`${base}/api/sales/${saleA}/void`, { method: 'POST', headers, body: JSON.stringify({ reason: 'Café mistake' }) })).status, 200)
    })
    const unused = createSaleDependencies(new VoidDouble().asClient())
    for (const role of [UserRole.WAREHOUSE, UserRole.SUPER_ADMIN]) {
      await withServer(role, unused, async (base) => {
        const response = await fetch(`${base}/api/sales/${saleA}/void`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Mistake' }) })
        assert.equal(response.status, 403)
      })
    }
  })

  test('validates Sale ID and strict body before service execution', async () => {
    const unused = { ...createSaleDependencies(new VoidDouble().asClient()), async voidSale() { throw Error('must not run') } }
    await withServer(UserRole.OWNER, unused, async (base) => {
      const malformed = await fetch(`${base}/api/sales/not-a-uuid/void`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Mistake' }) })
      assert.equal(malformed.status, 422)
      const privileged = await fetch(`${base}/api/sales/${saleA}/void`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Mistake', accountId: accountB }) })
      assert.equal(privileged.status, 422)
    })
  })
})
