import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, SaleStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { createSaleRouter } from '../sales/sale.routes.js'
import type { SaleDependencies, SaleTransactionResult } from '../sales/sale.types.js'
import type { ReturnDependencies, ReturnView } from '../returns/return.types.js'
import {
  deterministicExchangeChildKey,
  exchangeAdvisoryKey,
  exchangeFingerprint,
  parseExchangeIdempotencyKey,
  parseExchangeInput,
  parseExchangeSaleId,
} from './exchange.schemas.js'
import { createExchangeDependencies } from './exchange.service.js'
import type { ExchangeDependencies, ExchangeInput } from './exchange.types.js'

const accountId = '11111111-1111-4111-8111-111111111111'
const otherAccountId = '22222222-2222-4222-8222-222222222222'
const ownerId = '33333333-3333-4333-8333-333333333333'
const warehouseId = '44444444-4444-4444-8444-444444444444'
const originalSaleId = '55555555-5555-4555-8555-555555555555'
const saleItemId = '66666666-6666-4666-8666-666666666666'
const variantId = '77777777-7777-4777-8777-777777777777'
const productId = '88888888-8888-4888-8888-888888888888'
const exchangeKey = '99999999-9999-4999-8999-999999999999'
const returnId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const replacementSaleId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const replacementItemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const exchangeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const now = new Date('2026-09-24T12:00:00.000Z')

const rawInput = {
  reason: '  E\u0301change  ',
  returnItems: [{ saleItemId, quantity: 1 }],
  replacementItems: [{ variantId, quantity: 1, unitSoldPrice: '40' }],
}

function expectHttp(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  assert.doesNotMatch(error.message, /prisma|sql|constraint|fingerprint/i)
  return true
}

function uniqueError(modelName: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('private database detail', {
    code: 'P2002', clientVersion: 'test', meta: { modelName, target: ['accountId', 'idempotencyKey'] },
  })
}

describe('Exchange request and canonical metadata', () => {
  test('normalizes reason, identifiers, price, and canonical order', () => {
    const input = parseExchangeInput(rawInput)
    assert.equal(input.reason, 'Échange')
    assert.equal(input.replacementItems[0]?.unitSoldPrice, '40.00')
    const reordered: ExchangeInput = {
      reason: 'Échange',
      returnItems: [
        { saleItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', quantity: 2 },
        ...input.returnItems,
      ],
      replacementItems: [
        { variantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', quantity: 2, unitSoldPrice: '12.30' },
        ...input.replacementItems,
      ],
    }
    const reversed = {
      ...reordered,
      returnItems: [...reordered.returnItems].reverse(),
      replacementItems: [...reordered.replacementItems].reverse(),
    }
    assert.equal(
      exchangeFingerprint(accountId.toUpperCase(), ownerId, originalSaleId, reordered),
      exchangeFingerprint(accountId, ownerId.toUpperCase(), originalSaleId.toUpperCase(), reversed),
    )
    assert.match(exchangeFingerprint(accountId, ownerId, originalSaleId, input), /^[0-9a-f]{64}$/)
  })

  test('fingerprint changes with tenant, actor, original Sale, reason, quantities, or price', () => {
    const input = parseExchangeInput(rawInput)
    const base = exchangeFingerprint(accountId, ownerId, originalSaleId, input)
    assert.notEqual(base, exchangeFingerprint(otherAccountId, ownerId, originalSaleId, input))
    assert.notEqual(base, exchangeFingerprint(accountId, warehouseId, originalSaleId, input))
    assert.notEqual(base, exchangeFingerprint(accountId, ownerId, returnId, input))
    assert.notEqual(base, exchangeFingerprint(accountId, ownerId, originalSaleId, { ...input, reason: 'Other' }))
    assert.notEqual(base, exchangeFingerprint(accountId, ownerId, originalSaleId, {
      ...input, returnItems: [{ saleItemId, quantity: 2 }],
    }))
    assert.notEqual(base, exchangeFingerprint(accountId, ownerId, originalSaleId, {
      ...input, replacementItems: [{ variantId, quantity: 1, unitSoldPrice: '41.00' }],
    }))
  })

  test('requires exactly one UUID idempotency header', () => {
    assert.throws(() => parseExchangeIdempotencyKey({}, []), (error) => expectHttp(error, 400, 'EXCHANGE_IDEMPOTENCY_KEY_REQUIRED'))
    assert.throws(() => parseExchangeIdempotencyKey({ 'idempotency-key': 'bad' }, ['Idempotency-Key', 'bad']), (error) => expectHttp(error, 400, 'EXCHANGE_IDEMPOTENCY_KEY_INVALID'))
    assert.throws(() => parseExchangeIdempotencyKey({ 'idempotency-key': exchangeKey }, ['Idempotency-Key', exchangeKey, 'idempotency-key', exchangeKey]), (error) => expectHttp(error, 400, 'EXCHANGE_IDEMPOTENCY_KEY_INVALID'))
    assert.equal(parseExchangeIdempotencyKey({ 'idempotency-key': exchangeKey.toUpperCase() }, ['Idempotency-Key', exchangeKey]), exchangeKey)
  })

  test('rejects malformed Sale IDs and privileged top-level fields', () => {
    assert.throws(() => parseExchangeSaleId('bad'), (error) => expectHttp(error, 422, 'INVALID_EXCHANGE_SALE_ID'))
    assert.throws(() => parseExchangeInput({ ...rawInput, accountId }), (error) => expectHttp(error, 422, 'INVALID_EXCHANGE_INPUT'))
  })

  test('rejects empty, duplicate, excessive, and malformed Return lines', () => {
    assert.throws(() => parseExchangeInput({ ...rawInput, returnItems: [] }), (error) => expectHttp(error, 422, 'RETURN_ITEMS_EMPTY'))
    assert.throws(() => parseExchangeInput({ ...rawInput, returnItems: Array.from({ length: 101 }, (_, index) => ({ saleItemId: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000001`, quantity: 1 })) }), (error) => expectHttp(error, 422, 'RETURN_ITEMS_TOO_LARGE'))
    assert.throws(() => parseExchangeInput({ ...rawInput, returnItems: [{ saleItemId, quantity: 1 }, { saleItemId, quantity: 2 }] }), (error) => expectHttp(error, 422, 'RETURN_DUPLICATE_SALE_ITEM'))
    assert.throws(() => parseExchangeInput({ ...rawInput, returnItems: [{ saleItemId, quantity: 0 }] }), (error) => expectHttp(error, 422, 'INVALID_RETURN_QUANTITY'))
  })

  test('rejects empty, duplicate, excessive, and invalid replacement lines', () => {
    assert.throws(() => parseExchangeInput({ ...rawInput, replacementItems: [] }), (error) => expectHttp(error, 422, 'SALE_CART_EMPTY'))
    assert.throws(() => parseExchangeInput({ ...rawInput, replacementItems: Array.from({ length: 101 }, (_, index) => ({ variantId: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000002`, quantity: 1, unitSoldPrice: '1.00' })) }), (error) => expectHttp(error, 422, 'SALE_CART_TOO_LARGE'))
    assert.throws(() => parseExchangeInput({ ...rawInput, replacementItems: [{ variantId, quantity: 1, unitSoldPrice: '1.00' }, { variantId, quantity: 2, unitSoldPrice: '2.00' }] }), (error) => expectHttp(error, 422, 'SALE_DUPLICATE_VARIANT'))
    assert.throws(() => parseExchangeInput({ ...rawInput, replacementItems: [{ variantId, quantity: 0, unitSoldPrice: '1.00' }] }), (error) => expectHttp(error, 422, 'INVALID_SALE_QUANTITY'))
    assert.throws(() => parseExchangeInput({ ...rawInput, replacementItems: [{ variantId, quantity: 1, unitSoldPrice: '0' }] }), (error) => expectHttp(error, 422, 'INVALID_SALE_PRICE'))
  })

  test('uses deterministic, distinct valid UUIDv5 child keys and deterministic advisory keys', () => {
    const returnKey = deterministicExchangeChildKey(exchangeKey, 'return')
    const saleKey = deterministicExchangeChildKey(exchangeKey, 'sale')
    assert.match(returnKey, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.match(saleKey, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.equal(returnKey, deterministicExchangeChildKey(exchangeKey, 'return'))
    assert.equal(saleKey, deterministicExchangeChildKey(exchangeKey, 'sale'))
    assert.notEqual(returnKey, saleKey)
    assert.equal(exchangeAdvisoryKey(accountId, exchangeKey), exchangeAdvisoryKey(accountId.toUpperCase(), exchangeKey.toUpperCase()))
    assert.notEqual(exchangeAdvisoryKey(accountId, exchangeKey), exchangeAdvisoryKey(otherAccountId, exchangeKey))
  })
})

type Row = Record<string, any>

class ExchangeDouble {
  exchanges: Row[] = []
  events: string[] = []
  actorRole: UserRole = UserRole.OWNER
  originalStatus: SaleStatus = SaleStatus.COMPLETED
  originalCurrency = 'USD'
  baseCurrency = 'USD'
  refundAmount = '30.00'
  replacementAmount = '40.00'
  replacementStatus: SaleStatus = SaleStatus.COMPLETED
  failAt: 'return' | 'sale' | 'link' | 'childUnique' | null = null
  injectAfterAdvisoryFingerprint: string | null = null

  private persisted(data: Row): Row {
    return {
      id: data.id,
      requestFingerprint: data.requestFingerprint,
      createdAt: now,
      saleReturn: {
        id: returnId, saleId: originalSaleId, processedByName: 'Ada Owner', processedByCode: null,
        reason: 'Échange', createdAt: now, sale: { currency: this.originalCurrency },
        items: [{
          saleItemId, variantId, quantity: 1, refundAmount: new Prisma.Decimal(this.refundAmount),
          saleItem: {
            productId, productNameAtSale: 'Historical Tee', categoryNameAtSale: 'Historical Shirts',
            skuAtSale: 'OLD-TEE', colorAtSale: 'Black', sizeAtSale: 'M',
          },
        }],
      },
      newSale: {
        id: replacementSaleId, status: this.replacementStatus, subtotal: new Prisma.Decimal(this.replacementAmount),
        totalAmount: new Prisma.Decimal(this.replacementAmount), sellerNameAtSale: 'Ada Owner', sellerCodeAtSale: null,
        createdAt: now,
        items: [{
          id: replacementItemId, productId, variantId, productNameAtSale: 'Current Tee',
          categoryNameAtSale: 'Shirts', skuAtSale: 'TEE-M', colorAtSale: 'Black', sizeAtSale: 'M',
          quantity: 1, unitSoldPrice: new Prisma.Decimal(this.replacementAmount), lineTotal: new Prisma.Decimal(this.replacementAmount),
        }],
      },
    }
  }

  asClient(): PrismaClient {
    const store = this
    const exchangeApi = {
      async findUnique({ where }: Row) {
        const unique = where.accountId_idempotencyKey
        const found = store.exchanges.find((row) => row.accountId === unique.accountId && row.idempotencyKey === unique.idempotencyKey)
        return found ? store.persisted(found) : null
      },
      async create({ data }: Row) {
        store.events.push('Exchange')
        if (store.failAt === 'link') throw new Error('private link failure')
        const row = { ...data, id: exchangeId }
        store.exchanges.push(row)
        return { id: row.id }
      },
    }
    const transaction = {
      exchange: exchangeApi,
      sale: {
        async findUnique() { return { id: originalSaleId } },
      },
      saleItem: {
        async findMany() { return [{ id: saleItemId, variantId }] },
      },
      productVariant: {
        async findMany() { return [{ id: variantId, productId }] },
      },
      async $queryRaw(sql: Prisma.Sql) {
        const text = sql.sql
        if (text.includes('pg_advisory_xact_lock')) {
          store.events.push('Advisory')
          if (store.injectAfterAdvisoryFingerprint) {
            store.exchanges.push({
              id: exchangeId,
              accountId,
              idempotencyKey: exchangeKey,
              requestFingerprint: store.injectAfterAdvisoryFingerprint,
            })
            store.injectAfterAdvisoryFingerprint = null
          }
          return []
        }
        if (text.includes('FROM "Account"')) { store.events.push('Account'); return [{ id: accountId, baseCurrency: store.baseCurrency }] }
        if (text.includes('FROM "User"')) { store.events.push('User'); return [{ id: ownerId, role: store.actorRole, isActive: true }] }
        if (text.includes('FROM "Sale"')) { store.events.push('Sale'); return [{ id: originalSaleId, status: store.originalStatus, currency: store.originalCurrency }] }
        if (text.includes('FROM "SaleItem"')) { store.events.push('SaleItem'); return [{ id: saleItemId, variantId }] }
        if (text.includes('FROM "ProductVariant"')) { store.events.push('Variant'); return [{ id: variantId, productId }] }
        if (text.includes('FROM "Product"')) { store.events.push('Product'); return [{ id: productId }] }
        throw new Error('unexpected query')
      },
    }
    return {
      exchange: exchangeApi,
      async $transaction(callback: (tx: unknown) => Promise<unknown>) {
        const snapshot = store.exchanges.map((row) => ({ ...row }))
        const eventCount = store.events.length
        try { return await callback(transaction) }
        catch (error) { store.exchanges = snapshot; store.events.splice(eventCount); throw error }
      },
    } as unknown as PrismaClient
  }

  primitives() {
    const store = this
    return {
      async createReturn(_transaction: unknown, operation: Row): Promise<ReturnView> {
        store.events.push('Return')
        assert.equal(operation.processedById, ownerId)
        assert.equal(operation.idempotencyKey, deterministicExchangeChildKey(exchangeKey, 'return'))
        if (store.failAt === 'return') throw new HttpError(409, 'RETURN_FAILED', 'Return failed')
        return {
          return: {
            id: returnId, saleId: originalSaleId, createdAt: now, reason: operation.input.reason,
            processor: { name: 'Ada Owner', employeeCode: null }, items: [], totalRefund: store.refundAmount,
          },
          idempotentReplay: false,
        }
      },
      async createSale(_transaction: unknown, context: Row, _input: unknown, operation: Row): Promise<SaleTransactionResult> {
        store.events.push('ReplacementSale')
        assert.equal(context.soldById, ownerId)
        assert.equal(operation.idempotencyKey, deterministicExchangeChildKey(exchangeKey, 'sale'))
        if (store.failAt === 'childUnique') throw uniqueError('Sale')
        if (store.failAt === 'sale') throw new HttpError(409, 'SALE_FAILED', 'Sale failed')
        return {
          id: replacementSaleId, status: SaleStatus.COMPLETED, currency: 'USD',
          subtotal: new Prisma.Decimal(store.replacementAmount), totalAmount: new Prisma.Decimal(store.replacementAmount), createdAt: now,
          sellerNameAtSale: 'Ada Owner', sellerCodeAtSale: null, items: [],
        }
      },
    } as never
  }
}

describe('Exchange transaction composition', () => {
  test('serializes same key, locks unified rows, creates Return before Sale and returns safe difference', async () => {
    const store = new ExchangeDouble()
    const service = createExchangeDependencies(store.asClient(), store.primitives())
    const result = await service.createExchange(accountId, ownerId, originalSaleId, exchangeKey, parseExchangeInput(rawInput))
    assert.deepEqual(store.events, ['Advisory', 'Account', 'User', 'Sale', 'SaleItem', 'Product', 'Variant', 'Return', 'ReplacementSale', 'Exchange'])
    assert.equal(result.idempotentReplay, false)
    assert.equal(result.exchange.originalSaleId, originalSaleId)
    assert.equal(result.exchange.return.totalRefund, '30.00')
    assert.equal(result.exchange.replacementSale.totalAmount, '40.00')
    assert.equal(result.exchange.differenceAmount, '10.00')
    assert.doesNotMatch(JSON.stringify(result), /unitCost|lastPurchase|currentStock|idempotencyKey|requestFingerprint|movement/i)
  })

  test('replays persisted history without transaction or child mutation', async () => {
    const store = new ExchangeDouble()
    const service = createExchangeDependencies(store.asClient(), store.primitives())
    const input = parseExchangeInput(rawInput)
    const first = await service.createExchange(accountId, ownerId, originalSaleId, exchangeKey, input)
    store.events = []
    const replay = await service.createExchange(accountId, ownerId, originalSaleId, exchangeKey, input)
    assert.equal(replay.idempotentReplay, true)
    assert.equal(replay.exchange.id, first.exchange.id)
    assert.deepEqual(store.events, [])
    assert.equal(store.exchanges.length, 1)
  })

  test('replays a replacement Sale that followed its normal lifecycle to VOIDED', async () => {
    const store = new ExchangeDouble()
    const service = createExchangeDependencies(store.asClient(), store.primitives())
    const input = parseExchangeInput(rawInput)
    await service.createExchange(accountId, ownerId, originalSaleId, exchangeKey, input)
    store.replacementStatus = SaleStatus.VOIDED
    const replay = await service.createExchange(accountId, ownerId, originalSaleId, exchangeKey, input)
    assert.equal(replay.exchange.replacementSale.status, SaleStatus.VOIDED)
    assert.equal(replay.idempotentReplay, true)
  })

  test('rechecks after the advisory lock so a same-key contender creates no child graph', async () => {
    const store = new ExchangeDouble()
    const input = parseExchangeInput(rawInput)
    store.injectAfterAdvisoryFingerprint = exchangeFingerprint(accountId, ownerId, originalSaleId, input)
    const result = await createExchangeDependencies(store.asClient(), store.primitives())
      .createExchange(accountId, ownerId, originalSaleId, exchangeKey, input)
    assert.equal(result.idempotentReplay, true)
    assert.deepEqual(store.events, ['Advisory'])
    assert.equal(store.exchanges.length, 1)
  })

  test('same key with changed semantics conflicts without mutation', async () => {
    const store = new ExchangeDouble()
    const service = createExchangeDependencies(store.asClient(), store.primitives())
    await service.createExchange(accountId, ownerId, originalSaleId, exchangeKey, parseExchangeInput(rawInput))
    store.events = []
    await assert.rejects(
      service.createExchange(accountId, ownerId, originalSaleId, exchangeKey, parseExchangeInput({
        ...rawInput, replacementItems: [{ variantId, quantity: 1, unitSoldPrice: '41.00' }],
      })),
      (error) => expectHttp(error, 409, 'EXCHANGE_IDEMPOTENCY_CONFLICT'),
    )
    assert.deepEqual(store.events, [])
  })

  test('serializes a negative difference as a signed two-decimal mathematical value', async () => {
    const store = new ExchangeDouble()
    store.refundAmount = '40.00'
    store.replacementAmount = '30.00'
    const result = await createExchangeDependencies(store.asClient(), store.primitives())
      .createExchange(accountId, ownerId, originalSaleId, exchangeKey, parseExchangeInput(rawInput))
    assert.equal(result.exchange.differenceAmount, '-10.00')
  })

  test('rolls back the outer graph when replacement Sale or Exchange link fails', async () => {
    for (const failAt of ['sale', 'link'] as const) {
      const store = new ExchangeDouble(); store.failAt = failAt
      const service = createExchangeDependencies(store.asClient(), store.primitives())
      await assert.rejects(service.createExchange(accountId, ownerId, originalSaleId, exchangeKey, parseExchangeInput(rawInput)))
      assert.equal(store.exchanges.length, 0)
    }
  })

  test('does not misclassify a child idempotency unique violation as Exchange replay', async () => {
    const store = new ExchangeDouble(); store.failAt = 'childUnique'
    await assert.rejects(
      createExchangeDependencies(store.asClient(), store.primitives())
        .createExchange(accountId, ownerId, originalSaleId, exchangeKey, parseExchangeInput(rawInput)),
      (error) => expectHttp(error, 503, 'EXCHANGE_UNAVAILABLE'),
    )
    assert.equal(store.exchanges.length, 0)
  })

  test('rejects VOIDED originals and currency mismatch before child creation', async () => {
    const voided = new ExchangeDouble(); voided.originalStatus = SaleStatus.VOIDED
    await assert.rejects(
      createExchangeDependencies(voided.asClient(), voided.primitives()).createExchange(accountId, ownerId, originalSaleId, exchangeKey, parseExchangeInput(rawInput)),
      (error) => expectHttp(error, 409, 'RETURN_SALE_NOT_RETURNABLE'),
    )
    assert.ok(!voided.events.includes('Return'))
    const currency = new ExchangeDouble(); currency.originalCurrency = 'EUR'
    await assert.rejects(
      createExchangeDependencies(currency.asClient(), currency.primitives()).createExchange(accountId, ownerId, originalSaleId, exchangeKey, parseExchangeInput(rawInput)),
      (error) => expectHttp(error, 409, 'EXCHANGE_CURRENCY_MISMATCH'),
    )
    assert.ok(!currency.events.includes('Return'))
  })
})

function auth(role: UserRole): AuthDependencies {
  const userId = role === UserRole.WAREHOUSE ? warehouseId : ownerId
  return {
    async verifyAccessToken() { return { id: userId, email: 'user@example.com', emailConfirmedAt: now.toISOString(), isAnonymous: false } },
    async findApplicationUser() {
      return { id: userId, role, accountId: role === UserRole.SUPER_ADMIN ? null : accountId, isActive: true }
    },
    async findAccountById() { return { id: accountId, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw new Error('unused') },
  }
}

async function request(role: UserRole, exchanges: ExchangeDependencies) {
  const app = express()
  app.use(express.json())
  app.use('/api/sales', createSaleRouter(auth(role), {} as SaleDependencies, {} as ReturnDependencies, exchanges))
  app.use(errorHandler)
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    return await fetch(`http://127.0.0.1:${port}/api/sales/${originalSaleId}/exchanges`, {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json', 'idempotency-key': exchangeKey },
      body: JSON.stringify(rawInput),
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

describe('Exchange route authorization and statuses', () => {
  test('allows OWNER and WAREHOUSE and maps create/replay to 201/200', async () => {
    for (const [role, replay, expected] of [[UserRole.OWNER, false, 201], [UserRole.WAREHOUSE, true, 200]] as const) {
      let actor = ''
      const response = await request(role, {
        async createExchange(_account, actorId) {
          actor = actorId
          return { exchange: {} as never, idempotentReplay: replay }
        },
      })
      assert.equal(response.status, expected)
      assert.equal(actor, role === UserRole.OWNER ? ownerId : warehouseId)
    }
  })

  test('rejects SUPER_ADMIN before the Exchange service', async () => {
    let called = false
    const response = await request(UserRole.SUPER_ADMIN, {
      async createExchange() { called = true; throw new Error('must not run') },
    })
    assert.equal(response.status, 403)
    assert.equal(called, false)
  })
})
