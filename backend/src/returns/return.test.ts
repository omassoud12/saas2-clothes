import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, InventoryMovementType, SaleStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { createSaleRouter } from '../sales/sale.routes.js'
import type { SaleDependencies } from '../sales/sale.types.js'
import {
  canonicalReturnItems,
  maxReturnLines,
  maxReturnReasonCharacters,
  parseReturnIdempotencyKey,
  parseReturnInput,
  parseReturnSaleId,
  returnFingerprint,
} from './return.schemas.js'
import { createReturnDependencies } from './return.service.js'
import type { ReturnDependencies, ReturnInput } from './return.types.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const ownerA = '33333333-3333-4333-8333-333333333333'
const warehouseA = '44444444-4444-4444-8444-444444444444'
const ownerB = '55555555-5555-4555-8555-555555555555'
const saleA = '66666666-6666-4666-8666-666666666666'
const saleB = '77777777-7777-4777-8777-777777777777'
const saleOther = '88888888-8888-4888-8888-888888888888'
const itemA = '99999999-9999-4999-8999-999999999999'
const itemB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const itemOther = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const variantA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const variantB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const variantOther = '20000000-0000-4000-8000-000000000002'
const productA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const productB = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const key = '10000000-0000-4000-8000-000000000001'
const now = new Date('2026-09-23T12:00:00.000Z')

type Row = Record<string, any>
type State = {
  accounts: Map<string, Row>
  users: Map<string, Row>
  sales: Map<string, Row>
  saleItems: Map<string, Row>
  variants: Map<string, Row>
  returns: Row[]
  returnItems: Row[]
  movements: Row[]
}

function knownError(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('private database detail', {
    code: 'P2002', clientVersion: 'test', meta: { target },
  })
}

function expectHttp(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  assert.doesNotMatch(error.message, /prisma|sql|constraint|fingerprint/i)
  return true
}

class ReturnDouble {
  state: State = {
    accounts: new Map([[accountA, { id: accountA }], [accountB, { id: accountB }]]),
    users: new Map([
      [ownerA, { id: ownerA, accountId: accountA, firstName: 'Ada', lastName: 'Owner', employeeCode: null, role: UserRole.OWNER, isActive: true }],
      [warehouseA, { id: warehouseA, accountId: accountA, firstName: 'Will', lastName: 'Stock', employeeCode: 'W-1', role: UserRole.WAREHOUSE, isActive: true }],
      [ownerB, { id: ownerB, accountId: accountB, firstName: 'Bea', lastName: 'Owner', employeeCode: null, role: UserRole.OWNER, isActive: true }],
    ]),
    sales: new Map([
      [saleA, { id: saleA, accountId: accountA, status: SaleStatus.COMPLETED }],
      [saleB, { id: saleB, accountId: accountA, status: SaleStatus.COMPLETED }],
      [saleOther, { id: saleOther, accountId: accountB, status: SaleStatus.COMPLETED }],
    ]),
    saleItems: new Map([
      [itemA, {
        id: itemA, accountId: accountA, saleId: saleA, productId: productA, variantId: variantA,
        productNameAtSale: 'Historical Tee', categoryNameAtSale: 'Historical Shirts', skuAtSale: 'OLD-TEE',
        colorAtSale: 'Black', sizeAtSale: 'M', quantity: 5,
        unitSoldPrice: new Prisma.Decimal('12.50'), unitCostAtSale: new Prisma.Decimal('7.1234'),
      }],
      [itemB, {
        id: itemB, accountId: accountA, saleId: saleA, productId: productB, variantId: variantB,
        productNameAtSale: 'Historical Jeans', categoryNameAtSale: 'Historical Denim', skuAtSale: 'OLD-JEAN',
        colorAtSale: 'Blue', sizeAtSale: 'L', quantity: 2,
        unitSoldPrice: new Prisma.Decimal('20.00'), unitCostAtSale: new Prisma.Decimal('9.9999'),
      }],
      [itemOther, {
        id: itemOther, accountId: accountB, saleId: saleOther, productId: productA, variantId: variantOther,
        productNameAtSale: 'Foreign', categoryNameAtSale: 'Foreign', skuAtSale: 'FOREIGN', colorAtSale: null,
        sizeAtSale: null, quantity: 1, unitSoldPrice: new Prisma.Decimal('1.00'), unitCostAtSale: new Prisma.Decimal('1.0000'),
      }],
    ]),
    variants: new Map([
      [variantA, { id: variantA, accountId: accountA, productId: productA, currentStock: 3, lastPurchaseCost: new Prisma.Decimal('11.9999'), isActive: false }],
      [variantB, { id: variantB, accountId: accountA, productId: productB, currentStock: 4, lastPurchaseCost: new Prisma.Decimal('15.0000'), isActive: false }],
      [variantOther, { id: variantOther, accountId: accountB, productId: productA, currentStock: 1, lastPurchaseCost: new Prisma.Decimal('1.0000'), isActive: true }],
    ]),
    returns: [], returnItems: [], movements: [],
  }
  readonly locks: { kind: string; ids: string[] }[] = []
  failAt: 'returnItem' | 'movement' | 'stock' | null = null
  raceWinner: 'same' | 'different' | null = null
  raceConstraint = 'SaleReturn_accountId_idempotencyKey_key'
  private tail: Promise<void> = Promise.resolve()

  private snapshot(): State {
    return {
      accounts: new Map([...this.state.accounts].map(([id, row]) => [id, { ...row }])),
      users: new Map([...this.state.users].map(([id, row]) => [id, { ...row }])),
      sales: new Map([...this.state.sales].map(([id, row]) => [id, { ...row }])),
      saleItems: new Map([...this.state.saleItems].map(([id, row]) => [id, { ...row }])),
      variants: new Map([...this.state.variants].map(([id, row]) => [id, { ...row }])),
      returns: this.state.returns.map((row) => ({ ...row })),
      returnItems: this.state.returnItems.map((row) => ({ ...row })),
      movements: this.state.movements.map((row) => ({ ...row })),
    }
  }

  private persisted(state: State, header: Row): Row {
    return {
      ...header,
      items: state.returnItems.filter((item) => item.returnId === header.id)
        .sort((left, right) => left.saleItemId.localeCompare(right.saleItemId))
        .map((item) => ({ ...item, saleItem: { ...state.saleItems.get(item.saleItemId) } })),
    }
  }

  private addRaceWinner(data: Row, kind: 'same' | 'different'): void {
    const id = randomUUID()
    const header = { ...data, id, requestFingerprint: kind === 'same' ? data.requestFingerprint : 'f'.repeat(64), createdAt: now }
    this.state.returns.push(header)
    const original = this.state.saleItems.get(itemA)!
    const returnItemId = randomUUID()
    this.state.returnItems.push({
      id: returnItemId, accountId: data.accountId, returnId: id, saleId: data.saleId,
      saleItemId: itemA, variantId: variantA, quantity: 2, refundAmount: new Prisma.Decimal('25.00'), createdAt: now,
    })
    this.state.movements.push({
      id: randomUUID(), accountId: data.accountId, variantId: variantA, type: InventoryMovementType.RETURN,
      quantityChange: 2, unitCost: original.unitCostAtSale, performedById: data.processedById,
      saleItemId: null, returnItemId, idempotencyKey: null, requestFingerprint: null,
    })
    this.state.variants.get(variantA)!.currentStock += 2
  }

  private client(state: State, transactional: boolean): PrismaClient {
    const store = this
    const current = () => transactional ? state : store.state
    return {
      saleReturn: {
        async findUnique({ where }: Row) {
          const unique = where.accountId_idempotencyKey
          const row = current().returns.find((candidate) => candidate.accountId === unique.accountId && candidate.idempotencyKey === unique.idempotencyKey)
          return row ? store.persisted(current(), row) : null
        },
        async create({ data }: Row) {
          if (store.raceWinner) {
            const kind = store.raceWinner
            store.raceWinner = null
            store.addRaceWinner(data, kind)
            throw knownError(store.raceConstraint)
          }
          if (current().returns.some((row) => row.accountId === data.accountId && row.idempotencyKey === data.idempotencyKey)) {
            throw knownError(store.raceConstraint)
          }
          const row = { ...data, id: randomUUID(), createdAt: now }
          current().returns.push(row)
          return { id: row.id }
        },
      },
      saleReturnItem: {
        async groupBy({ where }: Row) {
          return where.saleItemId.in.map((saleItemId: string) => ({
            saleItemId,
            _sum: {
              quantity: current().returnItems
                .filter((item) => item.accountId === where.accountId && item.saleId === where.saleId && item.saleItemId === saleItemId)
                .reduce((total, item) => total + item.quantity, 0),
            },
          }))
        },
        async create({ data }: Row) {
          if (store.failAt === 'returnItem') throw new Error('private return item failure')
          const row = { ...data, id: randomUUID(), createdAt: now }
          current().returnItems.push(row)
          return { id: row.id }
        },
      },
      inventoryMovement: {
        async create({ data }: Row) {
          if (store.failAt === 'movement') throw new Error('private movement failure')
          const row = { ...data, id: randomUUID(), createdAt: now }
          current().movements.push(row)
          return { id: row.id }
        },
      },
      productVariant: {
        async updateMany({ where, data }: Row) {
          if (store.failAt === 'stock') return { count: 0 }
          const row = current().variants.get(where.id)
          if (!row || row.accountId !== where.accountId || row.currentStock > where.currentStock.lte) return { count: 0 }
          row.currentStock += data.currentStock.increment
          return { count: 1 }
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
          return row?.accountId === values[1] ? [{ ...row, processorName: `${row.firstName} ${row.lastName}`.trim() }] : []
        }
        if (sql.sql.includes('FROM "SaleItem"')) {
          const ids = values.slice(2)
          store.locks.push({ kind: 'SaleItem', ids })
          return ids.map((id) => current().saleItems.get(id))
            .filter((row) => row?.accountId === values[0] && row?.saleId === values[1]).map((row) => ({ ...row }))
        }
        if (sql.sql.includes('FROM "ProductVariant"')) {
          const ids = values.slice(1)
          store.locks.push({ kind: 'Variant', ids })
          return ids.map((id) => current().variants.get(id))
            .filter((row): row is Row => row?.accountId === values[0]).map((row) => ({ id: row.id, currentStock: row.currentStock }))
        }
        store.locks.push({ kind: 'Sale', ids: [values[0]] })
        const row = current().sales.get(values[0])
        return row?.accountId === values[1] ? [{ id: row.id, status: row.status }] : []
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

const input = (quantity = 2, reason: string | null = 'Customer return'): ReturnInput => ({
  reason,
  items: [{ saleItemId: itemA, quantity }],
})

describe('Return input and canonical fingerprint', () => {
  test('requires one UUID header and validates the route Sale ID', () => {
    assert.throws(() => parseReturnIdempotencyKey({}, []), (error) => expectHttp(error, 400, 'RETURN_IDEMPOTENCY_KEY_REQUIRED'))
    assert.throws(() => parseReturnIdempotencyKey({ 'idempotency-key': 'bad' }, ['Idempotency-Key', 'bad']), (error) => expectHttp(error, 400, 'RETURN_IDEMPOTENCY_KEY_INVALID'))
    assert.throws(() => parseReturnIdempotencyKey({ 'idempotency-key': key }, ['Idempotency-Key', key, 'idempotency-key', key]), (error) => expectHttp(error, 400, 'RETURN_IDEMPOTENCY_KEY_INVALID'))
    assert.equal(parseReturnIdempotencyKey({ 'idempotency-key': key.toUpperCase() }, ['Idempotency-Key', key]), key)
    assert.equal(parseReturnSaleId(saleA.toUpperCase()), saleA)
    assert.throws(() => parseReturnSaleId('bad'), (error) => expectHttp(error, 422, 'INVALID_RETURN_SALE_ID'))
  })

  test('enforces strict, bounded, nonempty, duplicate-free items', () => {
    assert.throws(() => parseReturnInput({ items: [] }), (error) => expectHttp(error, 422, 'RETURN_ITEMS_EMPTY'))
    assert.throws(() => parseReturnInput({ items: Array.from({ length: maxReturnLines + 1 }, () => ({ saleItemId: randomUUID(), quantity: 1 })) }), (error) => expectHttp(error, 422, 'RETURN_ITEMS_TOO_LARGE'))
    assert.throws(() => parseReturnInput({ items: [{ saleItemId: itemA, quantity: 1 }, { saleItemId: itemA, quantity: 2 }] }), (error) => expectHttp(error, 422, 'RETURN_DUPLICATE_SALE_ITEM'))
    for (const quantity of [0, -1, 1.5, 1_000_001, '1']) {
      assert.throws(() => parseReturnInput({ items: [{ saleItemId: itemA, quantity }] }), (error) => expectHttp(error, 422, 'INVALID_RETURN_QUANTITY'))
    }
    assert.throws(() => parseReturnInput({ items: [{ saleItemId: 'bad', quantity: 1 }] }), (error) => expectHttp(error, 422, 'INVALID_RETURN_SALE_ITEM_ID'))
  })

  test('rejects unknown and privileged fields at both levels', () => {
    for (const field of ['accountId', 'processedById', 'saleId', 'refundAmount', 'requestFingerprint', 'idempotencyKey', 'currentStock']) {
      assert.throws(() => parseReturnInput({ items: [{ saleItemId: itemA, quantity: 1 }], [field]: 'forged' }), (error) => expectHttp(error, 422, 'INVALID_RETURN_INPUT'))
    }
    for (const field of ['variantId', 'refundAmount', 'unitCost', 'quantityChange', 'returnItemId']) {
      assert.throws(() => parseReturnInput({ items: [{ saleItemId: itemA, quantity: 1, [field]: 'forged' }] }), (error) => expectHttp(error, 422, 'INVALID_RETURN_ITEM'))
    }
  })

  test('normalizes reason with trim/NFC/null and enforces character length', () => {
    assert.equal(parseReturnInput({ reason: '  Cafe\u0301  ', items: [{ saleItemId: itemA, quantity: 1 }] }).reason, 'Café')
    assert.equal(parseReturnInput({ reason: '   ', items: [{ saleItemId: itemA, quantity: 1 }] }).reason, null)
    assert.equal(parseReturnInput({ reason: null, items: [{ saleItemId: itemA, quantity: 1 }] }).reason, null)
    assert.throws(() => parseReturnInput({ reason: 'x'.repeat(maxReturnReasonCharacters + 1), items: [{ saleItemId: itemA, quantity: 1 }] }), (error) => expectHttp(error, 422, 'INVALID_RETURN_REASON'))
    assert.throws(() => parseReturnInput({ reason: 7, items: [{ saleItemId: itemA, quantity: 1 }] }), (error) => expectHttp(error, 422, 'INVALID_RETURN_REASON'))
  })

  test('fingerprint is lowercase SHA-256 over normalized semantic order and actor/tenant/Sale', () => {
    const a = parseReturnInput({ reason: ' Cafe\u0301 ', items: [{ saleItemId: itemB, quantity: 1 }, { saleItemId: itemA, quantity: 2 }] })
    const b = parseReturnInput({ reason: 'Café', items: [{ saleItemId: itemA, quantity: 2 }, { saleItemId: itemB, quantity: 1 }] })
    assert.deepEqual(canonicalReturnItems(a.items), canonicalReturnItems(b.items))
    const fingerprint = returnFingerprint(accountA, ownerA, saleA, a)
    assert.match(fingerprint, /^[0-9a-f]{64}$/)
    assert.equal(fingerprint, returnFingerprint(accountA, ownerA, saleA, b))
    assert.notEqual(fingerprint, returnFingerprint(accountA, warehouseA, saleA, b))
    assert.notEqual(fingerprint, returnFingerprint(accountA, ownerA, saleB, b))
    assert.notEqual(fingerprint, returnFingerprint(accountB, ownerA, saleA, b))
  })
})

describe('Return transaction service', () => {
  test('creates a historical-price/cost Return, restores stock, and preserves actor/privacy', async () => {
    const store = new ReturnDouble()
    const result = await createReturnDependencies(store.asClient()).createReturn(accountA, ownerA, saleA, key, input())
    assert.equal(result.idempotentReplay, false)
    assert.equal(result.return.totalRefund, '25.00')
    assert.equal(result.return.items[0].refundAmount, '25.00')
    assert.equal(result.return.items[0].productName, 'Historical Tee')
    assert.deepEqual(result.return.processor, { name: 'Ada Owner', employeeCode: null })
    assert.equal(store.state.variants.get(variantA)!.currentStock, 5)
    assert.equal(store.state.sales.get(saleA)!.status, SaleStatus.COMPLETED)
    const movement = store.state.movements[0]
    assert.equal(movement.type, InventoryMovementType.RETURN)
    assert.equal(movement.quantityChange, 2)
    assert.equal(movement.unitCost.toFixed(4), '7.1234')
    assert.equal(movement.performedById, ownerA)
    assert.equal(store.state.returns[0].processedById, ownerA)
    assert.equal(movement.returnItemId, store.state.returnItems[0].id)
    assert.equal(movement.saleItemId, null)
    assert.equal(movement.idempotencyKey, null)
    const json = JSON.stringify(result)
    for (const forbidden of ['unitCostAtSale', 'lastPurchaseCost', 'profit', 'margin', 'currentStock', 'idempotencyKey', 'requestFingerprint']) {
      assert.equal(json.includes(forbidden), false)
    }
  })

  test('uses deterministic Account/User/Sale/SaleItem/Variant lock order and sorted IDs', async () => {
    const store = new ReturnDouble()
    await createReturnDependencies(store.asClient()).createReturn(accountA, ownerA, saleA, key, {
      reason: null, items: [{ saleItemId: itemA, quantity: 1 }, { saleItemId: itemB, quantity: 1 }],
    })
    assert.deepEqual(store.locks.map((lock) => lock.kind), ['Account', 'User', 'Sale', 'SaleItem', 'Variant'])
    assert.deepEqual(store.locks[3].ids, [itemA, itemB].sort())
    assert.deepEqual(store.locks[4].ids, [variantA, variantB].sort())
  })

  test('allows inactive historical Product/Variant without reactivation', async () => {
    const store = new ReturnDouble()
    assert.equal(store.state.variants.get(variantA)!.isActive, false)
    await createReturnDependencies(store.asClient()).createReturn(accountA, warehouseA, saleA, key, input(1))
    assert.equal(store.state.variants.get(variantA)!.isActive, false)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 4)
    assert.equal(store.state.movements[0].performedById, warehouseA)
  })

  test('supports partial repeated Returns and rejects cumulative over-return', async () => {
    const store = new ReturnDouble(); const service = createReturnDependencies(store.asClient())
    await service.createReturn(accountA, ownerA, saleA, randomUUID(), input(2))
    await service.createReturn(accountA, ownerA, saleA, randomUUID(), input(1))
    await assert.rejects(service.createReturn(accountA, ownerA, saleA, randomUUID(), input(3)), (error) => expectHttp(error, 409, 'RETURN_QUANTITY_EXCEEDS_REMAINING'))
    assert.equal(store.state.returnItems.reduce((total, item) => total + item.quantity, 0), 3)
    await service.createReturn(accountA, ownerA, saleA, randomUUID(), input(2))
    assert.equal(store.state.returnItems.reduce((total, item) => total + item.quantity, 0), 5)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 8)
  })

  test('rejects a whole multi-line Return when one line is exhausted', async () => {
    const store = new ReturnDouble(); const service = createReturnDependencies(store.asClient())
    await service.createReturn(accountA, ownerA, saleA, randomUUID(), { reason: null, items: [{ saleItemId: itemB, quantity: 2 }] })
    const before = store.state.variants.get(variantA)!.currentStock
    const counts = [store.state.returns.length, store.state.returnItems.length, store.state.movements.length]
    await assert.rejects(service.createReturn(accountA, ownerA, saleA, randomUUID(), {
      reason: null, items: [{ saleItemId: itemA, quantity: 2 }, { saleItemId: itemB, quantity: 1 }],
    }), (error) => expectHttp(error, 409, 'RETURN_QUANTITY_EXCEEDS_REMAINING'))
    assert.equal(store.state.variants.get(variantA)!.currentStock, before)
    assert.deepEqual([store.state.returns.length, store.state.returnItems.length, store.state.movements.length], counts)
  })

  test('hides foreign/wrong-Sale items and foreign Sales, and rejects VOIDED Sales', async () => {
    const foreignSale = new ReturnDouble()
    await assert.rejects(createReturnDependencies(foreignSale.asClient()).createReturn(accountA, ownerA, saleOther, key, input()), (error) => expectHttp(error, 404, 'RETURN_SALE_NOT_FOUND'))
    for (const saleItemId of [itemOther, itemA]) {
      const store = new ReturnDouble()
      const routeSale = saleItemId === itemA ? saleB : saleA
      await assert.rejects(createReturnDependencies(store.asClient()).createReturn(accountA, ownerA, routeSale, key, { reason: null, items: [{ saleItemId, quantity: 1 }] }), (error) => expectHttp(error, 404, 'RETURN_SALE_ITEM_UNAVAILABLE'))
    }
    const voided = new ReturnDouble(); voided.state.sales.get(saleA)!.status = SaleStatus.VOIDED
    await assert.rejects(createReturnDependencies(voided.asClient()).createReturn(accountA, ownerA, saleA, key, input()), (error) => expectHttp(error, 409, 'RETURN_SALE_NOT_RETURNABLE'))
  })

  test('rechecks active tenant processor role inside the transaction', async () => {
    for (const change of [{ isActive: false }, { role: UserRole.SUPER_ADMIN }, { accountId: accountB }]) {
      const store = new ReturnDouble(); Object.assign(store.state.users.get(ownerA)!, change)
      await assert.rejects(createReturnDependencies(store.asClient()).createReturn(accountA, ownerA, saleA, key, input()), (error) => expectHttp(error, 403, 'RETURN_PROCESSOR_UNAVAILABLE'))
      assert.equal(store.state.returns.length, 0)
    }
  })

  test('rejects stock overflow without any Return mutation', async () => {
    const store = new ReturnDouble(); store.state.variants.get(variantA)!.currentStock = 2_147_483_647
    await assert.rejects(createReturnDependencies(store.asClient()).createReturn(accountA, ownerA, saleA, key, input(1)), (error) => expectHttp(error, 409, 'INVENTORY_STOCK_OVERFLOW'))
    assert.equal(store.state.returns.length, 0); assert.equal(store.state.returnItems.length, 0); assert.equal(store.state.movements.length, 0)
  })

  test('rolls back header, items, movements, and stock on each forced write failure', async () => {
    for (const failAt of ['returnItem', 'movement', 'stock'] as const) {
      const store = new ReturnDouble(); store.failAt = failAt
      const before = store.state.variants.get(variantA)!.currentStock
      await assert.rejects(createReturnDependencies(store.asClient()).createReturn(accountA, ownerA, saleA, key, input()), (error) => expectHttp(error, failAt === 'stock' ? 409 : 503, failAt === 'stock' ? 'INVENTORY_STOCK_OVERFLOW' : 'RETURN_UNAVAILABLE'))
      assert.equal(store.state.variants.get(variantA)!.currentStock, before)
      assert.equal(store.state.returns.length, 0); assert.equal(store.state.returnItems.length, 0); assert.equal(store.state.movements.length, 0)
    }
  })

  test('replays identical semantics once and conflicts for changed quantity/reason/Sale/actor', async () => {
    const store = new ReturnDouble(); const service = createReturnDependencies(store.asClient())
    const first = await service.createReturn(accountA, ownerA, saleA, key, input())
    const replayed = await service.createReturn(accountA, ownerA, saleA, key, input())
    assert.equal(first.return.id, replayed.return.id); assert.equal(replayed.idempotentReplay, true)
    assert.equal(store.state.returns.length, 1); assert.equal(store.state.movements.length, 1); assert.equal(store.state.variants.get(variantA)!.currentStock, 5)
    for (const operation of [
      () => service.createReturn(accountA, ownerA, saleA, key, input(1)),
      () => service.createReturn(accountA, ownerA, saleA, key, input(2, 'Other')),
      () => service.createReturn(accountA, ownerA, saleB, key, input()),
      () => service.createReturn(accountA, warehouseA, saleA, key, input()),
    ]) await assert.rejects(operation(), (error) => expectHttp(error, 409, 'RETURN_IDEMPOTENCY_CONFLICT'))
  })

  test('replays equivalent item order and normalized reason while tenant keys stay independent', async () => {
    const store = new ReturnDouble(); const service = createReturnDependencies(store.asClient())
    const firstInput = parseReturnInput({ reason: ' Cafe\u0301 ', items: [{ saleItemId: itemB, quantity: 1 }, { saleItemId: itemA, quantity: 1 }] })
    const secondInput = parseReturnInput({ reason: 'Café', items: [{ saleItemId: itemA, quantity: 1 }, { saleItemId: itemB, quantity: 1 }] })
    await service.createReturn(accountA, ownerA, saleA, key, firstInput)
    assert.equal((await service.createReturn(accountA, ownerA, saleA, key, secondInput)).idempotentReplay, true)
    const foreignInput = { reason: null, items: [{ saleItemId: itemOther, quantity: 1 }] }
    assert.equal((await service.createReturn(accountB, ownerB, saleOther, key, foreignInput)).idempotentReplay, false)
    assert.equal(store.state.returns.length, 2)
  })

  test('recovers only the Return idempotency unique race after rollback', async () => {
    const same = new ReturnDouble(); same.raceWinner = 'same'
    const replayed = await createReturnDependencies(same.asClient()).createReturn(accountA, ownerA, saleA, key, input())
    assert.equal(replayed.idempotentReplay, true); assert.equal(same.state.returns.length, 1); assert.equal(same.state.movements.length, 1)
    const different = new ReturnDouble(); different.raceWinner = 'different'
    await assert.rejects(createReturnDependencies(different.asClient()).createReturn(accountA, ownerA, saleA, key, input()), (error) => expectHttp(error, 409, 'RETURN_IDEMPOTENCY_CONFLICT'))
    const unrelated = new ReturnDouble(); unrelated.raceWinner = 'same'; unrelated.raceConstraint = 'Other_unique_key'
    await assert.rejects(createReturnDependencies(unrelated.asClient()).createReturn(accountA, ownerA, saleA, key, input()), (error) => expectHttp(error, 503, 'RETURN_UNAVAILABLE'))
  })

  test('serializes logical concurrent over-return so only one competing Return succeeds', async () => {
    const store = new ReturnDouble(); const service = createReturnDependencies(store.asClient())
    const outcomes = await Promise.allSettled([
      service.createReturn(accountA, ownerA, saleA, randomUUID(), input(3)),
      service.createReturn(accountA, warehouseA, saleA, randomUUID(), input(3)),
    ])
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
    assert.equal(store.state.returnItems.reduce((total, item) => total + item.quantity, 0), 3)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 6)
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

async function withServer(role: UserRole, returns: ReturnDependencies, run: (base: string) => Promise<void>) {
  const sales = {} as SaleDependencies
  const app = express()
  app.use(express.json())
  app.use('/api/sales', createSaleRouter(auth(role), sales, returns))
  app.use(errorHandler)
  const server = app.listen(0)
  try {
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('Return route authorization and status', () => {
  test('allows OWNER and WAREHOUSE with 201/200 and rejects SUPER_ADMIN', async () => {
    for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
      const store = new ReturnDouble()
      await withServer(role, createReturnDependencies(store.asClient()), async (base) => {
        const options = {
          method: 'POST',
          headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify(input()),
        }
        assert.equal((await fetch(`${base}/api/sales/${saleA}/returns`, options)).status, 201)
        assert.equal((await fetch(`${base}/api/sales/${saleA}/returns`, options)).status, 200)
      })
    }
    const forbidden: ReturnDependencies = { async createReturn() { throw Error('must not run') } }
    await withServer(UserRole.SUPER_ADMIN, forbidden, async (base) => {
      const response = await fetch(`${base}/api/sales/${saleA}/returns`, {
        method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input()),
      })
      assert.equal(response.status, 403)
    })
  })

  test('returns safe validation errors without invoking the service', async () => {
    const unused: ReturnDependencies = { async createReturn() { throw Error('must not run') } }
    await withServer(UserRole.OWNER, unused, async (base) => {
      const common = { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify(input()) }
      const missing = await fetch(`${base}/api/sales/${saleA}/returns`, common)
      assert.equal(missing.status, 400); assert.equal((await missing.json() as Row).error.code, 'RETURN_IDEMPOTENCY_KEY_REQUIRED')
      const malformed = await fetch(`${base}/api/sales/not-a-uuid/returns`, { ...common, headers: { ...common.headers, 'Idempotency-Key': key } })
      assert.equal(malformed.status, 422); assert.equal((await malformed.json() as Row).error.code, 'INVALID_RETURN_SALE_ID')
    })
  })
})
