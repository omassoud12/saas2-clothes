import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, InventoryMovementType, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { createInventoryRouter } from './inventory.routes.js'
import { encodeHistoryCursor, encodeReconciliationCursor, parseHistoryQuery, parseReconciliationQuery } from './inventory.schemas.js'
import { createInventoryAuditDependencies } from './inventory.service.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const ownerA = '33333333-3333-4333-8333-333333333333'
const productA = '44444444-4444-4444-8444-444444444444'
const productB = '55555555-5555-4555-8555-555555555555'
const variantA = '66666666-6666-4666-8666-666666666666'
const variantB = '77777777-7777-4777-8777-777777777777'
const date = new Date('2026-09-17T12:00:00.000Z')
const product = { id: productA, name: 'Shirt' }
const variant = { id: variantA, accountId: accountA, productId: productA, sku: 'SHIRT-RED', color: 'Red', size: 'M', currentStock: 10, product }
const other = { id: variantB, accountId: accountB, productId: productB, sku: 'OTHER', color: null, size: null, currentStock: 8, product: { id: productB, name: 'Other store' } }
const performer = { firstName: 'Store', lastName: 'Owner', employeeCode: 'OWN-1' }
const movements = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountId: accountA, variantId: variantA, type: InventoryMovementType.RESTOCK, quantityChange: 15, unitCost: new Prisma.Decimal('12.3456'), note: 'Supplier invoice', createdAt: date, variant, performedBy: performer, idempotencyKey: 'private', requestFingerprint: 'f'.repeat(64) },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', accountId: accountA, variantId: variantA, type: InventoryMovementType.SALE, quantityChange: -5, unitCost: new Prisma.Decimal('10.0000'), note: 'private note', createdAt: date, variant, performedBy: performer, idempotencyKey: null, requestFingerprint: null },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', accountId: accountB, variantId: variantB, type: InventoryMovementType.RESTOCK, quantityChange: 8, unitCost: new Prisma.Decimal('99.0000'), note: 'Other tenant', createdAt: date, variant: other, performedBy: performer, idempotencyKey: null, requestFingerprint: null },
]

function expectHttp(error: unknown, status: number): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  return true
}

class AuditDouble {
  rows = movements.map((row) => ({ ...row }))
  variants = [variant, other]
  readonly queries: unknown[] = []
  sqlRows: unknown[] = []

  asClient(): PrismaClient {
    const store = this
    return {
      product: { async findUnique({ where }: { where: { id_accountId: { id: string; accountId: string } } }) {
        return where.id_accountId.id === productA && where.id_accountId.accountId === accountA ? product : null
      } },
      productVariant: {
        async findUnique({ where }: { where: { id_productId_accountId?: { id: string; productId: string; accountId: string }; id_accountId?: { id: string; accountId: string } } }) {
          const key = where.id_productId_accountId ?? where.id_accountId!
          return key.id === variantA && key.accountId === accountA && (!('productId' in key) || key.productId === productA) ? variant : null
        },
        async findMany({ where, take }: { where: { accountId: string; productId?: string; id?: string; sku?: { gt: string } }; take: number }) {
          store.queries.push({ kind: 'variants', where, take })
          return store.variants.filter((row) => row.accountId === where.accountId && (!where.productId || row.productId === where.productId) && (!where.id || row.id === where.id) && (!where.sku || row.sku > where.sku.gt)).sort((a, b) => a.sku.localeCompare(b.sku)).slice(0, take)
        },
      },
      inventoryMovement: {
        async findMany({ where, take }: { where: Record<string, any>; take: number }) {
          store.queries.push({ kind: 'movements', where, take })
          return store.rows.filter((row) => row.accountId === where.accountId && (!where.variantId || row.variantId === where.variantId) && (!where.variant || row.variant.productId === where.variant.productId) && (!where.type || row.type === where.type) && (!where.createdAt?.gte || row.createdAt >= where.createdAt.gte) && (!where.createdAt?.lte || row.createdAt <= where.createdAt.lte) && (!where.OR || row.createdAt < where.OR[0].createdAt.lt || (row.createdAt.getTime() === where.OR[1].createdAt.getTime() && row.id < where.OR[1].id.lt))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).slice(0, take)
        },
        async groupBy({ where }: { where: { accountId: string; variantId: { in: string[] } } }) {
          store.queries.push({ kind: 'groupBy', where })
          return where.variantId.in.flatMap((id) => {
            const rows = store.rows.filter((row) => row.accountId === where.accountId && row.variantId === id)
            return rows.length ? [{ variantId: id, _sum: { quantityChange: rows.reduce((sum, row) => sum + row.quantityChange, 0) } }] : []
          })
        },
      },
      async $queryRaw(sql: Prisma.Sql) { store.queries.push({ kind: 'sql', text: sql.sql, values: sql.values }); return store.sqlRows },
      async $transaction<T>(callback: (tx: PrismaClient) => Promise<T>, options: { isolationLevel: string }): Promise<T> {
        assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.RepeatableRead)
        return callback(store.asClient())
      },
    } as unknown as PrismaClient
  }
}

describe('inventory audit query validation', () => {
  test('bounds limits, dates, types, and opaque cursors', () => {
    assert.equal(parseHistoryQuery({}).limit, 25)
    assert.equal(parseHistoryQuery({ limit: '100' }).limit, 100)
    for (const value of ['0', '101', '-1', '1.5', 'all']) assert.throws(() => parseHistoryQuery({ limit: value }), (error) => expectHttp(error, 422))
    assert.throws(() => parseHistoryQuery({ type: 'NOT_A_MOVEMENT' }), (error) => expectHttp(error, 422))
    assert.throws(() => parseHistoryQuery({ cursor: 'not-a-cursor' }), (error) => expectHttp(error, 422))
    assert.throws(() => parseHistoryQuery({ from: '2026-09-18T00:00:00Z', to: '2026-09-17T00:00:00Z' }), (error) => expectHttp(error, 422))
    assert.throws(() => parseHistoryQuery({ from: '2026-02-30T00:00:00Z' }), (error) => expectHttp(error, 422))
    assert.deepEqual(parseHistoryQuery({ cursor: encodeHistoryCursor(date, movements[0].id) }).cursor, { createdAt: date, id: movements[0].id })
    assert.equal(parseReconciliationQuery({ cursor: encodeReconciliationCursor('SHIRT-RED') }).cursor, 'SHIRT-RED')
    assert.throws(() => parseReconciliationQuery({ status: 'AUTO_FIX' }), (error) => expectHttp(error, 422))
    assert.throws(() => parseReconciliationQuery({ accountId: accountB }), (error) => expectHttp(error, 422))
  })
})

describe('read-only inventory audit service', () => {
  test('history filters tenant, product, variant, type, dates, and stable cursor', async () => {
    const store = new AuditDouble()
    const audit = createInventoryAuditDependencies(store.asClient())
    const first = await audit.listMovements(accountA, UserRole.OWNER, parseHistoryQuery({ productId: productA, variantId: variantA, type: 'RESTOCK', from: '2026-09-17T12:00:00Z', to: '2026-09-17T12:00:00Z' }))
    assert.equal(first.movements.length, 1)
    assert.equal(first.movements[0].type, 'RESTOCK')
    assert.equal(first.movements[0].unitCost, '12.3456')
    assert.equal(first.movements[0].note, 'Supplier invoice')
    assert.deepEqual(first.movements[0].performer, { name: 'Store Owner', employeeCode: 'OWN-1' })
    assert.equal(Object.hasOwn(first.movements[0], 'requestFingerprint'), false)
    assert.equal(Object.hasOwn(first.movements[0], 'idempotencyKey'), false)
    const page1 = await audit.listMovements(accountA, UserRole.OWNER, parseHistoryQuery({ limit: '1' }))
    assert.equal(page1.movements[0].id, movements[1].id)
    assert.ok(page1.nextCursor)
    const page2 = await audit.listMovements(accountA, UserRole.OWNER, parseHistoryQuery({ limit: '1', cursor: page1.nextCursor }))
    assert.equal(page2.movements[0].id, movements[0].id)
    assert.equal(page2.nextCursor, null)
    assert.equal((store.queries.find((query) => (query as { kind: string }).kind === 'movements') as { where: { accountId: string } }).where.accountId, accountA)
  })

  test('WAREHOUSE response omits cost and notes, including internal fields', async () => {
    const audit = createInventoryAuditDependencies(new AuditDouble().asClient())
    const result = await audit.listMovements(accountA, UserRole.WAREHOUSE, parseHistoryQuery({}))
    assert.equal(result.movements.length, 2)
    for (const row of result.movements) {
      for (const field of ['unitCost', 'note', 'idempotencyKey', 'requestFingerprint', 'accountId', 'saleItemId', 'returnItemId']) assert.equal(Object.hasOwn(row, field), false)
      assert.equal(row.variant.sku, 'SHIRT-RED')
    }
  })

  test('foreign and wrong-product resources are safely unavailable', async () => {
    const audit = createInventoryAuditDependencies(new AuditDouble().asClient())
    await assert.rejects(audit.listMovements(accountA, UserRole.OWNER, parseHistoryQuery({ productId: productB })), (error) => expectHttp(error, 404))
    await assert.rejects(audit.listMovements(accountA, UserRole.OWNER, parseHistoryQuery({ variantId: variantB })), (error) => expectHttp(error, 404))
    await assert.rejects(audit.reconcile(accountA, parseReconciliationQuery({ productId: productB })), (error) => expectHttp(error, 404))
    await assert.rejects(audit.reconcile(accountA, parseReconciliationQuery({ productId: productA, variantId: variantB })), (error) => expectHttp(error, 404))
  })

  test('ledger +15 and -5 reconciles; ±1 differences are reported without writes', async () => {
    const store = new AuditDouble()
    const audit = createInventoryAuditDependencies(store.asClient())
    const matched = await audit.reconcile(accountA, parseReconciliationQuery({}))
    assert.deepEqual({ stored: matched.variants[0].storedStock, ledger: matched.variants[0].ledgerStock, difference: matched.variants[0].difference, status: matched.variants[0].status },
      { stored: 10, ledger: 10, difference: 0, status: 'RECONCILED' })
    store.rows[1].quantityChange = -4
    const mismatch = await audit.reconcile(accountA, parseReconciliationQuery({}))
    assert.deepEqual({ stored: mismatch.variants[0].storedStock, ledger: mismatch.variants[0].ledgerStock, difference: mismatch.variants[0].difference, status: mismatch.variants[0].status },
      { stored: 10, ledger: 11, difference: -1, status: 'MISMATCH' })
    store.rows[1].quantityChange = -6
    const positive = await audit.reconcile(accountA, parseReconciliationQuery({}))
    assert.deepEqual({ ledger: positive.variants[0].ledgerStock, difference: positive.variants[0].difference, status: positive.variants[0].status },
      { ledger: 9, difference: 1, status: 'MISMATCH' })
    assert.equal(Object.hasOwn(mismatch.variants[0], 'unitCost'), false)
    assert.equal(store.queries.some((query) => ['update', 'create', 'delete'].includes((query as { kind: string }).kind)), false)
  })

  test('reconciliation pages by tenant-unique SKU and aggregates only its page', async () => {
    const store = new AuditDouble()
    store.variants.push({ ...variant, id: '88888888-8888-4888-8888-888888888888', sku: 'ZZZ', currentStock: 0 })
    const audit = createInventoryAuditDependencies(store.asClient())
    const first = await audit.reconcile(accountA, parseReconciliationQuery({ limit: '1' }))
    assert.equal(first.variants[0].variant.sku, 'SHIRT-RED')
    assert.ok(first.nextCursor)
    const firstGroup = store.queries.find((query) => (query as { kind: string }).kind === 'groupBy') as { where: { variantId: { in: string[] } } }
    assert.deepEqual(firstGroup.where.variantId.in, [variantA])
    const second = await audit.reconcile(accountA, parseReconciliationQuery({ limit: '1', cursor: first.nextCursor }))
    assert.equal(second.variants[0].variant.sku, 'ZZZ')
    assert.equal(second.variants[0].status, 'RECONCILED')
    assert.equal(second.nextCursor, null)
  })

  test('variants without movements use a zero ledger, regardless of stored stock', async () => {
    const store = new AuditDouble()
    store.variants = [
      { ...variant, sku: 'NO-MOVEMENTS-ZERO', currentStock: 0 },
      { ...variant, id: '88888888-8888-4888-8888-888888888888', sku: 'NO-MOVEMENTS-FIVE', currentStock: 5 },
    ]
    store.rows = []
    const result = await createInventoryAuditDependencies(store.asClient()).reconcile(accountA, parseReconciliationQuery({}))
    const bySku = new Map(result.variants.map((row) => [row.variant.sku, row]))
    assert.deepEqual({ ledger: bySku.get('NO-MOVEMENTS-ZERO')?.ledgerStock, difference: bySku.get('NO-MOVEMENTS-ZERO')?.difference, status: bySku.get('NO-MOVEMENTS-ZERO')?.status },
      { ledger: 0, difference: 0, status: 'RECONCILED' })
    assert.deepEqual({ ledger: bySku.get('NO-MOVEMENTS-FIVE')?.ledgerStock, difference: bySku.get('NO-MOVEMENTS-FIVE')?.difference, status: bySku.get('NO-MOVEMENTS-FIVE')?.status },
      { ledger: 0, difference: 5, status: 'MISMATCH' })
  })

  test('computed status filter stays in parameterized tenant-scoped SQL before LIMIT', async () => {
    const store = new AuditDouble()
    store.sqlRows = [{ id: variantA, sku: 'SHIRT-RED', color: 'Red', size: 'M', currentStock: 10, productId: productA, productName: 'Shirt', ledgerStock: 11n, difference: -1n }]
    const result = await createInventoryAuditDependencies(store.asClient()).reconcile(accountA, parseReconciliationQuery({ status: 'MISMATCH', productId: productA, limit: '1' }))
    assert.equal(result.variants[0].difference, -1)
    assert.equal(result.variants[0].status, 'MISMATCH')
    const sql = store.queries.find((query) => (query as { kind: string }).kind === 'sql') as { text: string; values: unknown[] }
    assert.match(sql.text, /"difference" <> 0/)
    assert.match(sql.text, /LIMIT/)
    assert.ok(sql.values.includes(accountA))
    assert.ok(sql.values.includes(productA))
  })
})

function auth(role: UserRole): AuthDependencies {
  return {
    async verifyAccessToken() { return { id: ownerA, email: 'owner@example.com', emailConfirmedAt: date.toISOString(), isAnonymous: false } },
    async findApplicationUser() { return { id: ownerA, role, accountId: accountA, isActive: true } },
    async findAccountById() { return { id: accountA, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw Error('unused') },
  }
}

async function withServer(role: UserRole, run: (base: string) => Promise<void>) {
  const app = express()
  app.use('/api/inventory', createInventoryRouter(auth(role), createInventoryAuditDependencies(new AuditDouble().asClient())))
  app.use(errorHandler)
  const server = app.listen(0)
  try {
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`)
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

describe('inventory audit routes', () => {
  test('OWNER and WAREHOUSE can read; WAREHOUSE has no cost or notes', async () => {
    for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
      await withServer(role, async (base) => {
        const response = await fetch(`${base}/api/inventory/movements`, { headers: { Authorization: 'Bearer test' } })
        assert.equal(response.status, 200)
        const body = await response.json() as { movements: Record<string, unknown>[] }
        assert.equal(body.movements.length, 2)
        assert.equal(Object.hasOwn(body.movements[0], 'unitCost'), role === UserRole.OWNER)
        assert.equal(Object.hasOwn(body.movements[0], 'note'), role === UserRole.OWNER)
        const reconciliation = await fetch(`${base}/api/inventory/reconciliation`, { headers: { Authorization: 'Bearer test' } })
        assert.equal(reconciliation.status, 200)
        assert.equal((await reconciliation.json() as { variants: unknown[] }).variants.length, 1)
      })
    }
  })
  test('rejects malformed filters before database access', async () => {
    await withServer(UserRole.OWNER, async (base) => {
      const response = await fetch(`${base}/api/inventory/movements?type=INVENTED&limit=1000`, { headers: { Authorization: 'Bearer test' } })
      assert.equal(response.status, 422)
    })
  })
})
