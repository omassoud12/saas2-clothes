// Test-only helpers: a throwaway database on the local dev Postgres (backend/scripts/dev-db.mjs) with every
// migration applied, plus fixtures that insert accounts, users, products, sales, voids and returns directly.
// When the local server is not running, `createTestDatabase()` returns null and the tests are skipped.
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createPrismaClient } from '../lib/prisma.js'
import type { PrismaClient } from '../generated/prisma/client.js'

const serverUrl = process.env.TEST_DATABASE_SERVER_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres'

export interface TestDatabase {
  readonly url: string
  readonly prisma: PrismaClient
  readonly sql: pg.Client
  drop(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase | null> {
  const host = new URL(serverUrl).hostname
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Tests only run against a local database')
  const admin = new pg.Client({ connectionString: serverUrl, connectionTimeoutMillis: 1500 })
  try {
    await admin.connect()
  } catch {
    return null
  }
  const name = `saas2_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`)
  }
  await admin.query(`CREATE DATABASE "${name}"`)
  const url = serverUrl.replace(/\/[^/]*$/, `/${name}`)
  // Exactly what production runs: prisma migrate deploy, every migration in order.
  const migrated = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, NODE_ENV: 'test' },
    shell: process.platform === 'win32',
    encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(`migrations failed: ${migrated.stdout}${migrated.stderr}`)
  const sql = new pg.Client({ connectionString: url })
  await sql.connect()
  const prisma = createPrismaClient(url, { caPath: '', nodeEnvironment: 'test' })
  return {
    url, prisma, sql,
    async drop() {
      await prisma.$disconnect()
      await sql.end()
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    },
  }
}

export interface FixtureUser { readonly id: string; readonly name: string; readonly code: string | null; readonly role: 'OWNER' | 'WAREHOUSE' }
export interface FixtureVariant { readonly id: string; readonly productId: string; readonly categoryId: string; readonly sku: string; readonly color: string | null; readonly size: string | null; readonly productName: string; readonly categoryName: string }
export interface FixtureAccount {
  readonly accountId: string
  readonly storeId: string
  readonly owner: FixtureUser
  readonly staff: FixtureUser
  readonly variants: readonly FixtureVariant[]
}

let receiptCounter = 0

export async function seedAccount(sql: pg.Client, options: { name?: string; timezone?: string } = {}): Promise<FixtureAccount> {
  const accountId = randomUUID()
  const name = options.name ?? 'Test shop'
  await sql.query(`INSERT INTO "Account" ("id", "name", "timezone", "updatedAt") VALUES ($1, $2, $3, now())`, [accountId, name, options.timezone ?? 'Asia/Beirut'])
  const storeId = randomUUID()
  await sql.query(`INSERT INTO "Store" ("id", "accountId", "name", "isDefault", "updatedAt") VALUES ($1, $2, $3, true, now())`, [storeId, accountId, name])
  const owner = { id: randomUUID(), name: 'Abu Ali', code: null, role: 'OWNER' as const }
  const staff = { id: randomUUID(), name: 'Rami Haddad', code: 'R1', role: 'WAREHOUSE' as const }
  for (const user of [owner, staff]) {
    const [first, last] = user.name.split(' ')
    await sql.query(`INSERT INTO "User" ("id", "email", "firstName", "lastName", "employeeCode", "role", "employeeRole", "accountId", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7::"EmployeeRole", $8, now())`, [user.id, `${user.id}@test.local`, first, last, user.code, user.role, user.role === 'WAREHOUSE' ? 'WAREHOUSE' : null, accountId])
  }
  const categoryId = randomUUID()
  await sql.query(`INSERT INTO "Category" ("id", "accountId", "name", "updatedAt") VALUES ($1, $2, 'Shirts', now())`, [categoryId, accountId])
  const productId = randomUUID()
  await sql.query(`INSERT INTO "Product" ("id", "accountId", "categoryId", "name", "createdById", "updatedAt") VALUES ($1, $2, $3, 'Linen shirt', $4, now())`, [productId, accountId, categoryId, owner.id])
  const variants: FixtureVariant[] = []
  for (const [color, size] of [['Beige', 'M'], ['White', 'L'], ['Black', null]] as const) {
    const id = randomUUID()
    const sku = `LIN-${color}-${size ?? 'OS'}-${id.slice(0, 4)}`
    await sql.query(`INSERT INTO "ProductVariant" ("id", "accountId", "productId", "sku", "color", "size", "lastPurchaseCost", "sellingPrice", "currentStock", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, 20, 35, 10, now())`, [id, accountId, productId, sku, color, size])
    variants.push({ id, productId, categoryId, sku, color, size, productName: 'Linen shirt', categoryName: 'Shirts' })
  }
  return { accountId, storeId, owner, staff, variants }
}

export interface SaleLine { readonly variant: FixtureVariant; readonly quantity: number; readonly price: string; readonly cost: string | null }

export async function addSale(sql: pg.Client, account: FixtureAccount, options: {
  at: string; seller?: FixtureUser; method?: 'CASH' | 'CARD' | 'WHISH_OMT' | 'DEBT'; lines: readonly SaleLine[]; discount?: string
}): Promise<{ saleId: string; itemIds: string[] }> {
  const seller = options.seller ?? account.owner
  const saleId = randomUUID()
  const total = options.lines.reduce((sum, line) => sum + Number(line.price) * line.quantity, 0)
  const discount = Number(options.discount ?? '0')
  receiptCounter += 1
  await sql.query(`INSERT INTO "Sale" ("id", "accountId", "soldById", "idempotencyKey", "requestFingerprint", "sellerNameAtSale", "sellerCodeAtSale",
      "currency", "subtotal", "totalAmount", "discountAmount", "paymentMethod", "customerName", "receiptNumber", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'USD', $8, $9, $10, $11, $12, $13, $14, $14)`, [
    saleId, account.accountId, seller.id, randomUUID(), 'f'.repeat(64), seller.name, seller.code,
    (total + discount).toFixed(2), total.toFixed(2), discount.toFixed(2), options.method ?? 'CASH',
    options.method === 'DEBT' ? 'Rana' : null, receiptCounter, options.at,
  ])
  const itemIds: string[] = []
  for (const line of options.lines) {
    const id = randomUUID()
    itemIds.push(id)
    const variant = line.variant
    await sql.query(`INSERT INTO "SaleItem" ("id", "accountId", "saleId", "productId", "variantId", "categoryId", "productNameAtSale", "categoryNameAtSale",
        "skuAtSale", "colorAtSale", "sizeAtSale", "quantity", "unitSoldPrice", "unitCostAtSale", "lineTotal", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`, [
      id, account.accountId, saleId, variant.productId, variant.id, variant.categoryId, variant.productName, variant.categoryName,
      variant.sku, variant.color, variant.size, line.quantity, line.price, line.cost, (Number(line.price) * line.quantity).toFixed(2), options.at,
    ])
  }
  return { saleId, itemIds }
}

export async function voidSale(sql: pg.Client, account: FixtureAccount, saleId: string, at: string): Promise<void> {
  await sql.query(`UPDATE "Sale" SET "status" = 'VOIDED', "voidedAt" = $1, "voidedById" = $2, "voidedByName" = $3, "voidedByCode" = NULL, "voidReason" = 'Test void', "updatedAt" = $1
    WHERE "id" = $4`, [at, account.owner.id, account.owner.name, saleId])
}

export async function addReturn(sql: pg.Client, account: FixtureAccount, options: {
  saleId: string; at: string; lines: readonly { itemId: string; variant: FixtureVariant; quantity: number; refund: string }[]
}): Promise<string> {
  const returnId = randomUUID()
  await sql.query(`INSERT INTO "SaleReturn" ("id", "accountId", "saleId", "idempotencyKey", "requestFingerprint", "processedById", "processedByName", "createdAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [returnId, account.accountId, options.saleId, randomUUID(), 'e'.repeat(64), account.owner.id, account.owner.name, options.at])
  for (const line of options.lines) {
    await sql.query(`INSERT INTO "SaleReturnItem" ("id", "accountId", "returnId", "saleId", "saleItemId", "variantId", "quantity", "refundAmount", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [randomUUID(), account.accountId, returnId, options.saleId, line.itemId, line.variant.id, line.quantity, line.refund, options.at])
  }
  return returnId
}
