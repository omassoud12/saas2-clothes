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
import { canonicalSaleItems, maxSaleLines, parseSaleIdempotencyKey, parseSaleInput, saleFingerprint } from './sale.schemas.js'
import { createSaleDependencies } from './sale.service.js'
import type { SaleDependencies, SaleInput } from './sale.types.js'

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
          const key = where.accountId_idempotencyKey
          const sale = current().sales.find((row) => row.accountId === key.accountId && row.idempotencyKey === key.idempotencyKey)
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

describe('transactional Sale service', () => {
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
    assert.equal(same.state.variants.get(variantA)!.currentStock, 10)
    const different = new SaleDouble(); different.raceWinner = 'different'
    await assert.rejects(createSaleDependencies(different.asClient()).createSale(accountA, ownerA, key, ownerInput()), (e) => expectHttp(e, 409, 'SALE_IDEMPOTENCY_CONFLICT'))
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
  const app = express(); app.use(express.json()); app.use('/api/sales', createSaleRouter(auth(role), sales)); app.use(errorHandler)
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
    await withServer(UserRole.SUPER_ADMIN, { async createSale() { throw Error('must not run') } }, async (base) => {
      const response = await fetch(`${base}/api/sales`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(ownerInput()) })
      assert.equal(response.status, 403)
    })
  })
})
