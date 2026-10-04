import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { Pool } from 'pg'
import { UserRole } from '../src/generated/prisma/enums.js'
import { createPrismaClient } from '../src/lib/prisma.js'
import { createProductDependencies } from '../src/products/product.service.js'
import { createReceiptDependencies } from '../src/receipts/receipt.service.js'
import { parseReceipt, parseReceivingSetup } from '../src/receipts/receipt.schemas.js'
import { createRestockDependencies } from '../src/restocks/restock.service.js'
import { parseRestockInput } from '../src/restocks/restock.schemas.js'
import { createSaleDependencies } from '../src/sales/sale.service.js'
import { parseSaleInput } from '../src/sales/sale.schemas.js'

const databaseUrl = process.env.PHASE2_DATABASE_URL
if (!databaseUrl) throw new Error('PHASE2_DATABASE_URL is required')
const parsedUrl = new URL(databaseUrl)
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsedUrl.hostname.toLowerCase())) {
  throw new Error('Phase 2 harness refuses every non-loopback database')
}

const prisma = createPrismaClient(databaseUrl, { nodeEnvironment: 'test', caPath: '' })
const pool = new Pool({ connectionString: databaseUrl, max: 24 })
const receipts = createReceiptDependencies(prisma)
const restocks = createRestockDependencies(prisma)
const sales = createSaleDependencies(prisma)
const unavailableImageStore = () => { throw new Error('unused in Phase 2') }
const products = createProductDependencies(prisma, unavailableImageStore)

type Seed = {
  accountId: string
  userId: string
  categoryId: string
  productId: string
  variantIds: string[]
}

const results: Array<{ name: string; durationMs: number }> = []
const performanceResults: Array<{ options: number; durationMs: number }> = []

async function check(name: string, action: () => Promise<void>) {
  const started = performance.now()
  await action()
  const durationMs = performance.now() - started
  results.push({ name, durationMs })
  console.log(`PASS ${name} (${durationMs.toFixed(1)} ms)`)
}

async function expectCode(action: Promise<unknown>, expected: string) {
  try {
    await action
    assert.fail(`Expected ${expected}`)
  } catch (error) {
    assert.equal((error as { code?: string }).code, expected)
  }
}

async function seedProduct(optionCount = 1, stock = 0): Promise<Seed> {
  const accountId = randomUUID()
  const userId = randomUUID()
  const reviewerId = randomUUID()
  const categoryId = randomUUID()
  const productId = randomUUID()
  const prefix = randomUUID().slice(0, 8)
  const variantIds = Array.from({ length: optionCount }, () => randomUUID())
  await prisma.user.create({ data: { id: reviewerId, email: `admin-${prefix}@phase2.invalid`, firstName: 'Phase', lastName: 'Reviewer', role: UserRole.SUPER_ADMIN, accountId: null } })
  await prisma.account.create({ data: { id: accountId, name: `Phase2 ${prefix}`, baseCurrency: 'USD' } })
  await prisma.account.update({ where: { id: accountId }, data: { status: 'ACTIVE', reviewedAt: new Date(), reviewedById: reviewerId } })
  await prisma.user.create({ data: { id: userId, email: `${prefix}@phase2.invalid`, firstName: 'Phase', lastName: 'Two', role: UserRole.OWNER, accountId } })
  await prisma.category.create({ data: { id: categoryId, accountId, name: `Category ${prefix}` } })
  await prisma.product.create({ data: { id: productId, accountId, categoryId, name: `Product ${prefix}`, createdById: userId } })
  await prisma.productVariant.createMany({ data: variantIds.map((id, index) => ({
    id, accountId, productId, sku: `${prefix}-${String(index).padStart(3, '0')}`,
    color: `Color ${Math.floor(index / 10)}`, size: `Size ${index}`,
    sellingPrice: '10.00', currentStock: stock, lastPurchaseCost: stock > 0 ? '1.0000' : null,
  })) })
  return { accountId, userId, categoryId, productId, variantIds }
}

async function counts(seed: Pick<Seed, 'accountId' | 'productId'>) {
  const [receiptCount, itemCount, movementCount] = await Promise.all([
    prisma.stockReceipt.count({ where: { accountId: seed.accountId, productId: seed.productId } }),
    prisma.stockReceiptItem.count({ where: { accountId: seed.accountId, productId: seed.productId } }),
    prisma.inventoryMovement.count({ where: { accountId: seed.accountId, variant: { productId: seed.productId } } }),
  ])
  return { receiptCount, itemCount, movementCount }
}

async function withFailingReceiptItem(action: () => Promise<void>) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION phase2_fail_receipt_item() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'phase2 forced receipt item failure'; END $$;
    CREATE TRIGGER phase2_fail_receipt_item BEFORE INSERT ON "StockReceiptItem"
    FOR EACH ROW EXECUTE FUNCTION phase2_fail_receipt_item();
  `)
  try { await action() } finally {
    await pool.query('DROP TRIGGER IF EXISTS phase2_fail_receipt_item ON "StockReceiptItem"')
    await pool.query('DROP FUNCTION IF EXISTS phase2_fail_receipt_item()')
  }
}

async function run() {
  const migrationRows = await pool.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
    'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name',
  )
  assert.ok(migrationRows.rows.some(row => row.migration_name === '20260929190000_stock_receipts' && row.finished_at && !row.rolled_back_at))
  console.log(`PASS migrations applied (${migrationRows.rowCount} records)`)

  const deadlocksBefore = Number((await pool.query<{ deadlocks: string }>('SELECT deadlocks::text FROM pg_stat_database WHERE datname=current_database()')).rows[0]?.deadlocks ?? 0)

  await check('one-item receipt and linked RESTOCK contract', async () => {
    const seed = await seedProduct()
    const key = randomUUID()
    const response = await receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, key,
      parseReceipt({ unitCost: '1.2345', items: [{ variantId: seed.variantIds[0], quantity: 2 }] }))
    assert.equal(response.idempotentReplay, false)
    assert.equal(response.receipt.totalCost, '2.4690')
    const item = await prisma.stockReceiptItem.findFirstOrThrow({ where: { receiptId: response.receipt.id }, include: { movement: true, variant: true } })
    assert.equal(item.movement.type, 'RESTOCK')
    assert.equal(item.movementId, item.movement.id)
    assert.equal(item.variantId, item.movement.variantId)
    assert.equal(item.quantity, item.movement.quantityChange)
    assert.equal(item.unitCost.toFixed(4), item.movement.unitCost?.toFixed(4))
    assert.match(item.movement.idempotencyKey ?? '', /^[0-9a-f-]{36}$/)
    assert.match(item.movement.requestFingerprint ?? '', /^[0-9a-f]{64}$/)
  })

  await check('multi-item receipt precision and one movement per item', async () => {
    const seed = await seedProduct(3)
    const response = await receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(),
      parseReceipt({ unitCost: '0.3333', items: seed.variantIds.map((variantId, index) => ({ variantId, quantity: index + 1 })) }))
    assert.equal(response.receipt.totalQuantity, 6)
    assert.equal(response.receipt.totalCost, '1.9998')
    const variants = await prisma.productVariant.findMany({ where: { id: { in: seed.variantIds } }, orderBy: { sku: 'asc' } })
    assert.deepEqual(variants.map(row => row.currentStock), [1, 2, 3])
    assert.ok(variants.every(row => row.lastPurchaseCost?.toFixed(4) === '0.3333'))
    assert.deepEqual(await counts(seed), { receiptCount: 1, itemCount: 3, movementCount: 3 })
  })

  await check('same-key replay and changed-payload conflict', async () => {
    const seed = await seedProduct()
    const key = randomUUID()
    const input = parseReceipt({ unitCost: '2.0000', items: [{ variantId: seed.variantIds[0], quantity: 4 }] })
    assert.equal((await receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, key, input)).idempotentReplay, false)
    assert.equal((await receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, key, input)).idempotentReplay, true)
    await expectCode(receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, key,
      parseReceipt({ unitCost: '2.0000', items: [{ variantId: seed.variantIds[0], quantity: 5 }] })), 'RECEIPT_IDEMPOTENCY_CONFLICT')
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })).currentStock, 4)
    assert.deepEqual(await counts(seed), { receiptCount: 1, itemCount: 1, movementCount: 1 })
  })

  await check('receipt item failure rolls back stock, cost, receipt and movement', async () => {
    const seed = await seedProduct()
    await withFailingReceiptItem(async () => {
      await assert.rejects(receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(),
        parseReceipt({ unitCost: '3.0000', items: [{ variantId: seed.variantIds[0], quantity: 7 }] })))
    })
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })
    assert.equal(variant.currentStock, 0)
    assert.equal(variant.lastPurchaseCost, null)
    assert.deepEqual(await counts(seed), { receiptCount: 0, itemCount: 0, movementCount: 0 })
  })

  await check('new product and initial receipt roll back together', async () => {
    const seed = await seedProduct()
    const operationId = randomUUID()
    const marker = `Rollback ${randomUUID()}`
    const sku = `${randomUUID()}-A`
    const input = parseReceivingSetup({
      product: { name: marker, categoryId: seed.categoryId },
      variants: [{ sku, color: 'Black', size: 'M', sellingPrice: '12.00' }],
      receipt: { unitCost: '4.0000', items: [{ sku, quantity: 1 }] },
    }, true)
    await withFailingReceiptItem(async () => {
      await assert.rejects(receipts.createSetup(seed.accountId, seed.userId, UserRole.OWNER, operationId, input))
    })
    assert.equal(await prisma.product.count({ where: { accountId: seed.accountId, name: marker } }), 0)
    assert.equal(await prisma.stockReceipt.count({ where: { accountId: seed.accountId, operationId } }), 0)
  })

  await check('Save Product Only creates one replayable zero-stock definition', async () => {
    const seed = await seedProduct()
    const operationId = randomUUID()
    const sku = `${randomUUID()}-SAVE`
    const input = parseReceivingSetup({
      product: { name: `Save only ${randomUUID()}`, categoryId: seed.categoryId },
      variants: [{ sku, color: 'White', size: 'S' }],
    }, false)
    const first = await receipts.createSetup(seed.accountId, seed.userId, UserRole.WAREHOUSE, operationId, input)
    const replay = await receipts.createSetup(seed.accountId, seed.userId, UserRole.WAREHOUSE, operationId, input)
    assert.equal(first.receipt, null)
    assert.equal(first.idempotentReplay, false)
    assert.equal(replay.idempotentReplay, true)
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: first.productId } })
    assert.equal(variant.currentStock, 0)
    assert.equal(variant.lastPurchaseCost, null)
    assert.equal(await prisma.stockReceipt.count({ where: { productId: first.productId } }), 0)
    assert.equal(await prisma.inventoryMovement.count({ where: { variantId: variant.id } }), 0)
  })

  await check('tenant composite foreign keys reject cross-tenant receipt links', async () => {
    const left = await seedProduct()
    const right = await seedProduct()
    const response = await receipts.receiveExisting(left.accountId, left.userId, left.productId, randomUUID(),
      parseReceipt({ unitCost: '1.0000', items: [{ variantId: left.variantIds[0], quantity: 1 }] }))
    const movement = await prisma.inventoryMovement.create({ data: {
      accountId: left.accountId, variantId: left.variantIds[0]!, performedById: left.userId,
      type: 'ADJUSTMENT', quantityChange: 1, note: 'Phase 2 unused cross-tenant probe movement',
    } })
    await assert.rejects(pool.query(
      'INSERT INTO "StockReceiptItem" ("id","accountId","productId","receiptId","variantId","movementId","quantity","unitCost") VALUES ($1,$2,$3,$4,$5,$6,1,1.0000)',
      [randomUUID(), right.accountId, right.productId, response.receipt.id, right.variantIds[0], movement.id],
    ), (error: unknown) => (error as { code?: string }).code === '23503')
  })

  await check('inactive product and option reject receiving', async () => {
    const inactiveProduct = await seedProduct()
    await prisma.product.update({ where: { id: inactiveProduct.productId }, data: { isActive: false } })
    await expectCode(receipts.receiveExisting(inactiveProduct.accountId, inactiveProduct.userId, inactiveProduct.productId, randomUUID(),
      parseReceipt({ unitCost: '1', items: [{ variantId: inactiveProduct.variantIds[0], quantity: 1 }] })), 'PRODUCT_INACTIVE')
    const inactiveVariant = await seedProduct()
    await prisma.productVariant.update({ where: { id: inactiveVariant.variantIds[0] }, data: { isActive: false } })
    await expectCode(receipts.receiveExisting(inactiveVariant.accountId, inactiveVariant.userId, inactiveVariant.productId, randomUUID(),
      parseReceipt({ unitCost: '1', items: [{ variantId: inactiveVariant.variantIds[0], quantity: 1 }] })), 'VARIANT_INACTIVE')
  })

  await check('stock upper bound rolls back before receipt creation', async () => {
    const seed = await seedProduct(1, 2_147_483_647)
    await expectCode(receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(),
      parseReceipt({ unitCost: '1', items: [{ variantId: seed.variantIds[0], quantity: 1 }] })), 'STOCK_LIMIT_EXCEEDED')
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })).currentStock, 2_147_483_647)
    assert.deepEqual(await counts(seed), { receiptCount: 0, itemCount: 0, movementCount: 0 })
  })

  await check('purchase and receipt cost retain four-decimal precision', async () => {
    const seed = await seedProduct()
    const response = await receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(),
      parseReceipt({ unitCost: '0.1234', items: [{ variantId: seed.variantIds[0], quantity: 3 }] }))
    assert.equal(response.receipt.totalCost, '0.3702')
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })
    const item = await prisma.stockReceiptItem.findFirstOrThrow({ where: { receiptId: response.receipt.id } })
    assert.equal(variant.lastPurchaseCost?.toFixed(4), '0.1234')
    assert.equal(item.unitCost.toFixed(4), '0.1234')
  })

  await check('legacy single-option Restock remains valid and replay-safe', async () => {
    const seed = await seedProduct()
    const key = randomUUID()
    const input = parseRestockInput({ quantity: 3, unitCost: '2.3456', note: 'Phase 2 legacy check' })
    assert.equal((await restocks.restock(seed.accountId, seed.userId, seed.productId, seed.variantIds[0]!, key, input)).idempotentReplay, false)
    assert.equal((await restocks.restock(seed.accountId, seed.userId, seed.productId, seed.variantIds[0]!, key, input)).idempotentReplay, true)
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })).currentStock, 3)
    assert.equal(await prisma.inventoryMovement.count({ where: { accountId: seed.accountId, idempotencyKey: key } }), 1)
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { accountId: seed.accountId, idempotencyKey: key } })
    assert.match(movement.requestFingerprint ?? '', /^[0-9a-f]{64}$/)
    assert.equal(movement.unitCost?.toFixed(4), '2.3456')
  })

  await check('concurrent same receipt operation has one business effect', async () => {
    const seed = await seedProduct()
    const key = randomUUID()
    const input = parseReceipt({ unitCost: '1', items: [{ variantId: seed.variantIds[0], quantity: 5 }] })
    const responses = await Promise.all([
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, key, input),
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, key, input),
    ])
    assert.deepEqual(responses.map(row => row.idempotentReplay).sort(), [false, true])
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })).currentStock, 5)
    assert.deepEqual(await counts(seed), { receiptCount: 1, itemCount: 1, movementCount: 1 })
  })

  await check('concurrent different receipts on one option retain both increments', async () => {
    const seed = await seedProduct()
    await Promise.all([
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(), parseReceipt({ unitCost: '1', items: [{ variantId: seed.variantIds[0], quantity: 2 }] })),
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(), parseReceipt({ unitCost: '2', items: [{ variantId: seed.variantIds[0], quantity: 3 }] })),
    ])
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })).currentStock, 5)
    assert.deepEqual(await counts(seed), { receiptCount: 2, itemCount: 2, movementCount: 2 })
  })

  await check('different products are not globally serialized', async () => {
    const first = await seedProduct()
    const second = await seedProduct()
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    await blocker.query('SELECT id FROM "Product" WHERE id=$1 FOR UPDATE', [first.productId])
    const blockedReceipt = receipts.receiveExisting(first.accountId, first.userId, first.productId, randomUUID(),
      parseReceipt({ unitCost: '1', items: [{ variantId: first.variantIds[0], quantity: 1 }] }))
    await new Promise(resolve => setTimeout(resolve, 100))
    const independent = receipts.receiveExisting(second.accountId, second.userId, second.productId, randomUUID(),
      parseReceipt({ unitCost: '1', items: [{ variantId: second.variantIds[0], quantity: 1 }] }))
    const completed = await Promise.race([independent.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2_000))])
    assert.equal(completed, true)
    await blocker.query('COMMIT')
    blocker.release()
    await blockedReceipt
  })

  await check('receipt and Sale on one option serialize without lost stock', async () => {
    const seed = await seedProduct(1, 5)
    await prisma.inventoryMovement.create({ data: {
      accountId: seed.accountId, variantId: seed.variantIds[0]!, performedById: seed.userId,
      type: 'ADJUSTMENT', quantityChange: 5, note: 'Phase 2 opening fixture stock',
    } })
    await Promise.all([
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(), parseReceipt({ unitCost: '2', items: [{ variantId: seed.variantIds[0], quantity: 3 }] })),
      sales.createSale(seed.accountId, seed.userId, randomUUID(), parseSaleInput({ items: [{ variantId: seed.variantIds[0], quantity: 4, unitSoldPrice: '10.00' }] })),
    ])
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })).currentStock, 4)
    const ledger = await prisma.inventoryMovement.aggregate({ where: { accountId: seed.accountId, variantId: seed.variantIds[0] }, _sum: { quantityChange: true } })
    assert.equal(ledger._sum.quantityChange, 4)
  })

  await check('receipt and count correction serialize without lost stock', async () => {
    const seed = await seedProduct(1, 1)
    await Promise.all([
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(), parseReceipt({ unitCost: '2', items: [{ variantId: seed.variantIds[0], quantity: 2 }] })),
      products.quickAddStock(seed.accountId, seed.productId, seed.variantIds[0]!, UserRole.OWNER, seed.userId, randomUUID(), 1, true),
    ])
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })).currentStock, 4)
    const types = await prisma.inventoryMovement.findMany({ where: { accountId: seed.accountId, variantId: seed.variantIds[0] }, select: { type: true } })
    assert.deepEqual(types.map(row => row.type).sort(), ['ADJUSTMENT', 'RESTOCK'])
  })

  await check('receipt versus product deactivation is serialized and consistent', async () => {
    const seed = await seedProduct()
    const outcomes = await Promise.allSettled([
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(), parseReceipt({ unitCost: '2', items: [{ variantId: seed.variantIds[0], quantity: 2 }] })),
      products.updateProduct(seed.accountId, seed.productId, UserRole.OWNER, { isActive: false }),
    ])
    assert.equal(outcomes[1].status, 'fulfilled')
    const receiptSucceeded = outcomes[0].status === 'fulfilled'
    if (!receiptSucceeded) assert.equal((outcomes[0] as PromiseRejectedResult).reason.code, 'PRODUCT_INACTIVE')
    const product = await prisma.product.findUniqueOrThrow({ where: { id: seed.productId } })
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })
    assert.equal(product.isActive, false)
    assert.equal(variant.currentStock, receiptSucceeded ? 2 : 0)
    assert.equal((await counts(seed)).movementCount, receiptSucceeded ? 1 : 0)
  })

  await check('receipt versus option deactivation is serialized and consistent', async () => {
    const seed = await seedProduct()
    const outcomes = await Promise.allSettled([
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(), parseReceipt({ unitCost: '2', items: [{ variantId: seed.variantIds[0], quantity: 2 }] })),
      products.updateVariant(seed.accountId, seed.productId, seed.variantIds[0]!, UserRole.OWNER, { isActive: false }),
    ])
    assert.equal(outcomes[1].status, 'fulfilled')
    const receiptSucceeded = outcomes[0].status === 'fulfilled'
    if (!receiptSucceeded) assert.equal((outcomes[0] as PromiseRejectedResult).reason.code, 'VARIANT_INACTIVE')
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })
    assert.equal(variant.isActive, false)
    assert.equal(variant.currentStock, receiptSucceeded ? 2 : 0)
    assert.equal((await counts(seed)).movementCount, receiptSucceeded ? 1 : 0)
  })

  await check('concurrent same-key changed payload creates one effect and one conflict', async () => {
    const seed = await seedProduct()
    const key = randomUUID()
    const outcomes = await Promise.allSettled([
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, key, parseReceipt({ unitCost: '1', items: [{ variantId: seed.variantIds[0], quantity: 1 }] })),
      receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, key, parseReceipt({ unitCost: '1', items: [{ variantId: seed.variantIds[0], quantity: 2 }] })),
    ])
    assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1)
    const rejection = outcomes.find(row => row.status === 'rejected') as PromiseRejectedResult
    assert.equal(rejection.reason.code, 'RECEIPT_IDEMPOTENCY_CONFLICT')
    const stock = (await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantIds[0] } })).currentStock
    assert.ok(stock === 1 || stock === 2)
    assert.deepEqual(await counts(seed), { receiptCount: 1, itemCount: 1, movementCount: 1 })
  })

  for (const optionCount of [24, 100, 200]) {
    await check(`${optionCount}-option receipt performance`, async () => {
      const seed = await seedProduct(optionCount)
      const started = performance.now()
      await receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(),
        parseReceipt({ unitCost: '1.2345', items: seed.variantIds.map(variantId => ({ variantId, quantity: 1 })) }))
      const durationMs = performance.now() - started
      performanceResults.push({ options: optionCount, durationMs })
      assert.deepEqual(await counts(seed), { receiptCount: 1, itemCount: optionCount, movementCount: optionCount })
      assert.ok(durationMs < 15_000)
    })
  }

  await check('15-second receipt timeout rolls back an operation waiting on a row lock', async () => {
    const seed = await seedProduct()
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    await blocker.query('SELECT id FROM "Product" WHERE id=$1 FOR UPDATE', [seed.productId])
    const started = performance.now()
    try {
      await assert.rejects(receipts.receiveExisting(seed.accountId, seed.userId, seed.productId, randomUUID(),
        parseReceipt({ unitCost: '1', items: [{ variantId: seed.variantIds[0], quantity: 1 }] })))
      const elapsed = performance.now() - started
      assert.ok(elapsed >= 14_000 && elapsed < 20_000)
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
    }
    assert.deepEqual(await counts(seed), { receiptCount: 0, itemCount: 0, movementCount: 0 })
  })

  const deadlocksAfter = Number((await pool.query<{ deadlocks: string }>('SELECT deadlocks::text FROM pg_stat_database WHERE datname=current_database()')).rows[0]?.deadlocks ?? 0)
  assert.equal(deadlocksAfter, deadlocksBefore)
  const summary = { postgresVersion: (await pool.query<{ server_version: string }>('SHOW server_version')).rows[0]?.server_version, tests: results, performance: performanceResults, deadlocksBefore, deadlocksAfter }
  console.log(`PHASE2_RESULT ${JSON.stringify(summary)}`)
}

run().finally(async () => {
  await prisma.$disconnect()
  await pool.end()
}).catch(error => {
  console.error('PHASE2_FAILURE', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error')
  process.exitCode = 1
})
