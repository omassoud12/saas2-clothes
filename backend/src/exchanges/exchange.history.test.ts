import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, SaleStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { encodeExchangeCursor, parseExchangeHistoryQuery, parseExchangeId } from './exchange.history.schemas.js'
import { createExchangeHistoryDependencies } from './exchange.history.service.js'
import { createExchangeHistoryRouter } from './exchange.history.routes.js'

const tenant = '11111111-1111-4111-8111-111111111111'
const foreignTenant = '22222222-2222-4222-8222-222222222222'
const owner = '33333333-3333-4333-8333-333333333333'
const originalSaleId = '44444444-4444-4444-8444-444444444444'
const replacementSaleId = '55555555-5555-4555-8555-555555555555'
const secondReplacementSaleId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const firstExchangeId = '66666666-6666-4666-8666-666666666666'
const secondExchangeId = '77777777-7777-4777-8777-777777777777'
const foreignExchangeId = '88888888-8888-4888-8888-888888888888'
const firstReturnId = '99999999-9999-4999-8999-999999999999'
const secondReturnId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const saleItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const productId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const variantId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const timestamp = new Date('2026-09-24T12:00:00.000Z')

type Row = Record<string, any>

function expectHttp(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  return true
}

class HistoryStore {
  readonly rows: Row[] = [
    { id: firstExchangeId, accountId: tenant, returnId: firstReturnId, newSaleId: replacementSaleId, createdAt: timestamp },
    { id: secondExchangeId, accountId: tenant, returnId: secondReturnId, newSaleId: secondReplacementSaleId, createdAt: timestamp },
    { id: foreignExchangeId, accountId: foreignTenant, returnId: firstReturnId, newSaleId: replacementSaleId, createdAt: timestamp },
  ]
  readonly refunds: Row[] = [
    { accountId: tenant, returnId: firstReturnId, refundAmount: new Prisma.Decimal('30.00') },
    { accountId: tenant, returnId: secondReturnId, refundAmount: new Prisma.Decimal('40.00') },
  ]
  replacementTotal = new Prisma.Decimal('40.00')
  replacementStatus: SaleStatus = SaleStatus.COMPLETED
  currentUserName = 'Changed User'
  currentCatalogName = 'Changed Catalog'
  pageQueries = 0
  refundQueries = 0
  detailQueries = 0

  private base(row: Row) {
    return {
      ...row,
      saleReturn: {
        saleId: originalSaleId,
        processedByName: 'Historical Processor',
        processedByCode: 'EMP-OLD',
        sale: { currency: 'USD' },
      },
      newSale: { totalAmount: this.replacementTotal },
    }
  }

  private detail(row: Row) {
    return {
      ...this.base(row),
      requestFingerprint: 'a'.repeat(64),
      saleReturn: {
        id: row.returnId,
        saleId: originalSaleId,
        processedByName: 'Historical Processor',
        processedByCode: 'EMP-OLD',
        reason: 'Historical reason',
        createdAt: timestamp,
        sale: { currency: 'USD' },
        items: [{
          saleItemId, variantId, quantity: 1,
          refundAmount: this.refunds.find((refund) => refund.returnId === row.returnId)!.refundAmount,
          saleItem: {
            productId, productNameAtSale: 'Original Product', categoryNameAtSale: 'Original Category',
            skuAtSale: 'ORIGINAL-SKU', colorAtSale: 'Blue', sizeAtSale: 'M',
          },
        }],
      },
      newSale: {
        id: row.newSaleId,
        status: this.replacementStatus,
        subtotal: this.replacementTotal,
        totalAmount: this.replacementTotal,
        sellerNameAtSale: 'Historical Seller',
        sellerCodeAtSale: 'SELLER-OLD',
        createdAt: timestamp,
        items: [{
          id: saleItemId, productId, variantId,
          productNameAtSale: 'Replacement Product', categoryNameAtSale: 'Replacement Category',
          skuAtSale: 'REPLACEMENT-SKU', colorAtSale: 'Red', sizeAtSale: 'L',
          quantity: 1, unitSoldPrice: this.replacementTotal, lineTotal: this.replacementTotal,
        }],
      },
    }
  }

  asClient(): PrismaClient {
    const store = this
    const historicalOnly = () => { throw new Error('Current User or catalog must not be queried for Exchange history') }
    return {
      user: { findUnique: historicalOnly, findMany: historicalOnly },
      product: { findUnique: historicalOnly, findMany: historicalOnly },
      category: { findUnique: historicalOnly, findMany: historicalOnly },
      productVariant: { findUnique: historicalOnly, findMany: historicalOnly },
      exchange: {
        async findMany({ where, take }: Row) {
          store.pageQueries += 1
          let rows = store.rows.filter((row) => row.accountId === where.accountId)
          if (where.createdAt?.gte) rows = rows.filter((row) => row.createdAt >= where.createdAt.gte)
          if (where.createdAt?.lte) rows = rows.filter((row) => row.createdAt <= where.createdAt.lte)
          if (where.OR) {
            const boundary = where.OR[0].createdAt.lt as Date
            const cursorId = where.OR[1].id.lt as string
            rows = rows.filter((row) => row.createdAt < boundary ||
              (row.createdAt.getTime() === boundary.getTime() && row.id < cursorId))
          }
          return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
            .slice(0, take).map((row) => store.base(row))
        },
        async findUnique({ where }: Row) {
          store.detailQueries += 1
          const key = where.id_accountId
          const row = store.rows.find((candidate) => candidate.id === key.id && candidate.accountId === key.accountId)
          return row ? store.detail(row) : null
        },
      },
      saleReturnItem: {
        async groupBy({ where }: Row) {
          store.refundQueries += 1
          return where.returnId.in.map((id: string) => ({
            returnId: id,
            _sum: { refundAmount: store.refunds.filter((refund) => refund.accountId === where.accountId && refund.returnId === id)
              .reduce((sum, refund) => sum.add(refund.refundAmount), new Prisma.Decimal(0)) },
          }))
        },
      },
    } as unknown as PrismaClient
  }
}

describe('Exchange history validation', () => {
  test('enforces bounded cursors and optional UTC dates', () => {
    assert.equal(parseExchangeHistoryQuery({}).limit, 25)
    assert.equal(parseExchangeHistoryQuery({ limit: '100' }).limit, 100)
    assert.throws(() => parseExchangeHistoryQuery({ limit: '101' }), (error) => expectHttp(error, 422, 'INVALID_EXCHANGE_HISTORY_FILTER'))
    assert.throws(() => parseExchangeHistoryQuery({ cursor: 'bad!' }), (error) => expectHttp(error, 422, 'INVALID_EXCHANGE_HISTORY_FILTER'))
    assert.throws(() => parseExchangeHistoryQuery({ accountId: tenant }), (error) => expectHttp(error, 422, 'INVALID_EXCHANGE_HISTORY_FILTER'))
    assert.throws(() => parseExchangeHistoryQuery({ from: '2026-09-25T00:00:00Z', to: '2026-09-24T00:00:00Z' }), (error) => expectHttp(error, 422, 'INVALID_EXCHANGE_HISTORY_FILTER'))
    assert.equal(parseExchangeHistoryQuery({ cursor: encodeExchangeCursor(timestamp, firstExchangeId) }).cursor?.id, firstExchangeId)
    assert.equal(parseExchangeId(firstExchangeId.toUpperCase()), firstExchangeId)
    assert.throws(() => parseExchangeId('bad'), (error) => expectHttp(error, 422, 'INVALID_EXCHANGE_ID'))
  })
})

describe('Exchange history service', () => {
  test('pages tenant history by timestamp and ID with one bounded refund aggregate', async () => {
    const store = new HistoryStore()
    const history = createExchangeHistoryDependencies(store.asClient())
    const page1 = await history.listExchanges(tenant, { limit: 1 })
    assert.deepEqual(page1.exchanges.map((row) => row.id), [secondExchangeId])
    assert.ok(page1.nextCursor)
    const page2 = await history.listExchanges(tenant, parseExchangeHistoryQuery({ limit: '1', cursor: page1.nextCursor }))
    assert.deepEqual(page2.exchanges.map((row) => row.id), [firstExchangeId])
    assert.equal(page2.nextCursor, null)
    assert.equal(store.pageQueries, 2)
    assert.equal(store.refundQueries, 2)
    assert.equal(page1.exchanges[0]?.totalRefund, '40.00')
    assert.equal(page1.exchanges[0]?.differenceAmount, '0.00')
    assert.equal(page2.exchanges[0]?.differenceAmount, '10.00')
    assert.equal(page2.exchanges[0]?.processor.name, 'Historical Processor')
    assert.doesNotMatch(JSON.stringify(page1), /cost|profit|stock|idempotency|fingerprint|movement/i)
  })

  test('returns empty tenant history without a refund query and honors date filter', async () => {
    const store = new HistoryStore()
    const history = createExchangeHistoryDependencies(store.asClient())
    assert.deepEqual(await history.listExchanges(foreignTenant, { limit: 25, from: new Date('2026-09-25T00:00:00Z') }), { exchanges: [], nextCursor: null })
    assert.equal(store.refundQueries, 0)
  })

  test('uses stored child snapshots, supports VOIDED replacement and signed differences', async () => {
    const store = new HistoryStore()
    const history = createExchangeHistoryDependencies(store.asClient())
    const detail = await history.getExchange(tenant, firstExchangeId)
    assert.equal(detail.exchange.return.items[0]?.productName, 'Original Product')
    assert.equal(detail.exchange.replacementSale.items[0]?.sku, 'REPLACEMENT-SKU')
    assert.equal(detail.exchange.return.processor.name, 'Historical Processor')
    assert.equal(detail.exchange.replacementSale.seller.name, 'Historical Seller')
    assert.equal(detail.exchange.differenceAmount, '10.00')
    assert.equal((await history.getExchange(tenant, secondExchangeId)).exchange.differenceAmount, '0.00')
    store.currentUserName = 'Renamed Processor and Seller'
    store.currentCatalogName = 'Renamed Products and Variants'
    store.replacementTotal = new Prisma.Decimal('20.00')
    store.replacementStatus = SaleStatus.VOIDED
    const later = await history.getExchange(tenant, firstExchangeId)
    assert.equal(later.exchange.replacementSale.status, SaleStatus.VOIDED)
    assert.equal(later.exchange.differenceAmount, '-10.00')
    assert.equal(later.exchange.return.items[0]?.productName, 'Original Product')
    assert.doesNotMatch(JSON.stringify(later), /cost|profit|stock|idempotency|fingerprint|movement/i)
    assert.equal(store.detailQueries, 3)
  })

  test('returns safe 404 for another tenant or unknown ID', async () => {
    const history = createExchangeHistoryDependencies(new HistoryStore().asClient())
    await assert.rejects(history.getExchange(tenant, foreignExchangeId), (error) => expectHttp(error, 404, 'EXCHANGE_NOT_FOUND'))
    await assert.rejects(history.getExchange(tenant, owner), (error) => expectHttp(error, 404, 'EXCHANGE_NOT_FOUND'))
  })
})

function auth(role: UserRole): AuthDependencies {
  return {
    async verifyAccessToken() { return { id: owner, email: 'person@example.com', emailConfirmedAt: timestamp.toISOString(), isAnonymous: false } },
    async findApplicationUser() { return { id: owner, role, accountId: role === UserRole.SUPER_ADMIN ? null : tenant, isActive: true } },
    async findAccountById() { return { id: tenant, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw new Error('unused') },
  }
}

async function request(role: UserRole, path: string) {
  const app = express()
  app.use('/api/exchanges', createExchangeHistoryRouter(auth(role), createExchangeHistoryDependencies(new HistoryStore().asClient())))
  app.use(errorHandler)
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    return await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer token' } })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('Exchange read authorization', () => {
  test('OWNER and WAREHOUSE may list and read detail; SUPER_ADMIN cannot', async () => {
    for (const role of [UserRole.OWNER, UserRole.WAREHOUSE]) {
      const list = await request(role, '/api/exchanges')
      const detail = await request(role, `/api/exchanges/${firstExchangeId}`)
      assert.equal(list.status, 200)
      assert.equal(detail.status, 200)
      for (const response of [list, detail]) {
        assert.doesNotMatch(JSON.stringify(await response.json()), /unitCostAtSale|lastPurchaseCost|cost|COGS|profit|margin|currentStock|movement|idempotencyKey|requestFingerprint/i)
      }
    }
    assert.equal((await request(UserRole.SUPER_ADMIN, '/api/exchanges')).status, 403)
    assert.equal((await request(UserRole.OWNER, '/api/exchanges/not-a-uuid')).status, 422)
  })
})
