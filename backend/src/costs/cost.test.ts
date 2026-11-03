// Product cost entries on a throwaway local Postgres database (skipped when the local server is not running).
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import express from 'express'
import type { AuthDependencies } from '../auth/auth.types.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { addSale, createTestDatabase, seedAccount, type FixtureAccount } from '../business/business-test-db.js'
import { createReceiptDependencies } from '../receipts/receipt.service.js'
import { createCostDependencies, parseCostEntryInput, splitEvenly, unitCostOf } from './cost.service.js'
import { createCostRouter } from './cost.routes.js'

const db = await createTestDatabase()
const skip = !db
let shopA: FixtureAccount
let shopB: FixtureAccount
let base = ''
let server: ReturnType<express.Express['listen']> | null = null
let caller: { userId: string; role: UserRole; accountId: string; employeeRole?: string; permissions?: string[] } = { userId: '', role: UserRole.OWNER, accountId: '' }

const auth: AuthDependencies = {
  async verifyAccessToken() { return { id: caller.userId, email: 'user@example.com', emailConfirmedAt: '2026-01-01T00:00:00.000Z', isAnonymous: false } },
  async findApplicationUser() {
    return {
      id: caller.userId, role: caller.role, accountId: caller.accountId, isActive: true, status: 'ACTIVE' as const,
      employeeRole: caller.role === UserRole.WAREHOUSE ? caller.employeeRole ?? 'WAREHOUSE' : null,
      permissions: caller.permissions ?? [], permissionsCustom: caller.permissions !== undefined, mustChangePassword: false,
    }
  },
  async findAccountById() { return { id: caller.accountId, status: AccountStatus.ACTIVE } },
  async findCurrentUser() { return null },
  async bootstrapOwner() { throw Error('unused') },
}

before(async () => {
  if (!db) return
  shopA = await seedAccount(db.sql, { name: 'Hamra' })
  shopB = await seedAccount(db.sql, { name: 'Hamra' })
  const [beige, , black] = shopA.variants
  // An old sale at $20 cost, and black sold without any cost.
  await addSale(db.sql, shopA, { at: new Date(Date.now() - 2 * 86_400_000).toISOString(), lines: [{ variant: beige!, quantity: 1, price: '35.00', cost: '20.0000' }] })
  await db.sql.query(`UPDATE "ProductVariant" SET "lastPurchaseCost" = NULL WHERE "id" = $1`, [black!.id])
  await addSale(db.sql, shopA, { at: new Date(Date.now() - 86_400_000).toISOString(), lines: [{ variant: black!, quantity: 3, price: '48.00', cost: null }] })
  const costs = createCostDependencies(db.prisma, createReceiptDependencies(db.prisma))
  const app = express(); app.use(express.json())
  app.use('/api/products', createCostRouter(auth, costs))
  app.use(errorHandler)
  server = app.listen(0)
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await db?.drop()
})

const asOwner = (shop: FixtureAccount) => { caller = { userId: shop.owner.id, role: UserRole.OWNER, accountId: shop.accountId } }
const asEmployee = (shop: FixtureAccount, employeeRole: string, permissions?: string[]) => { caller = { userId: shop.staff.id, role: UserRole.WAREHOUSE, accountId: shop.accountId, employeeRole, permissions } }
async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() as any }
}
const variantRow = async (id: string) => (await db!.sql.query(`SELECT "lastPurchaseCost"::text AS cost, "costUpdatedAt", "currentStock" FROM "ProductVariant" WHERE "id" = $1`, [id])).rows[0]

describe('unit cost math', () => {
  test('total ÷ pieces, rounded half up to cents; pieces split evenly', () => {
    assert.equal(unitCostOf('96', 12).toFixed(2), '8.00')
    assert.equal(unitCostOf('10', 3).toFixed(2), '3.33')
    assert.equal(unitCostOf('0.05', 2).toFixed(2), '0.03')
    assert.equal(unitCostOf('100', 6).toFixed(2), '16.67')
    assert.deepEqual([...splitEvenly(10, ['a', 'b', 'c']).values()], [4, 3, 3])
    assert.deepEqual([...splitEvenly(2, ['a', 'b', 'c']).values()], [1, 1, 0])
  })

  test('input validation', () => {
    assert.throws(() => parseCostEntryInput({ quantity: 0, totalCost: '10' }), /quantity/)
    assert.throws(() => parseCostEntryInput({ quantity: 2.5, totalCost: '10' }), /quantity/)
    assert.throws(() => parseCostEntryInput({ quantity: 2, totalCost: '-1' }), /totalCost/)
    assert.throws(() => parseCostEntryInput({ quantity: 2, totalCost: '10.001' }), /totalCost/)
    assert.throws(() => parseCostEntryInput({ quantity: 1000, totalCost: '1' }), /at least 0.01/)
    assert.throws(() => parseCostEntryInput({ quantity: 2, totalCost: '10', accountId: 'x' }), /Unsupported/)
    assert.throws(() => parseCostEntryInput({ quantity: 4, totalCost: '10', addToStock: { perVariant: [{ variantId: '11111111-1111-4111-8111-111111111111', quantity: 3 }] } }), /add up/)
    assert.equal(parseCostEntryInput({ quantity: 12, totalCost: '96', supplierName: '  Abu Karim  ' }).supplierName, 'Abu Karim')
  })
})

describe('POST /api/products/:id/cost-entries', { skip }, () => {
  test('12 for $96 → $8 each on every variant, in one transaction with its audit row; old sales keep their cost', async () => {
    asOwner(shopA)
    const productId = shopA.variants[0]!.productId
    const { status, body } = await call('POST', `/api/products/${productId}/cost-entries`, { quantity: 12, totalCost: '96', supplierName: 'Abu Karim' })
    assert.equal(status, 201)
    assert.equal(body.unitCost, '8.00')
    assert.equal(body.variantsUpdated, 3)
    assert.equal(body.entry.allVariants, true)
    assert.equal(body.entry.appliesTo, 'VARIANTS')
    assert.equal(body.entry.addedToStock, false)
    for (const variant of shopA.variants) {
      const row = await variantRow(variant.id)
      assert.equal(Number(row.cost), 8)
      assert.ok(row.costUpdatedAt instanceof Date)
    }
    const audit = (await db!.sql.query(`SELECT "action", "actorId"::text AS actor, "before", "after" FROM "AuditLog" WHERE "accountId" = $1`, [shopA.accountId])).rows
    assert.equal(audit.length, 1)
    assert.equal(audit[0].action, 'product.cost.set')
    assert.equal(audit[0].actor, shopA.owner.id)
    assert.equal(audit[0].after.unitCost, '8.00')
    const old = (await db!.sql.query(`SELECT "unitCostAtSale"::text AS cost FROM "SaleItem" WHERE "accountId" = $1 AND "variantId" = $2`, [shopA.accountId, shopA.variants[0]!.id])).rows
    assert.deepEqual(old.map((row) => Number(row.cost)), [20])
  })

  test('one variant, with the pieces added to stock through the stock-receipt flow', async () => {
    asOwner(shopA)
    const [, white] = shopA.variants
    const before = await variantRow(white!.id)
    const { status, body } = await call('POST', `/api/products/${white!.productId}/cost-entries`, { variantIds: [white!.id], quantity: 6, totalCost: '60', addToStock: { storeId: shopA.storeId } })
    assert.equal(status, 201)
    assert.equal(body.unitCost, '10.00')
    assert.equal(body.entry.appliesTo, 'VARIANT')
    assert.equal(body.entry.allVariants, false)
    assert.equal(body.stockReceipt.totalQuantity, 6)
    const after = await variantRow(white!.id)
    assert.equal(after.currentStock, before.currentStock + 6)
    assert.equal(Number(after.cost), 10)
    const movement = (await db!.sql.query(`SELECT "type", "quantityChange", "unitCost"::text AS cost FROM "InventoryMovement" WHERE "variantId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [white!.id])).rows[0]
    assert.deepEqual({ type: movement.type, quantity: movement.quantityChange, cost: Number(movement.cost) }, { type: 'RESTOCK', quantity: 6, cost: 10 })
  })

  test('permissions, tenant isolation and bad input', async () => {
    const productId = shopA.variants[0]!.productId
    asEmployee(shopA, 'MANAGER')
    assert.equal((await call('POST', `/api/products/${productId}/cost-entries`, { quantity: 1, totalCost: '5' })).status, 403)
    asEmployee(shopA, 'CASHIER')
    assert.equal((await call('POST', `/api/products/${productId}/cost-entries`, { quantity: 1, totalCost: '5' })).status, 403)
    assert.equal((await call('GET', `/api/products/${productId}/cost-history`)).status, 403)
    // Allowed to set cost but not to touch stock.
    asEmployee(shopA, 'MANAGER', ['EDIT_PRODUCT_COST'])
    assert.equal((await call('POST', `/api/products/${productId}/cost-entries`, { quantity: 1, totalCost: '5', addToStock: { storeId: shopA.storeId } })).status, 403)
    asOwner(shopA)
    assert.equal((await call('POST', `/api/products/${productId}/cost-entries`, { quantity: 1, totalCost: '5', addToStock: { storeId: shopB.storeId } })).status, 403)
    assert.equal((await call('POST', `/api/products/${productId}/cost-entries`, { variantIds: [shopB.variants[0]!.id], quantity: 1, totalCost: '5' })).status, 404)
    assert.equal((await call('POST', `/api/products/${productId}/cost-entries`, { quantity: 0, totalCost: '5' })).status, 422)
    asOwner(shopB)
    assert.equal((await call('POST', `/api/products/${productId}/cost-entries`, { quantity: 1, totalCost: '5' })).status, 404)
    assert.equal((await call('GET', `/api/products/${productId}/cost-history`)).status, 404)
  })
})

describe('cost history and missing cost', { skip }, () => {
  test('history is newest first with cursor pages, and shows the current cost per variant', async () => {
    asOwner(shopA)
    const productId = shopA.variants[0]!.productId
    const first = (await call('GET', `/api/products/${productId}/cost-history?limit=1`)).body
    assert.equal(first.items.length, 1)
    assert.equal(first.items[0].unitCost, '10.00')
    assert.ok(first.nextCursor)
    const second = (await call('GET', `/api/products/${productId}/cost-history?limit=1&cursor=${first.nextCursor}`)).body
    assert.equal(second.items[0].unitCost, '8.00')
    assert.equal(second.nextCursor, null)
    assert.deepEqual(first.product.variants.map((variant: any) => variant.unitCost).sort(), ['10.00', '8.00', '8.00'])
    assert.equal((await call('GET', `/api/products/${productId}/cost-history?cursor=nope`)).status, 422)
  })

  test('missing cost lists variants without a cost, by what they sold without one', async () => {
    asOwner(shopB)
    await db!.sql.query(`UPDATE "ProductVariant" SET "lastPurchaseCost" = NULL WHERE "id" = $1`, [shopB.variants[2]!.id])
    await addSale(db!.sql, shopB, { at: new Date(Date.now() - 3_600_000).toISOString(), lines: [{ variant: shopB.variants[2]!, quantity: 2, price: '48.00', cost: null }] })
    const body = (await call('GET', '/api/products/missing-cost')).body
    assert.equal(body.productCount, 1)
    assert.equal(body.items[0].salesWithoutCost, '96.00')
    assert.equal(body.items[0].piecesWithoutCost, 2)
    assert.equal(body.items[0].variants[0].label, 'Black · One size')
    // Shop A set the cost of every variant above: nothing missing there.
    asOwner(shopA)
    assert.equal((await call('GET', '/api/products/missing-cost')).body.productCount, 0)
  })
})
