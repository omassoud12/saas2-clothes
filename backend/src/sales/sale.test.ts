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
import { createSaleRouter } from './sale.routes.js'
import { canonicalSaleItems, encodeSaleCursor, maxSaleLines, parseSaleHistoryQuery, parseSaleId, parseSaleIdempotencyKey, parseSaleInput, saleFingerprint } from './sale.schemas.js'
import { createSaleDependencies, createSaleInTransaction } from './sale.service.js'
import type { SaleDependencies, SaleInput, SaleTransaction } from './sale.types.js'
import type { ReturnDependencies } from '../returns/return.types.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const ownerA = '33333333-3333-4333-8333-333333333333'
const warehouseA = '44444444-4444-4444-8444-444444444444'
const ownerB = '55555555-5555-4555-8555-555555555555'
const productA = '66666666-6666-4666-8666-666666666666'
const productB = '77777777-7777-4777-8777-777777777777'
const productOther = '88888888-8888-4888-8888-888888888888'
const variantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const variantB = '99999999-9999-4999-8999-999999999999'
const variantOther = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const categoryA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const categoryB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const key = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const categoryOther = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const now = new Date('2026-09-23T00:00:00.000Z')
const saleA = '10000000-0000-4000-8000-000000000001'
const saleB = '20000000-0000-4000-8000-000000000002'
const saleOther = '30000000-0000-4000-8000-000000000003'

type Row = Record<string, any>
type State = {
  accounts: Map<string, Row>; users: Map<string, Row>; categories: Map<string, Row>
  products: Map<string, Row>; variants: Map<string, Row>; sales: Row[]; items: Row[]; movements: Row[]
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

class SaleDouble {
  state: State = {
    accounts: new Map([
      [accountA, { id: accountA, baseCurrency: 'USD' }],
      [accountB, { id: accountB, baseCurrency: 'LBP' }],
    ]),
    users: new Map([
      [ownerA, { id: ownerA, accountId: accountA, firstName: 'Ada', lastName: 'Owner', employeeCode: null, role: UserRole.OWNER, isActive: true }],
      [warehouseA, { id: warehouseA, accountId: accountA, firstName: 'Will', lastName: 'Stock', employeeCode: 'W-1', role: UserRole.WAREHOUSE, isActive: true }],
      [ownerB, { id: ownerB, accountId: accountB, firstName: 'Bea', lastName: 'Owner', employeeCode: null, role: UserRole.OWNER, isActive: true }],
    ]),
    categories: new Map([
      [categoryA, { id: categoryA, accountId: accountA, name: 'Shirts' }],
      [categoryB, { id: categoryB, accountId: accountA, name: 'Jeans' }],
      [categoryOther, { id: categoryOther, accountId: accountB, name: 'Other Category' }],
    ]),
    products: new Map([
      [productA, { id: productA, accountId: accountA, categoryId: categoryA, name: 'Tee', isActive: true }],
      [productB, { id: productB, accountId: accountA, categoryId: categoryB, name: 'Denim', isActive: true }],
      [productOther, { id: productOther, accountId: accountB, categoryId: categoryOther, name: 'Other', isActive: true }],
    ]),
    variants: new Map([
      [variantA, { id: variantA, accountId: accountA, productId: productA, sku: 'TEE-M', color: 'Black', size: 'M', sellingPrice: new Prisma.Decimal('30.00'), lastPurchaseCost: new Prisma.Decimal('12.3456'), currentStock: 10, isActive: true }],
      [variantB, { id: variantB, accountId: accountA, productId: productB, sku: 'DENIM-L', color: 'Blue', size: 'L', sellingPrice: new Prisma.Decimal('20.00'), lastPurchaseCost: new Prisma.Decimal('8.0000'), currentStock: 5, isActive: true }],
      [variantOther, { id: variantOther, accountId: accountB, productId: productOther, sku: 'OTHER', color: null, size: null, sellingPrice: null, lastPurchaseCost: new Prisma.Decimal('1.0000'), currentStock: 5, isActive: true }],
    ]),
    sales: [], items: [], movements: [],
  }
  readonly locks: { kind: string; ids: string[] }[] = []
  failAt: 'saleItem' | 'stock' | 'movement' | null = null
  raceWinner: 'same' | 'different' | null = null
  raceConstraint = 'Sale_accountId_idempotencyKey_key'
  transactionOpenCount = 0
  private tail: Promise<void> = Promise.resolve()

  private snapshot(): State {
    return {
      accounts: new Map([...this.state.accounts].map(([k, v]) => [k, { ...v }])),
      users: new Map([...this.state.users].map(([k, v]) => [k, { ...v }])),
      categories: new Map([...this.state.categories].map(([k, v]) => [k, { ...v }])),
      products: new Map([...this.state.products].map(([k, v]) => [k, { ...v }])),
      variants: new Map([...this.state.variants].map(([k, v]) => [k, { ...v }])),
      sales: this.state.sales.map((v) => ({ ...v })), items: this.state.items.map((v) => ({ ...v })), movements: this.state.movements.map((v) => ({ ...v })),
    }
  }

  private client(state: State, transactional: boolean): PrismaClient {
    const store = this
    const current = () => transactional ? state : store.state
    const persisted = (sale: Row) => ({ ...sale, items: current().items.filter((item) => item.saleId === sale.id).sort((a, b) => a.id.localeCompare(b.id)) })
    return {
      sale: {
        async findUnique({ where }: Row) {
          const idKey = where.id_accountId
          const idempotency = where.accountId_idempotencyKey
          const sale = idKey
            ? current().sales.find((row) => row.id === idKey.id && row.accountId === idKey.accountId)
            : current().sales.find((row) => row.accountId === idempotency.accountId && row.idempotencyKey === idempotency.idempotencyKey)
          return sale ? persisted(sale) : null
        },
        async create({ data }: Row) {
          if (store.raceWinner) {
            const kind = store.raceWinner; store.raceWinner = null
            store.state.sales.push({ ...data, id: randomUUID(), requestFingerprint: kind === 'same' ? data.requestFingerprint : 'f'.repeat(64), createdAt: now })
            throw knownError(store.raceConstraint)
          }
          if (current().sales.some((row) => row.accountId === data.accountId && row.idempotencyKey === data.idempotencyKey)) throw knownError(store.raceConstraint)
          const row = { ...data, id: randomUUID(), createdAt: now }
          current().sales.push(row)
          return { id: row.id }
        },
      },
      saleItem: {
        async create({ data }: Row) {
          if (store.failAt === 'saleItem') throw new Error('private failure')
          const row = { ...data, id: randomUUID(), createdAt: now }
          current().items.push(row)
          return { id: row.id }
        },
      },
      inventoryMovement: {
        async create({ data }: Row) {
          if (store.failAt === 'movement') throw new Error('private failure')
          const row = { ...data, id: randomUUID(), createdAt: now }
          current().movements.push(row)
          return { id: row.id }
        },
      },
      category: {
        async findMany({ where }: Row) {
          return where.id.in.map((id: string) => current().categories.get(id)).filter((row: Row | undefined) => row?.accountId === where.accountId).map((row: Row) => ({ id: row.id, name: row.name }))
        },
      },
      productVariant: {
        async findMany({ where }: Row) {
          return where.id.in.map((id: string) => current().variants.get(id)).filter((row: Row | undefined) => row?.accountId === where.accountId).map((row: Row) => ({ id: row.id, productId: row.productId }))
        },
        async updateMany({ where, data }: Row) {
          if (store.failAt === 'stock') return { count: 0 }
          const row = current().variants.get(where.id)
          if (!row || row.accountId !== where.accountId || row.productId !== where.productId || row.currentStock < where.currentStock.gte) return { count: 0 }
          row.currentStock -= data.currentStock.decrement
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
          const row = current().users.get(values[0]); return row?.accountId === values[1] ? [{ ...row, sellerName: `${row.firstName} ${row.lastName}`.trim() }] : []
        }
        const ids = values.slice(1)
        if (sql.sql.includes('FROM "ProductVariant"')) {
          store.locks.push({ kind: 'Variant', ids })
          return ids.map((id) => current().variants.get(id)).filter((row) => row?.accountId === values[0]).map((row) => ({ ...row }))
        }
        store.locks.push({ kind: 'Product', ids })
        return ids.map((id) => current().products.get(id)).filter((row) => row?.accountId === values[0]).map((row) => ({ ...row }))
      },
      async $transaction<T>(callback: (tx: PrismaClient) => Promise<T>): Promise<T> {
        assert.equal(transactional, false)
        store.transactionOpenCount += 1
        let release!: () => void
        const previous = store.tail
        store.tail = new Promise<void>((resolve) => { release = resolve })
        await previous
        try {
          const staged = store.snapshot()
          const result = await callback(store.client(staged, true))
          store.state = staged
          return result
        } finally { release() }
      },
    } as unknown as PrismaClient
  }

  asClient(): PrismaClient { return this.client(this.state, false) }
}

class HistoryDouble {
  readonly currentCatalog = { sellerName: 'New Seller', productName: 'New Product', sku: 'NEW-SKU' }
  readonly sales: Row[] = [
    {
      id: saleA, accountId: accountA, soldById: ownerA, status: SaleStatus.COMPLETED,
      currency: 'USD', subtotal: new Prisma.Decimal('60.00'), totalAmount: new Prisma.Decimal('60.00'),
      createdAt: new Date('2026-09-22T12:00:00.000Z'), sellerNameAtSale: 'Old Seller', sellerCodeAtSale: 'OLD-1',
      voidedAt: null, voidedByName: null, voidedByCode: null, voidReason: null,
    },
    {
      id: saleB, accountId: accountA, soldById: warehouseA, status: SaleStatus.VOIDED,
      currency: 'USD', subtotal: new Prisma.Decimal('16.00'), totalAmount: new Prisma.Decimal('16.00'),
      createdAt: new Date('2026-09-22T12:00:00.000Z'), sellerNameAtSale: 'Warehouse Snapshot', sellerCodeAtSale: null,
      voidedAt: new Date('2026-09-23T08:00:00.000Z'), voidedByName: 'Owner Snapshot', voidedByCode: 'OWN-1', voidReason: 'Duplicate sale',
    },
    {
      id: saleOther, accountId: accountB, soldById: ownerB, status: SaleStatus.COMPLETED,
      currency: 'LBP', subtotal: new Prisma.Decimal('999.00'), totalAmount: new Prisma.Decimal('999.00'),
      createdAt: new Date('2026-09-23T12:00:00.000Z'), sellerNameAtSale: 'Foreign Seller', sellerCodeAtSale: null,
      voidedAt: null, voidedByName: null, voidedByCode: null, voidReason: null,
    },
  ]
  readonly items: Row[] = [
    {
      id: '40000000-0000-4000-8000-000000000001', accountId: accountA, saleId: saleA,
      productId: productA, variantId: variantA, productNameAtSale: 'Old Product', categoryNameAtSale: 'Old Category',
      skuAtSale: 'OLD-SKU', colorAtSale: 'Black', sizeAtSale: 'M', quantity: 2,
      unitSoldPrice: new Prisma.Decimal('30.00'), unitCostAtSale: new Prisma.Decimal('12.3456'), lineTotal: new Prisma.Decimal('60.00'),
    },
    {
      id: '40000000-0000-4000-8000-000000000002', accountId: accountA, saleId: saleB,
      productId: productA, variantId: variantA, productNameAtSale: 'Second Product', categoryNameAtSale: 'Old Category',
      skuAtSale: 'SECOND-SKU', colorAtSale: null, sizeAtSale: null, quantity: 2,
      unitSoldPrice: new Prisma.Decimal('5.00'), unitCostAtSale: new Prisma.Decimal('2.0000'), lineTotal: new Prisma.Decimal('10.00'),
    },
    {
      id: '40000000-0000-4000-8000-000000000003', accountId: accountA, saleId: saleB,
      productId: productB, variantId: variantB, productNameAtSale: 'Third Product', categoryNameAtSale: 'Old Category',
      skuAtSale: 'THIRD-SKU', colorAtSale: 'Blue', sizeAtSale: 'L', quantity: 3,
      unitSoldPrice: new Prisma.Decimal('2.00'), unitCostAtSale: new Prisma.Decimal('1.0000'), lineTotal: new Prisma.Decimal('6.00'),
    },
  ]
  readonly returns: Row[] = []
  readonly returnItems: Row[] = []
  readonly exchanges: Row[] = []
  groupQueries = 0

  asClient(): PrismaClient {
    const store = this
    return {
      sale: {
        async findMany({ where, take }: Row) {
          let rows = store.sales.filter((sale) => sale.accountId === where.accountId)
          if (where.status) rows = rows.filter((sale) => sale.status === where.status)
          if (where.soldById) rows = rows.filter((sale) => sale.soldById === where.soldById)
          if (where.createdAt?.gte) rows = rows.filter((sale) => sale.createdAt >= where.createdAt.gte)
          if (where.createdAt?.lte) rows = rows.filter((sale) => sale.createdAt <= where.createdAt.lte)
          if (where.OR) {
            const before = where.OR[0].createdAt.lt as Date
            const cursorId = where.OR[1].id.lt as string
            rows = rows.filter((sale) => sale.createdAt < before || (sale.createdAt.getTime() === before.getTime() && sale.id < cursorId))
          }
          return rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
            .slice(0, take).map((sale) => ({ ...sale, _count: { items: store.items.filter((item) => item.saleId === sale.id && item.accountId === sale.accountId).length } }))
        },
        async findUnique({ where }: Row) {
          const key = where.id_accountId
          const sale = store.sales.find((candidate) => candidate.id === key.id && candidate.accountId === key.accountId)
          return sale ? { ...sale, items: store.items.filter((item) => item.saleId === sale.id && item.accountId === sale.accountId).sort((a, b) => a.id.localeCompare(b.id)) } : null
        },
      },
      saleItem: {
        async groupBy({ where }: Row) {
          store.groupQueries += 1
          return where.saleId.in.map((id: string) => ({
            saleId: id,
            _sum: { quantity: store.items.filter((item) => item.accountId === where.accountId && item.saleId === id).reduce((sum, item) => sum + item.quantity, 0) },
          }))
        },
      },
      saleReturn: {
        async count({ where }: Row) {
          return store.returns.filter((row) => row.accountId === where.accountId && row.saleId === where.saleId).length
        },
      },
      saleReturnItem: {
        async groupBy({ where }: Row) {
          const relevant = store.returnItems.filter((row) => row.accountId === where.accountId && row.saleId === where.saleId)
          const byItem = new Map<string, Row[]>()
          for (const row of relevant) byItem.set(row.saleItemId, [...(byItem.get(row.saleItemId) ?? []), row])
          return [...byItem].map(([saleItemId, rows]) => ({
            saleItemId,
            _sum: {
              quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
              refundAmount: rows.reduce((sum, row) => sum.add(row.refundAmount), new Prisma.Decimal(0)),
            },
          }))
        },
      },
      exchange: {
        async count({ where }: Row) {
          return store.exchanges.filter((row) => row.accountId === where.accountId &&
            row.originalSaleId === where.saleReturn.saleId).length
        },
        async findFirst({ where }: Row) {
          return store.exchanges.find((row) => row.accountId === where.accountId && row.newSaleId === where.newSaleId) ?? null
        },
      },
    } as unknown as PrismaClient
  }
}

const ownerInput = (price = '27.00'): SaleInput => ({ items: [{ variantId: variantA, quantity: 3, unitSoldPrice: price }] })

describe('Sale input and fingerprint', () => {
  test('requires one UUID idempotency header and a strict bounded cart', () => {
    assert.throws(() => parseSaleIdempotencyKey({}, []), (e) => expectHttp(e, 400, 'SALE_IDEMPOTENCY_KEY_REQUIRED'))
    assert.throws(() => parseSaleIdempotencyKey({ 'idempotency-key': 'bad' }, ['Idempotency-Key', 'bad']), (e) => expectHttp(e, 400, 'SALE_IDEMPOTENCY_KEY_INVALID'))
    assert.equal(parseSaleIdempotencyKey({ 'idempotency-key': key.toUpperCase() }, ['Idempotency-Key', key]), key)
    assert.throws(() => parseSaleInput({ items: [] }), (e) => expectHttp(e, 422, 'SALE_CART_EMPTY'))
    assert.throws(() => parseSaleInput({ items: Array.from({ length: maxSaleLines + 1 }, () => ownerInput().items[0]) }), (e) => expectHttp(e, 422, 'SALE_CART_TOO_LARGE'))
    assert.throws(() => parseSaleInput({ items: [ownerInput().items[0], ownerInput().items[0]] }), (e) => expectHttp(e, 422, 'SALE_DUPLICATE_VARIANT'))
  })

  test('rejects privileged fields, malformed quantities, prices, and IDs', () => {
    for (const field of ['accountId','soldById','currency','subtotal','status','requestFingerprint','idempotencyKey','currentStock','unitCostAtSale']) {
      assert.throws(() => parseSaleInput({ items: ownerInput().items, [field]: 'forged' }), (e) => expectHttp(e, 422, 'INVALID_SALE_INPUT'))
    }
    for (const quantity of [0,-1,1.5,1_000_001,'3']) assert.throws(() => parseSaleInput({ items: [{ ...ownerInput().items[0], quantity }] }), (e) => expectHttp(e, 422, 'INVALID_SALE_QUANTITY'))
    for (const unitSoldPrice of ['0','0.00','-1','1.234','NaN','Infinity','1e2','10000000000000000.00',12.3]) assert.throws(() => parseSaleInput({ items: [{ ...ownerInput().items[0], unitSoldPrice }] }), (e) => expectHttp(e, 422, 'INVALID_SALE_PRICE'))
    assert.throws(() => parseSaleInput({ items: [{ ...ownerInput().items[0], variantId: 'bad' }] }), (e) => expectHttp(e, 422, 'INVALID_SALE_VARIANT_ID'))
  })

  test('normalizes prices and order into one semantic fingerprint', () => {
    const a = parseSaleInput({ items: [{ variantId: variantA, quantity: 1, unitSoldPrice: '12.3' }, { variantId: variantB, quantity: 2, unitSoldPrice: '20' }] })
    const b = parseSaleInput({ items: [{ variantId: variantB, quantity: 2, unitSoldPrice: '20.00' }, { variantId: variantA, quantity: 1, unitSoldPrice: '12.30' }] })
    assert.deepEqual(canonicalSaleItems(a.items), canonicalSaleItems(b.items))
    assert.equal(saleFingerprint(accountA, ownerA, a.items), saleFingerprint(accountA, ownerA, b.items))
    assert.notEqual(saleFingerprint(accountA, ownerA, a.items), saleFingerprint(accountA, warehouseA, a.items))
    assert.match(saleFingerprint(accountA, ownerA, a.items), /^[0-9a-f]{64}$/)
  })
})

describe('Sale history validation', () => {
  test('validates bounded filters, dates, identifiers, and limits', () => {
    assert.deepEqual(parseSaleHistoryQuery({}), { limit: 25 })
    const parsed = parseSaleHistoryQuery({ status: 'VOIDED', soldById: ownerA, from: '2026-09-01T00:00:00Z', to: '2026-09-30T23:59:59.999Z', limit: '100' })
    assert.equal(parsed.status, SaleStatus.VOIDED); assert.equal(parsed.soldById, ownerA); assert.equal(parsed.limit, 100)
    assert.equal(parsed.from!.toISOString(), '2026-09-01T00:00:00.000Z'); assert.equal(parsed.to!.toISOString(), '2026-09-30T23:59:59.999Z')
    for (const query of [
      { status: 'RETURNED' }, { soldById: 'bad' }, { from: '2026-09-01' },
      { from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' },
      { limit: '0' }, { limit: '101' }, { limit: '1.5' }, { accountId: accountA },
    ]) assert.throws(() => parseSaleHistoryQuery(query), (e) => expectHttp(e, 422, 'INVALID_SALE_FILTER'))
    assert.equal(parseSaleId(saleA), saleA)
    assert.throws(() => parseSaleId('bad'), (e) => expectHttp(e, 422, 'INVALID_SALE_ID'))
  })

  test('round-trips a stable two-field cursor and rejects malformed cursors', () => {
    const cursor = encodeSaleCursor(now, saleA)
    assert.deepEqual(parseSaleHistoryQuery({ cursor }).cursor, { createdAt: now, id: saleA })
    for (const invalid of ['bad!', Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ createdAt: now.toISOString(), id: 'bad' })).toString('base64url')]) {
      assert.throws(() => parseSaleHistoryQuery({ cursor: invalid }), (e) => expectHttp(e, 422, 'INVALID_SALE_FILTER'))
    }
  })
})

describe('Sale history service', () => {
  test('lists tenant Sales with snapshot summaries, line counts, unit totals, and no N+1 query', async () => {
    const store = new HistoryDouble()
    const result = await createSaleDependencies(store.asClient()).listSales(accountA, { limit: 25 })
    assert.deepEqual(result.sales.map((sale) => sale.id), [saleB, saleA])
    assert.deepEqual(result.sales.map(({ itemCount, totalUnits }) => ({ itemCount, totalUnits })), [{ itemCount: 2, totalUnits: 5 }, { itemCount: 1, totalUnits: 2 }])
    assert.deepEqual(result.sales[1].seller, { name: 'Old Seller', employeeCode: 'OLD-1' })
    assert.equal(result.nextCursor, null); assert.equal(store.groupQueries, 1)
    const json = JSON.stringify(result)
    for (const secret of ['unitCostAtSale','totalCOGS','grossProfit','idempotencyKey','requestFingerprint']) assert.equal(json.includes(secret), false)
    assert.deepEqual(await createSaleDependencies(store.asClient()).listSales('99999999-0000-4000-8000-000000000009', { limit: 25 }), { sales: [], nextCursor: null })
  })

  test('applies status, seller, from, to, and combined date filters inside the tenant', async () => {
    const service = createSaleDependencies(new HistoryDouble().asClient())
    assert.deepEqual((await service.listSales(accountA, { status: SaleStatus.VOIDED, limit: 25 })).sales.map((sale) => sale.id), [saleB])
    assert.deepEqual((await service.listSales(accountA, { soldById: ownerA, limit: 25 })).sales.map((sale) => sale.id), [saleA])
    assert.equal((await service.listSales(accountA, { from: new Date('2026-09-22T12:00:00Z'), limit: 25 })).sales.length, 2)
    assert.equal((await service.listSales(accountA, { to: new Date('2026-09-22T11:59:59Z'), limit: 25 })).sales.length, 0)
    assert.equal((await service.listSales(accountA, { from: new Date('2026-09-22T11:00:00Z'), to: new Date('2026-09-22T13:00:00Z'), limit: 25 })).sales.length, 2)
    assert.equal((await service.listSales(accountA, { soldById: ownerB, limit: 25 })).sales.length, 0)
  })

  test('paginates deterministically across equal createdAt values using id DESC', async () => {
    const service = createSaleDependencies(new HistoryDouble().asClient())
    const first = await service.listSales(accountA, { limit: 1 })
    assert.equal(first.sales[0].id, saleB); assert.ok(first.nextCursor)
    const cursor = parseSaleHistoryQuery({ cursor: first.nextCursor! }).cursor!
    const second = await service.listSales(accountA, { limit: 1, cursor })
    assert.equal(second.sales[0].id, saleA); assert.equal(second.nextCursor, null)
  })

  test('returns stored detail snapshots and Decimal-safe OWNER economics', async () => {
    const store = new HistoryDouble()
    store.currentCatalog.sellerName = 'Renamed Seller'; store.currentCatalog.productName = 'Renamed Product'; store.currentCatalog.sku = 'RENAMED-SKU'
    const result = await createSaleDependencies(store.asClient()).getSale(accountA, UserRole.OWNER, saleA)
    assert.equal(result.sale.seller.name, 'Old Seller'); assert.equal(result.sale.items[0].productName, 'Old Product'); assert.equal(result.sale.items[0].sku, 'OLD-SKU')
    assert.equal(result.sale.void, null)
    assert.deepEqual(result.sale.returnSummary, { hasReturns: false, returnCount: 0, totalReturnedUnits: 0, totalReturnedAmount: '0.00' })
    assert.deepEqual(result.sale.exchangeSummary, { originalExchangeCount: 0, replacementForExchangeId: null })
    assert.deepEqual(result.sale.items[0], { ...result.sale.items[0], returnedQuantity: 0, remainingReturnableQuantity: 2, unitCostAtSale: '12.3456', lineCost: '24.6912', lineGrossProfit: '35.3088' })
    assert.deepEqual(result.sale.economics, { totalCOGS: '24.6912', grossProfit: '35.3088' })
  })

  test('counts multiple original Exchanges and identifies one replacement Exchange without adding list joins', async () => {
    const store = new HistoryDouble()
    const firstId = randomUUID(); const secondId = randomUUID()
    store.exchanges.push(
      { id: firstId, accountId: accountA, originalSaleId: saleA, newSaleId: saleB },
      { id: secondId, accountId: accountA, originalSaleId: saleA, newSaleId: randomUUID() },
      { id: randomUUID(), accountId: accountB, originalSaleId: saleA, newSaleId: saleA },
    )
    const service = createSaleDependencies(store.asClient())
    const original = await service.getSale(accountA, UserRole.WAREHOUSE, saleA)
    assert.deepEqual(original.sale.exchangeSummary, { originalExchangeCount: 2, replacementForExchangeId: null })
    const replacement = await service.getSale(accountA, UserRole.WAREHOUSE, saleB)
    assert.deepEqual(replacement.sale.exchangeSummary, { originalExchangeCount: 0, replacementForExchangeId: firstId })
    assert.equal((await service.listSales(accountA, { limit: 25 })).sales.length, 2)
  })

  test('derives one partial Return from stored ReturnItems', async () => {
    const store = new HistoryDouble()
    store.returns.push({ id: randomUUID(), accountId: accountA, saleId: saleA })
    store.returnItems.push({
      accountId: accountA, saleId: saleA, saleItemId: store.items[0].id,
      quantity: 1, refundAmount: new Prisma.Decimal('30.00'),
    })
    const result = await createSaleDependencies(store.asClient()).getSale(accountA, UserRole.OWNER, saleA)
    assert.deepEqual(result.sale.returnSummary, { hasReturns: true, returnCount: 1, totalReturnedUnits: 1, totalReturnedAmount: '30.00' })
    assert.equal(result.sale.items[0].returnedQuantity, 1)
    assert.equal(result.sale.items[0].remainingReturnableQuantity, 1)
  })

  test('aggregates multiple partial Returns across SaleItems without changing original economics', async () => {
    const store = new HistoryDouble()
    const secondItem = {
      ...store.items[1], id: '40000000-0000-4000-8000-000000000004', saleId: saleA,
      quantity: 3, lineTotal: new Prisma.Decimal('15.00'), unitCostAtSale: new Prisma.Decimal('2.0000'),
    }
    store.items.push(secondItem)
    store.returns.push(
      { id: randomUUID(), accountId: accountA, saleId: saleA },
      { id: randomUUID(), accountId: accountA, saleId: saleA },
    )
    store.returnItems.push(
      { accountId: accountA, saleId: saleA, saleItemId: store.items[0].id, quantity: 1, refundAmount: new Prisma.Decimal('30.00') },
      { accountId: accountA, saleId: saleA, saleItemId: store.items[0].id, quantity: 1, refundAmount: new Prisma.Decimal('30.00') },
      { accountId: accountA, saleId: saleA, saleItemId: secondItem.id, quantity: 2, refundAmount: new Prisma.Decimal('10.00') },
    )
    const result = await createSaleDependencies(store.asClient()).getSale(accountA, UserRole.OWNER, saleA)
    assert.deepEqual(result.sale.returnSummary, { hasReturns: true, returnCount: 2, totalReturnedUnits: 4, totalReturnedAmount: '70.00' })
    assert.deepEqual(result.sale.items.map(({ returnedQuantity, remainingReturnableQuantity }) => ({ returnedQuantity, remainingReturnableQuantity })), [
      { returnedQuantity: 2, remainingReturnableQuantity: 0 },
      { returnedQuantity: 2, remainingReturnableQuantity: 1 },
    ])
    assert.deepEqual(result.sale.economics, { totalCOGS: '30.6912', grossProfit: '29.3088' })
  })

  test('uses stored void snapshots, hides all economics from WAREHOUSE, and tenant-scopes detail', async () => {
    const service = createSaleDependencies(new HistoryDouble().asClient())
    const result = await service.getSale(accountA, UserRole.WAREHOUSE, saleB)
    assert.deepEqual(result.sale.void, { voidedAt: new Date('2026-09-23T08:00:00.000Z'), voidedByName: 'Owner Snapshot', voidedByCode: 'OWN-1', voidReason: 'Duplicate sale' })
    assert.deepEqual(result.sale.returnSummary, { hasReturns: false, returnCount: 0, totalReturnedUnits: 0, totalReturnedAmount: '0.00' })
    const json = JSON.stringify(result)
    for (const secret of ['unitCostAtSale','lineCost','lineGrossProfit','totalCOGS','grossProfit','margin','lastPurchaseCost','idempotencyKey','requestFingerprint']) assert.equal(json.includes(secret), false)
    await assert.rejects(service.getSale(accountB, UserRole.OWNER, saleA), (e) => expectHttp(e, 404, 'SALE_NOT_FOUND'))
  })
})

describe('transactional Sale service', () => {
  test('transaction primitive uses its supplied client and caller rollback removes every Sale effect', async () => {
    const store = new SaleDouble()
    const prisma = store.asClient()
    const input = ownerInput()
    const requestFingerprint = saleFingerprint(accountA, ownerA, input.items)
    const synthetic = new Error('synthetic outer composition failure')

    await assert.rejects(
      prisma.$transaction(async (transaction) => {
        const result = await createSaleInTransaction(
          transaction as SaleTransaction,
          { accountId: accountA, soldById: ownerA },
          input,
          { idempotencyKey: key, requestFingerprint },
        )
        assert.equal(result.status, SaleStatus.COMPLETED)
        assert.equal(result.currency, 'USD')
        assert.equal(result.subtotal.toFixed(2), '81.00')
        assert.equal(result.totalAmount.toFixed(2), '81.00')
        assert.equal(result.sellerNameAtSale, 'Ada Owner')
        assert.equal(result.items.length, 1)
        assert.deepEqual(
          {
            productId: result.items[0].productId,
            variantId: result.items[0].variantId,
            quantity: result.items[0].quantity,
            price: result.items[0].unitSoldPrice.toFixed(2),
            cost: result.items[0].unitCostAtSale.toFixed(4),
            total: result.items[0].lineTotal.toFixed(2),
          },
          { productId: productA, variantId: variantA, quantity: 3, price: '27.00', cost: '12.3456', total: '81.00' },
        )
        throw synthetic
      }),
      (error) => error === synthetic,
    )

    assert.equal(store.transactionOpenCount, 1)
    assert.deepEqual(store.locks.map((lock) => lock.kind), ['Account', 'User', 'Product', 'Variant'])
    assert.equal(store.state.sales.length, 0)
    assert.equal(store.state.items.length, 0)
    assert.equal(store.state.movements.length, 0)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 10)
  })

  test('transaction primitive does not replay or recover a duplicate operation key', async () => {
    const store = new SaleDouble()
    store.state.sales.push({
      id: randomUUID(), accountId: accountA, soldById: ownerA, idempotencyKey: key,
      requestFingerprint: saleFingerprint(accountA, ownerA, ownerInput().items),
      status: SaleStatus.COMPLETED, currency: 'USD', subtotal: new Prisma.Decimal('1.00'),
      totalAmount: new Prisma.Decimal('1.00'), sellerNameAtSale: 'Ada Owner',
      sellerCodeAtSale: null, createdAt: now,
    })

    await assert.rejects(
      store.asClient().$transaction((transaction) => createSaleInTransaction(
        transaction as SaleTransaction,
        { accountId: accountA, soldById: ownerA },
        ownerInput(),
        { idempotencyKey: key, requestFingerprint: 'b'.repeat(64) },
      )),
      (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
    )
    assert.equal(store.state.sales.length, 1)
    assert.equal(store.state.items.length, 0)
    assert.equal(store.state.movements.length, 0)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 10)
  })

  test('OWNER overrides price and atomically stores trusted snapshots, totals, cost, stock, and movement', async () => {
    const store = new SaleDouble()
    const result = await createSaleDependencies(store.asClient()).createSale(accountA, ownerA, key, ownerInput())
    assert.equal(result.idempotentReplay, false)
    assert.equal(result.sale.currency, 'USD')
    assert.equal(result.sale.subtotal, '81.00')
    assert.equal(result.sale.totalAmount, '81.00')
    assert.deepEqual(result.sale.seller, { name: 'Ada Owner', employeeCode: null })
    assert.deepEqual(result.sale.items[0], { id: result.sale.items[0].id, productName: 'Tee', categoryName: 'Shirts', sku: 'TEE-M', color: 'Black', size: 'M', quantity: 3, unitSoldPrice: '27.00', lineTotal: '81.00' })
    assert.equal(Object.hasOwn(result.sale.items[0], 'unitCostAtSale'), false)
    assert.equal(store.state.variants.get(variantA)!.currentStock, 7)
    assert.equal(store.state.variants.get(variantA)!.sellingPrice.toFixed(2), '30.00')
    assert.equal(store.state.items[0].unitCostAtSale.toFixed(4), '12.3456')
    assert.deepEqual(store.state.movements[0], { ...store.state.movements[0], accountId: accountA, variantId: variantA, type: InventoryMovementType.SALE, quantityChange: -3, unitCost: store.state.items[0].unitCostAtSale, performedById: ownerA, saleItemId: store.state.items[0].id, returnItemId: null, note: null, idempotencyKey: null, requestFingerprint: null })
    assert.deepEqual(store.locks.map((lock) => lock.kind), ['Account','User','Product','Variant'])
  })

  test('OWNER may sell null-priced catalog; WAREHOUSE requires exact current Decimal price', async () => {
    const ownerStore = new SaleDouble(); ownerStore.state.variants.get(variantA)!.sellingPrice = null
    await createSaleDependencies(ownerStore.asClient()).createSale(accountA, ownerA, key, ownerInput('27'))
    const exact = new SaleDouble()
    await createSaleDependencies(exact.asClient()).createSale(accountA, warehouseA, key, ownerInput('30.0'))
    for (const price of ['27.00','32.00']) {
      const store = new SaleDouble()
      await assert.rejects(createSaleDependencies(store.asClient()).createSale(accountA, warehouseA, key, ownerInput(price)), (e) => expectHttp(e, 409, 'SALE_PRICE_CHANGED'))
      assert.equal(store.state.sales.length, 0); assert.equal(store.state.variants.get(variantA)!.currentStock, 10)
    }
    const unpriced = new SaleDouble(); unpriced.state.variants.get(variantA)!.sellingPrice = null
    await assert.rejects(createSaleDependencies(unpriced.asClient()).createSale(accountA, warehouseA, key, ownerInput('30')), (e) => expectHttp(e, 409, 'SALE_VARIANT_NOT_PRICED'))
  })

  test('rejects unavailable catalog, missing cost, insufficient stock, overflow, and rolls back a multi-line cart', async () => {
    const missing = new SaleDouble(); missing.state.variants.get(variantA)!.lastPurchaseCost = null
    await assert.rejects(createSaleDependencies(missing.asClient()).createSale(accountA, ownerA, key, ownerInput()), (e) => expectHttp(e, 409, 'SALE_COST_UNAVAILABLE'))
    const inactive = new SaleDouble(); inactive.state.products.get(productA)!.isActive = false
    await assert.rejects(createSaleDependencies(inactive.asClient()).createSale(accountA, ownerA, key, ownerInput()), (e) => expectHttp(e, 409, 'SALE_PRODUCT_INACTIVE'))
    const inactiveVariant = new SaleDouble(); inactiveVariant.state.variants.get(variantA)!.isActive = false
    await assert.rejects(createSaleDependencies(inactiveVariant.asClient()).createSale(accountA, ownerA, key, ownerInput()), (e) => expectHttp(e, 409, 'SALE_VARIANT_INACTIVE'))
    const foreign = new SaleDouble()
    await assert.rejects(createSaleDependencies(foreign.asClient()).createSale(accountA, ownerA, key, { items: [{ variantId: variantOther, quantity: 1, unitSoldPrice: '1.00' }] }), (e) => expectHttp(e, 404, 'SALE_VARIANT_UNAVAILABLE'))
    const atomic = new SaleDouble(); atomic.state.variants.get(variantB)!.currentStock = 1
    const cart = { items: [{ variantId: variantA, quantity: 3, unitSoldPrice: '27.00' }, { variantId: variantB, quantity: 2, unitSoldPrice: '20.00' }] }
    await assert.rejects(createSaleDependencies(atomic.asClient()).createSale(accountA, ownerA, key, cart), (e) => expectHttp(e, 409, 'INSUFFICIENT_STOCK'))
    assert.equal(atomic.state.variants.get(variantA)!.currentStock, 10); assert.equal(atomic.state.variants.get(variantB)!.currentStock, 1); assert.equal(atomic.state.sales.length, 0); assert.equal(atomic.state.movements.length, 0)
    const overflow = new SaleDouble(); overflow.state.variants.get(variantA)!.currentStock = 1_000_000
    await assert.rejects(createSaleDependencies(overflow.asClient()).createSale(accountA, ownerA, key, { items: [{ variantId: variantA, quantity: 1_000_000, unitSoldPrice: '9999999999999999.99' }] }), (e) => expectHttp(e, 422, 'SALE_TOTAL_OVERFLOW'))
  })

  test('replays equivalent carts and conflicts on changed semantics without another stock mutation', async () => {
    const store = new SaleDouble(); const service = createSaleDependencies(store.asClient())
    const firstInput = parseSaleInput({ items: [{ variantId: variantA, quantity: 1, unitSoldPrice: '12.3' }, { variantId: variantB, quantity: 1, unitSoldPrice: '20' }] })
    const reordered = parseSaleInput({ items: [{ variantId: variantB, quantity: 1, unitSoldPrice: '20.00' }, { variantId: variantA, quantity: 1, unitSoldPrice: '12.30' }] })
    const first = await service.createSale(accountA, ownerA, key, firstInput)
    const replay = await service.createSale(accountA, ownerA, key, reordered)
    assert.equal(replay.sale.id, first.sale.id); assert.equal(replay.idempotentReplay, true); assert.equal(store.state.sales.length, 1); assert.equal(store.state.movements.length, 2)
    for (const changed of [ownerInput('28.00'), { items: [{ variantId: variantA, quantity: 2, unitSoldPrice: '27.00' }] }]) await assert.rejects(service.createSale(accountA, ownerA, key, changed), (e) => expectHttp(e, 409, 'SALE_IDEMPOTENCY_CONFLICT'))
    await assert.rejects(service.createSale(accountA, warehouseA, key, firstInput), (e) => expectHttp(e, 409, 'SALE_IDEMPOTENCY_CONFLICT'))
    const otherTenant = await service.createSale(accountB, ownerB, key, { items: [{ variantId: variantOther, quantity: 1, unitSoldPrice: '1.00' }] })
    assert.equal(otherTenant.idempotentReplay, false)
    assert.equal(store.state.sales.length, 2)
  })

  test('recovers only the Sale idempotency race and rolls back forced failures', async () => {
    const same = new SaleDouble(); same.raceWinner = 'same'
    assert.equal((await createSaleDependencies(same.asClient()).createSale(accountA, ownerA, key, ownerInput())).idempotentReplay, true)
    assert.equal(same.state.variants.get(variantA)!.currentStock, 10); assert.equal(same.state.items.length, 0); assert.equal(same.state.movements.length, 0)
    const different = new SaleDouble(); different.raceWinner = 'different'
    await assert.rejects(createSaleDependencies(different.asClient()).createSale(accountA, ownerA, key, ownerInput()), (e) => expectHttp(e, 409, 'SALE_IDEMPOTENCY_CONFLICT'))
    assert.equal(different.state.variants.get(variantA)!.currentStock, 10); assert.equal(different.state.items.length, 0); assert.equal(different.state.movements.length, 0)
    const unrelated = new SaleDouble(); unrelated.raceWinner = 'same'; unrelated.raceConstraint = 'unrelated_unique'
    await assert.rejects(createSaleDependencies(unrelated.asClient()).createSale(accountA, ownerA, key, ownerInput()), (e) => expectHttp(e, 503, 'SALE_UNAVAILABLE'))
    for (const point of ['saleItem','stock','movement'] as const) {
      const store = new SaleDouble(); store.failAt = point
      await assert.rejects(createSaleDependencies(store.asClient()).createSale(accountA, ownerA, key, ownerInput()), (e) => point === 'stock' ? expectHttp(e, 409, 'INSUFFICIENT_STOCK') : expectHttp(e, 503, 'SALE_UNAVAILABLE'))
      assert.equal(store.state.sales.length, 0); assert.equal(store.state.items.length, 0); assert.equal(store.state.movements.length, 0); assert.equal(store.state.variants.get(variantA)!.currentStock, 10)
    }
  })

  test('sorts multi-Variant locks and serializes same-stock logical contention', async () => {
    const sorted = new SaleDouble(); const service = createSaleDependencies(sorted.asClient())
    await service.createSale(accountA, ownerA, key, { items: [{ variantId: variantA, quantity: 1, unitSoldPrice: '1.00' }, { variantId: variantB, quantity: 1, unitSoldPrice: '1.00' }] })
    assert.deepEqual(sorted.locks.find((lock) => lock.kind === 'Variant')!.ids, [variantB, variantA].sort())
    const concurrent = new SaleDouble(); concurrent.state.variants.get(variantA)!.currentStock = 5
    const outcomes = await Promise.allSettled([createSaleDependencies(concurrent.asClient()).createSale(accountA, ownerA, randomUUID(), { items: [{ variantId: variantA, quantity: 4, unitSoldPrice: '1.00' }] }), createSaleDependencies(concurrent.asClient()).createSale(accountA, ownerA, randomUUID(), { items: [{ variantId: variantA, quantity: 4, unitSoldPrice: '1.00' }] })])
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1); assert.equal(concurrent.state.variants.get(variantA)!.currentStock, 1); assert.equal(concurrent.state.sales.length, 1)
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

describe('Sale route authorization and response', () => {
  test('OWNER and WAREHOUSE receive 201/200 while SUPER_ADMIN is rejected', async () => {
    for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
      const store = new SaleDouble(); const sales = createSaleDependencies(store.asClient())
      await withServer(role, sales, async (base) => {
        const body = role === UserRole.OWNER ? ownerInput() : ownerInput('30')
        const options = { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }
        assert.equal((await fetch(`${base}/api/sales`, options)).status, 201)
        assert.equal((await fetch(`${base}/api/sales`, options)).status, 200)
      })
    }
    const forbidden: SaleDependencies = {
      async createSale() { throw Error('must not run') },
      async listSales() { throw Error('must not run') },
      async getSale() { throw Error('must not run') },
      async voidSale() { throw Error('must not run') },
    }
    await withServer(UserRole.SUPER_ADMIN, forbidden, async (base) => {
      const response = await fetch(`${base}/api/sales`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(ownerInput()) })
      assert.equal(response.status, 403)
    })
  })

  test('OWNER and WAREHOUSE can list/detail while malformed IDs and SUPER_ADMIN are rejected', async () => {
    for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
      await withServer(role, createSaleDependencies(new HistoryDouble().asClient()), async (base) => {
        const headers = { Authorization: 'Bearer test' }
        const list = await fetch(`${base}/api/sales?limit=1`, { headers })
        assert.equal(list.status, 200); assert.equal((await list.json() as Row).sales.length, 1)
        const detail = await fetch(`${base}/api/sales/${saleA}`, { headers })
        assert.equal(detail.status, 200)
        const detailJson = await detail.json() as Row
        assert.equal(detailJson.sale.id, saleA)
        assert.equal(JSON.stringify(detailJson).includes('unitCostAtSale'), role === UserRole.OWNER)
        const malformed = await fetch(`${base}/api/sales/not-a-uuid`, { headers })
        assert.equal(malformed.status, 422); assert.equal((await malformed.json() as Row).error.code, 'INVALID_SALE_ID')
      })
    }
    const forbidden: SaleDependencies = {
      async createSale() { throw Error('must not run') },
      async listSales() { throw Error('must not run') },
      async getSale() { throw Error('must not run') },
      async voidSale() { throw Error('must not run') },
    }
    await withServer(UserRole.SUPER_ADMIN, forbidden, async (base) => {
      const headers = { Authorization: 'Bearer test' }
      assert.equal((await fetch(`${base}/api/sales`, { headers })).status, 403)
      assert.equal((await fetch(`${base}/api/sales/${saleA}`, { headers })).status, 403)
    })
  })
})
