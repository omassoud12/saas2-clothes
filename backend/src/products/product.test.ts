import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { describe, test } from 'node:test'
import express from 'express'
import sharp from 'sharp'
import type { AuthDependencies } from '../auth/auth.types.js'
import { HttpError } from '../errors/http-error.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { errorHandler } from '../middleware/error-handler.js'
import { productImageKey } from '../product-images/product-image-key.js'
import type { ProductImageStore } from '../product-images/r2-product-image-store.js'
import { createProductRouter } from './product.routes.js'
import {
  parseProductSetup,
  parseProductCreate,
  parseProductList,
  parseProductUpdate,
  parseVariantCreate,
  parseVariantUpdate,
} from './product.schemas.js'
import { createProductDependencies } from './product.service.js'

const accountA = '11111111-1111-4111-8111-111111111111'
const accountB = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const categoryA = '44444444-4444-4444-8444-444444444444'
const categoryB = '55555555-5555-4555-8555-555555555555'
const productA = '66666666-6666-4666-8666-666666666666'
const productB = '77777777-7777-4777-8777-777777777777'
const variantA = '88888888-8888-4888-8888-888888888888'
const now = new Date('2026-09-17T00:00:00.000Z')

function prismaError(code: string, target?: string[]) {
  return new Prisma.PrismaClientKnownRequestError('internal database detail', {
    code,
    clientVersion: 'test',
    meta: target ? { target } : undefined,
  })
}

function expectError(error: unknown, status: number, code: string): boolean {
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  assert.doesNotMatch(error.message, /prisma|database detail/i)
  return true
}

type CategoryRow = { id: string; accountId: string; name: string; isActive: boolean }
type VariantRow = {
  id: string
  accountId: string
  productId: string
  sku: string
  barcode: string | null
  color: string | null
  size: string | null
  sellingPrice: Prisma.Decimal | null
  currentStock: number
  lastPurchaseCost: Prisma.Decimal | null
  isActive: boolean
}
type ProductRow = {
  id: string
  accountId: string
  categoryId: string
  name: string
  imageKey: string | null
  profitMarginOverride: Prisma.Decimal | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  createdById: string
}

class CatalogDouble {
  readonly categories = new Map<string, CategoryRow>()
  readonly products = new Map<string, ProductRow>()
  readonly variants = new Map<string, VariantRow>()
  nextProductId = productA
  nextVariantId = variantA
  failPriceOnId: string | null = null
  failImageUpdate = false
  imageUpdates = 0

  constructor() {
    this.categories.set(categoryA, { id: categoryA, accountId: accountA, name: 'Pants', isActive: true })
    this.categories.set(categoryB, { id: categoryB, accountId: accountB, name: 'Other', isActive: true })
  }

  addProduct(id = productA, accountId = accountA, categoryId = categoryA): ProductRow {
    const row: ProductRow = {
      id, accountId, categoryId, name: 'Cargo Pants', imageKey: null,
      profitMarginOverride: new Prisma.Decimal('0.2500'), isActive: true,
      createdById: userId, createdAt: now, updatedAt: now,
    }
    this.products.set(id, row)
    return row
  }

  addVariant(id = variantA, productId = productA, accountId = accountA): VariantRow {
    const row: VariantRow = {
      id, productId, accountId, sku: 'SKU-1', barcode: 'CODE-1', color: 'Black', size: 'M',
      sellingPrice: new Prisma.Decimal('25.00'), currentStock: 7,
      lastPurchaseCost: new Prisma.Decimal('12.00'), isActive: true,
    }
    this.variants.set(id, row)
    return row
  }

  private withRelations(row: ProductRow) {
    const category = this.categories.get(row.categoryId)!
    return {
      ...row,
      category: { id: category.id, name: category.name },
      variants: [...this.variants.values()].filter((item) => item.productId === row.id && item.accountId === row.accountId),
    }
  }

  asClient(): PrismaClient {
    const store = this
    return {
      async $transaction<T>(callback: (tx: PrismaClient) => Promise<T>): Promise<T> {
        const snapshot = new Map([...store.variants].map(([id,row])=>[id,{...row}]))
        try { return await callback(store.asClient()) } catch(error) { store.variants.clear(); for(const [id,row] of snapshot)store.variants.set(id,row);throw error }
      },
      async $queryRaw(sql: Prisma.Sql) {
        const [id,accountId] = sql.values as string[]
        const product = store.products.get(id)
        return product?.accountId === accountId ? [{isActive:product.isActive}] : []
      },
      category: {
        async findFirst({ where }: { where: { id: string; accountId: string; isActive: boolean } }) {
          const category = store.categories.get(where.id)
          return category?.accountId === where.accountId && category.isActive === where.isActive ? { id: category.id } : null
        },
      },
      product: {
        async findUnique({ where }: { where: { id_accountId: { id: string; accountId: string } } }) {
          const row = store.products.get(where.id_accountId.id)
          return row?.accountId === where.id_accountId.accountId ? store.withRelations(row) : null
        },
        async findMany({ where, skip, take }: { where: { accountId: string; isActive?: boolean; categoryId?: string; OR?: unknown }; skip: number; take: number }) {
          return [...store.products.values()]
            .filter((row) => row.accountId === where.accountId && (where.isActive === undefined || row.isActive === where.isActive) && (!where.categoryId || row.categoryId === where.categoryId))
            .slice(skip, skip + take)
            .map((row) => store.withRelations(row))
        },
        async count({ where }: { where: { accountId: string; isActive?: boolean } }) {
          return [...store.products.values()].filter((row) => row.accountId === where.accountId && (where.isActive === undefined || row.isActive === where.isActive)).length
        },
        async create({ data }: { data: { accountId: string; categoryId: string; createdById: string; name: string; profitMarginOverride?: string | null } }) {
          if (!store.categories.has(data.categoryId)) throw prismaError('P2003')
          const row = store.addProduct(store.nextProductId, data.accountId, data.categoryId)
          row.name = data.name
          row.createdById = data.createdById
          row.profitMarginOverride = data.profitMarginOverride == null ? null : new Prisma.Decimal(data.profitMarginOverride)
          return store.withRelations(row)
        },
        async update({ where, data }: { where: { id_accountId: { id: string; accountId: string } }; data: Record<string, unknown> }) {
          const row = store.products.get(where.id_accountId.id)
          if (!row || row.accountId !== where.id_accountId.accountId) throw prismaError('P2025')
          Object.assign(row, data)
          if (data.profitMarginOverride !== undefined) {
            row.profitMarginOverride = data.profitMarginOverride === null ? null : new Prisma.Decimal(data.profitMarginOverride as string)
          }
          return store.withRelations(row)
        },
        async updateMany({ where, data }: { where: { id: string; accountId: string; imageKey: string | null }; data: { imageKey: string | null } }) {
          store.imageUpdates += 1
          if (store.failImageUpdate) throw new Error('database update failed')
          const row = store.products.get(where.id)
          if (!row || row.accountId !== where.accountId || row.imageKey !== where.imageKey) return { count: 0 }
          row.imageKey = data.imageKey
          return { count: 1 }
        },
      },
      productVariant: {
        async create({ data }: { data: { accountId: string; productId: string; sku: string; barcode?: string | null; color?: string | null; size?: string | null; sellingPrice?: string | null; currentStock: number; lastPurchaseCost: null } }) {
          for (const row of store.variants.values()) {
            if (row.accountId === data.accountId && row.sku === data.sku) throw prismaError('P2002', ['accountId', 'sku'])
            if (data.barcode && row.accountId === data.accountId && row.barcode === data.barcode) throw prismaError('P2002', ['accountId', 'barcode'])
          }
          if (store.variants.has(store.nextVariantId)) store.nextVariantId = randomUUID()
          const row: VariantRow = {
            id: store.nextVariantId, accountId: data.accountId, productId: data.productId,
            sku: data.sku, barcode: data.barcode ?? null, color: data.color ?? null,
            size: data.size ?? null, sellingPrice: data.sellingPrice == null ? null : new Prisma.Decimal(data.sellingPrice),
            currentStock: data.currentStock, lastPurchaseCost: data.lastPurchaseCost, isActive: true,
          }
          store.variants.set(row.id, row)
          return row
        },
        async updateMany({ where, data }: { where: { accountId: string; productId: string; isActive: boolean; id: { in: string[] } }; data: { sellingPrice: Prisma.Decimal } }) {
          let count=0
          for(const row of store.variants.values()) if(row.accountId===where.accountId&&row.productId===where.productId&&row.isActive===where.isActive&&where.id.in.includes(row.id)) {
            if(store.failPriceOnId===row.id)throw new Error('Price write failed')
            row.sellingPrice=data.sellingPrice;count++
          }
          return {count}
        },
        async update({ where, data }: { where: { id_productId_accountId: { id: string; productId: string; accountId: string } }; data: Record<string, unknown> }) {
          const route = where.id_productId_accountId
          const row = store.variants.get(route.id)
          if (!row || row.productId !== route.productId || row.accountId !== route.accountId) throw prismaError('P2025')
          if (store.failPriceOnId === row.id && data.sellingPrice !== undefined) throw new Error('Price write failed')
          Object.assign(row, data)
          if (data.sellingPrice !== undefined) row.sellingPrice = data.sellingPrice === null ? null : new Prisma.Decimal(data.sellingPrice as string)
          return row
        },
      },
    } as unknown as PrismaClient
  }
}

class ImageDouble implements ProductImageStore {
  readonly calls: string[] = []
  failDelete = false
  async upload(accountId: string, productId: string, key: string, webp: Buffer) {
    assert.equal((await sharp(webp).metadata()).format, 'webp')
    this.calls.push(`upload:${accountId}:${productId}:${key}`)
  }
  async signedReadUrl(accountId: string, productId: string, key: string) {
    this.calls.push(`sign:${accountId}:${productId}:${key}`)
    return 'https://signed.example/product.webp'
  }
  async delete(accountId: string, productId: string, key: string) {
    this.calls.push(`delete:${accountId}:${productId}:${key}`)
    if (this.failDelete) throw new HttpError(502, 'PRODUCT_IMAGE_DELETE_FAILED', 'Image deletion failed')
  }
}

function auth(role: UserRole, accountId = accountA): AuthDependencies {
  return {
    async verifyAccessToken() { return { id: userId, email: 'user@example.com', emailConfirmedAt: now.toISOString(), isAnonymous: false } },
    async findApplicationUser() { return { id: userId, role, accountId: role === UserRole.SUPER_ADMIN ? null : accountId, isActive: true } },
    async findAccountById() { return { id: accountId, status: AccountStatus.ACTIVE } },
    async findCurrentUser() { return null },
    async bootstrapOwner() { throw new Error('unused') },
  }
}

describe('Product catalog input', () => {
  test('rejects privileged and invalid Product fields', () => {
    for (const body of [{ categoryId: categoryA, name: ' ' }, { categoryId: categoryA, name: 'x'.repeat(151) }, { categoryId: categoryA, name: 'Pants', accountId: accountB }, { categoryId: categoryA, name: 'Pants', imageKey: 'forged' }]) {
      assert.throws(() => parseProductCreate(body, true), (error) => error instanceof HttpError)
    }
    assert.throws(() => parseProductCreate({ categoryId: categoryA, name: 'Pants', profitMarginOverride: '0.25' }, false), (error) => expectError(error, 422, 'SENSITIVE_FIELD_FORBIDDEN'))
    assert.throws(() => parseProductUpdate({ profitMarginOverride: '0.25' }, false), (error) => expectError(error, 422, 'SENSITIVE_FIELD_FORBIDDEN'))
    assert.equal(parseProductCreate({ categoryId: categoryA, name: '  Pants  ', profitMarginOverride: '0.2500' }, true).name, 'Pants')
    assert.throws(() => parseProductCreate({ categoryId: categoryA, name: 'Pants', profitMarginOverride: '1.2' }, true), (error) => error instanceof HttpError)
  })

  test('rejects stock/cost and validates Variant catalog fields', () => {
    assert.throws(() => parseVariantCreate({ sku: 'SKU', currentStock: 5 }, true), (error) => expectError(error, 422, 'INVALID_VARIANT_INPUT'))
    assert.throws(() => parseVariantCreate({ sku: 'SKU', lastPurchaseCost: '10' }, true), (error) => expectError(error, 422, 'INVALID_VARIANT_INPUT'))
    assert.throws(() => parseVariantUpdate({ currentStock: 5 }, true), (error) => expectError(error, 422, 'INVALID_VARIANT_INPUT'))
    assert.throws(() => parseVariantUpdate({ productId: productB }, true), (error) => expectError(error, 422, 'INVALID_VARIANT_INPUT'))
    assert.throws(() => parseVariantCreate({ sku: ' ', sellingPrice: '-1' }, true), (error) => error instanceof HttpError)
    assert.throws(() => parseVariantCreate({ sku: 'SKU', sellingPrice: '-1' }, true), (error) => expectError(error, 422, 'INVALID_CATALOG_PRICE'))
    assert.equal(parseVariantCreate({ sku: ' SKU ', barcode: '  ', sellingPrice: '25.00' }, true).barcode, null)
    assert.equal(parseVariantCreate({ sku: ' SKU ' }, false).sku, 'SKU')
    assert.equal(parseProductList({}).limit, 20)
    assert.throws(() => parseProductList({ limit: '1000' }), (error) => expectError(error, 422, 'INVALID_PRODUCT_FILTER'))
  })

  test('sellingPrice is writable only for OWNER', () => {
    assert.equal(parseVariantCreate({ sku: 'SKU', sellingPrice: '25.00' }, true).sellingPrice, '25.00')
    assert.equal(parseVariantUpdate({ sellingPrice: null }, true).sellingPrice, null)
    for (const sellingPrice of ['25.00', null]) {
      assert.throws(() => parseVariantCreate({ sku: 'SKU', sellingPrice }, false), (error) => expectError(error, 403, 'SENSITIVE_FIELD_FORBIDDEN'))
      assert.throws(() => parseVariantUpdate({ sellingPrice }, false), (error) => expectError(error, 403, 'SENSITIVE_FIELD_FORBIDDEN'))
    }
  })
})

describe('Product and Variant service', () => {
  test('OWNER and WAREHOUSE create tenant Products with role-aware fields', async () => {
    const ownerStore = new CatalogDouble()
    const owner = createProductDependencies(ownerStore.asClient(), () => new ImageDouble())
    const created = await owner.createProduct(accountA, userId, UserRole.OWNER, parseProductCreate({ categoryId: categoryA, name: ' Cargo Pants ', profitMarginOverride: '0.2500' }, true))
    assert.equal(created.name, 'Cargo Pants')
    assert.equal(created.profitMarginOverride, '0.25')
    assert.equal(ownerStore.products.get(productA)?.createdById, userId)
    assert.equal(ownerStore.products.get(productA)?.accountId, accountA)

    const warehouseStore = new CatalogDouble()
    const warehouse = createProductDependencies(warehouseStore.asClient(), () => new ImageDouble())
    const limited = await warehouse.createProduct(accountA, userId, UserRole.WAREHOUSE, parseProductCreate({ categoryId: categoryA, name: 'Cargo Pants' }, false))
    assert.equal(Object.hasOwn(limited, 'profitMarginOverride'), false)
    assert.equal(limited.imageUrl, null)
    await assert.rejects(warehouse.createProduct(accountA, userId, UserRole.WAREHOUSE, { categoryId: categoryA, name: 'Other', profitMarginOverride: '0.5' }), (error) => expectError(error, 403, 'SENSITIVE_FIELD_FORBIDDEN'))
    await assert.rejects(warehouse.updateProduct(accountA, productA, UserRole.WAREHOUSE, { profitMarginOverride: '0.5' }), (error) => expectError(error, 403, 'SENSITIVE_FIELD_FORBIDDEN'))
  })

  test('optional images do not make Product creation depend on R2 configuration', async () => {
    const store = new CatalogDouble()
    const service = createProductDependencies(store.asClient(), () => { throw new Error('R2 unavailable') })
    const created = await service.createProduct(accountA, userId, UserRole.OWNER, { categoryId: categoryA, name: 'Cargo Pants' })
    assert.equal(created.imageUrl, null)
    store.products.get(productA)!.imageKey = productImageKey(accountA, productA)
    const pictured = await service.getProduct(accountA, productA, UserRole.OWNER)
    assert.equal(pictured.imageUrl, null)
    assert.equal(pictured.imageStatus, 'unavailable')
  })

  test('rejects a foreign or inactive Category and scopes Product updates', async () => {
    const store = new CatalogDouble()
    const service = createProductDependencies(store.asClient(), () => new ImageDouble())
    await assert.rejects(service.createProduct(accountA, userId, UserRole.OWNER, { categoryId: categoryB, name: 'Pants' }), (error) => expectError(error, 404, 'CATEGORY_NOT_FOUND'))
    store.addProduct(productB, accountB, categoryB)
    await assert.rejects(service.updateProduct(accountA, productB, UserRole.OWNER, { name: 'Changed' }), (error) => expectError(error, 404, 'PRODUCT_NOT_FOUND'))
    await assert.rejects(service.getProduct(accountA, productB, UserRole.OWNER), (error) => expectError(error, 404, 'PRODUCT_NOT_FOUND'))
    const listed = await service.listProducts(accountA, UserRole.OWNER, { isActive: true, page: 1, limit: 20 })
    assert.equal(listed.total, 0)
    store.categories.get(categoryA)!.isActive = false
    await assert.rejects(service.createProduct(accountA, userId, UserRole.OWNER, { categoryId: categoryA, name: 'Pants' }), (error) => expectError(error, 404, 'CATEGORY_NOT_FOUND'))
  })

  test('deactivates/reactivates without deleting Product or Variant history', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    store.addVariant()
    const service = createProductDependencies(store.asClient(), () => new ImageDouble())
    assert.equal((await service.updateProduct(accountA, productA, UserRole.OWNER, { isActive: false })).isActive, false)
    assert.equal((await service.listProducts(accountA, UserRole.OWNER, { isActive: true, page: 1, limit: 20 })).total, 0)
    assert.equal((await service.updateProduct(accountA, productA, UserRole.OWNER, { isActive: true })).isActive, true)
    assert.equal((await service.updateVariant(accountA, productA, variantA, UserRole.OWNER, { isActive: false })).isActive, false)
    assert.equal((await service.updateVariant(accountA, productA, variantA, UserRole.OWNER, { isActive: true })).isActive, true)
    assert.equal(store.products.size, 1)
    assert.equal(store.variants.size, 1)
  })

  test('OWNER controls sellingPrice while stock and cost initialization remain protected', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    const service = createProductDependencies(store.asClient(), () => new ImageDouble())
    const priced = await service.createVariant(accountA, productA, UserRole.OWNER, parseVariantCreate({ sku: 'SKU-PRICED', sellingPrice: '25.00' }, true))
    assert.equal(priced.sellingPrice, '25')
    assert.equal(store.variants.get(variantA)?.sellingPrice?.toFixed(2), '25.00')
    assert.equal(priced.currentStock, 0)
    assert.equal(priced.lastPurchaseCost, null)

    const unpriced = await service.createVariant(accountA, productA, UserRole.OWNER, parseVariantCreate({ sku: 'SKU-UNPRICED', size: 'L' }, true))
    assert.equal(unpriced.sellingPrice, null)
    const updated = await service.updateVariant(accountA, productA, unpriced.id, UserRole.OWNER, { sellingPrice: '30.00' })
    assert.equal(updated.sellingPrice, '30')
  })

  test('WAREHOUSE may create unpriced Variants and read price, but cannot mutate price or see cost', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    const service = createProductDependencies(store.asClient(), () => new ImageDouble())
    const created = await service.createVariant(accountA, productA, UserRole.WAREHOUSE, parseVariantCreate({ sku: 'SKU-NEW', barcode: ' BAR ' }, false))
    assert.equal(created.sellingPrice, null)
    assert.equal(created.currentStock, 0)
    assert.equal(Object.hasOwn(created, 'lastPurchaseCost'), false)
    assert.equal(store.variants.get(variantA)?.lastPurchaseCost, null)
    assert.equal(store.variants.get(variantA)?.barcode, 'BAR')

    const initialCount = store.variants.size
    await assert.rejects(service.createVariant(accountA, productA, UserRole.WAREHOUSE, { sku: 'FORBIDDEN', sellingPrice: '10.00' }), (error) => expectError(error, 403, 'SENSITIVE_FIELD_FORBIDDEN'))
    assert.equal(store.variants.size, initialCount)

    store.variants.get(variantA)!.sellingPrice = new Prisma.Decimal('25.00')
    store.variants.get(variantA)!.lastPurchaseCost = new Prisma.Decimal('12.00')
    for (const sellingPrice of ['25.00', null]) {
      await assert.rejects(service.updateVariant(accountA, productA, variantA, UserRole.WAREHOUSE, { sellingPrice }), (error) => expectError(error, 403, 'SENSITIVE_FIELD_FORBIDDEN'))
      assert.equal(store.variants.get(variantA)?.sellingPrice?.toFixed(2), '25.00')
    }
    const limited = await service.getProduct(accountA, productA, UserRole.WAREHOUSE)
    assert.equal(Object.hasOwn(limited, 'profitMarginOverride'), false)
    assert.equal(limited.variants[0].sellingPrice, '25')
    assert.equal(Object.hasOwn(limited.variants[0], 'lastPurchaseCost'), false)
    const owner = await service.getProduct(accountA, productA, UserRole.OWNER)
    assert.equal(owner.variants[0].lastPurchaseCost, '12')
  })

  test('database uniqueness protects SKU and non-null barcode per tenant', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    store.addVariant()
    const service = createProductDependencies(store.asClient(), () => new ImageDouble())
    await assert.rejects(service.createVariant(accountA, productA, UserRole.OWNER, { sku: 'SKU-1' }), (error) => expectError(error, 409, 'VARIANT_SKU_ALREADY_EXISTS'))
    await assert.rejects(service.createVariant(accountA, productA, UserRole.OWNER, { sku: 'SKU-2', barcode: 'CODE-1' }), (error) => expectError(error, 409, 'VARIANT_BARCODE_ALREADY_EXISTS'))
    store.addProduct(productB, accountB, categoryB)
    const other = await service.createVariant(accountB, productB, UserRole.OWNER, { sku: 'SKU-1', barcode: 'CODE-1' })
    assert.equal(other.sku, 'SKU-1')
  })

  test('cross-tenant and cross-product Variant mutation is not found', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    store.addVariant()
    const service = createProductDependencies(store.asClient(), () => new ImageDouble())
    store.products.get(productA)!.isActive = false
    await assert.rejects(service.createVariant(accountA, productA, UserRole.OWNER, { sku: 'NEW' }), (error) => expectError(error, 409, 'PRODUCT_INACTIVE'))
    store.products.get(productA)!.isActive = true
    await assert.rejects(service.createVariant(accountB, productA, UserRole.OWNER, { sku: 'BAD' }), (error) => expectError(error, 404, 'PRODUCT_NOT_FOUND'))
    await assert.rejects(service.updateVariant(accountB, productA, variantA, UserRole.OWNER, { size: 'L' }), (error) => expectError(error, 404, 'VARIANT_NOT_FOUND'))
    await assert.rejects(service.updateVariant(accountA, productB, variantA, UserRole.OWNER, { size: 'L' }), (error) => expectError(error, 404, 'VARIANT_NOT_FOUND'))
    assert.equal(store.variants.get(variantA)?.size, 'M')
  })
})

describe('Product image orchestration', () => {
  test('first upload stores canonical key and signs URL at response time', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    const images = new ImageDouble()
    const service = createProductDependencies(store.asClient(), () => images)
    const buffer = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'red' } }).png().toBuffer()
    const result = await service.uploadImage(accountA, productA, UserRole.OWNER, buffer)
    const key = productImageKey(accountA, productA)
    assert.equal(store.products.get(productA)?.imageKey, key)
    assert.equal(result.imageUrl, 'https://signed.example/product.webp')
    assert.equal(Object.hasOwn(result, 'imageKey'), false)
    assert.equal(images.calls[0], `upload:${accountA}:${productA}:${key}`)
    assert.equal(images.calls[1], `sign:${accountA}:${productA}:${key}`)
  })

  test('ownership and invalid image are rejected before storage', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    const images = new ImageDouble()
    const service = createProductDependencies(store.asClient(), () => images)
    await assert.rejects(service.uploadImage(accountB, productA, UserRole.OWNER, Buffer.from('invalid')), (error) => expectError(error, 404, 'PRODUCT_NOT_FOUND'))
    await assert.rejects(service.uploadImage(accountA, productA, UserRole.OWNER, Buffer.from('invalid')), (error) => expectError(error, 422, 'PRODUCT_IMAGE_INVALID'))
    assert.deepEqual(images.calls, [])
  })

  test('first-upload DB failure attempts cleanup and preserves original failure', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    store.failImageUpdate = true
    const images = new ImageDouble()
    const service = createProductDependencies(store.asClient(), () => images)
    const buffer = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'red' } }).png().toBuffer()
    await assert.rejects(service.uploadImage(accountA, productA, UserRole.OWNER, buffer), /database update failed/)
    assert.equal(store.products.get(productA)?.imageKey, null)
    assert.equal(images.calls.filter((call) => call.startsWith('delete:')).length, 1)
  })

  test('cleanup failure does not hide the original DB failure', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    store.failImageUpdate = true
    const images = new ImageDouble()
    images.failDelete = true
    const service = createProductDependencies(store.asClient(), () => images)
    const buffer = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'red' } }).png().toBuffer()
    await assert.rejects(service.uploadImage(accountA, productA, UserRole.OWNER, buffer), /database update failed/)
    assert.equal(images.calls.filter((call) => call.startsWith('delete:')).length, 1)
  })

  test('replacement uses same key without changing DB reference', async () => {
    const store = new CatalogDouble()
    store.addProduct().imageKey = productImageKey(accountA, productA)
    const images = new ImageDouble()
    const service = createProductDependencies(store.asClient(), () => images)
    const buffer = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'blue' } }).png().toBuffer()
    await service.uploadImage(accountA, productA, UserRole.OWNER, buffer)
    assert.equal(store.imageUpdates, 0)
    assert.equal(images.calls.filter((call) => call.startsWith('upload:')).length, 1)
  })

  test('delete clears DB before deleting trusted key; arbitrary key is rejected', async () => {
    const store = new CatalogDouble()
    const row = store.addProduct()
    row.imageKey = productImageKey(accountA, productA)
    const images = new ImageDouble()
    images.failDelete = true
    const service = createProductDependencies(store.asClient(), () => images)
    await assert.rejects(service.deleteImage(accountA, productA), (error) => expectError(error, 502, 'PRODUCT_IMAGE_DELETE_FAILED'))
    assert.equal(row.imageKey, null)
    assert.equal(images.calls.filter((call) => call.startsWith('delete:')).length, 1)
    row.imageKey = 'tenants/other/products/other/main.webp'
    await assert.rejects(service.deleteImage(accountA, productA), (error) => expectError(error, 403, 'PRODUCT_IMAGE_KEY_FORBIDDEN'))
    assert.equal(images.calls.filter((call) => call.startsWith('delete:')).length, 1)
  })
})

describe('Product routes', () => {
  test('authenticates tenant, rejects hard-delete and privileged input, checks ownership before parsing upload', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    store.addVariant()
    const images = new ImageDouble()
    const app = express()
    app.use(express.json())
    app.use('/api/products', createProductRouter(auth(UserRole.WAREHOUSE), createProductDependencies(store.asClient(), () => images)))
    app.use(errorHandler)
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/products`
    try {
      const headers = { Authorization: 'Bearer token' }
      const unauthorized = await fetch(base)
      assert.equal(unauthorized.status, 401)
      const forbidden = await fetch(base, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: categoryA, name: 'Pants', profitMarginOverride: '0.5' }) })
      assert.equal(forbidden.status, 422)
      const forbiddenCost = await fetch(`${base}/${productA}/variants/${variantA}/opening-cost`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ unitCost: '8' }) })
      assert.equal(forbiddenCost.status, 403)
      const forbiddenQuickStock = await fetch(`${base}/${productA}/variants/${variantA}/quick-stock`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: '{}' })
      assert.equal(forbiddenQuickStock.status, 403)
      const variantCount = store.variants.size
      const forbiddenPriceCreate = await fetch(`${base}/${productA}/variants`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sku: 'FORBIDDEN-PRICE', sellingPrice: '10.00' }) })
      assert.equal(forbiddenPriceCreate.status, 403)
      assert.equal(store.variants.size, variantCount)
      for (const sellingPrice of ['25.00', null]) {
        const forbiddenPriceUpdate = await fetch(`${base}/${productA}/variants/${variantA}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sellingPrice }) })
        assert.equal(forbiddenPriceUpdate.status, 403)
        assert.equal(store.variants.get(variantA)?.sellingPrice?.toFixed(2), '25.00')
      }
      const unpricedCreate = await fetch(`${base}/${productA}/variants`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sku: 'WAREHOUSE-UNPRICED' }) })
      assert.equal(unpricedCreate.status, 201)
      const unpricedBody = await unpricedCreate.json() as { variant: Record<string, unknown> }
      assert.equal(unpricedBody.variant.sellingPrice, null)
      assert.equal(Object.hasOwn(unpricedBody.variant, 'lastPurchaseCost'), false)
      const missingImage = await fetch(`${base}/${productB}/image`, { method: 'POST', headers })
      assert.equal(missingImage.status, 404)
      const hardDelete = await fetch(`${base}/${productA}`, { method: 'DELETE', headers })
      assert.equal(hardDelete.status, 404)
      const arbitraryDelete = await fetch(`${base}/${productA}/image`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageKey: 'forged' }),
      })
      assert.equal(arbitraryDelete.status, 422)
      const detail = await fetch(`${base}/${productA}`, { headers })
      const body = await detail.json() as { product: Record<string, unknown> }
      assert.equal(Object.hasOwn(body.product, 'profitMarginOverride'), false)
      const variants = body.product.variants as Record<string, unknown>[]
      assert.equal(variants.some((variant) => variant.sellingPrice === '25'), true)
      assert.equal(variants.every((variant) => !Object.hasOwn(variant, 'lastPurchaseCost')), true)
      assert.deepEqual(images.calls, [])
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})

function openingFixture(failMovement = false) {
  const store = new CatalogDouble()
  store.addProduct()
  const client = store.asClient()
  const movements: { id?: string; performedById?: string; accountId: string; variantId: string; type: string; quantityChange: number; unitCost: Prisma.Decimal | null; note: string; idempotencyKey?: string; requestFingerprint?: string }[] = []
  let stockQueryCount = 0
  const tx = {
    ...client,
    async $queryRaw(sql: Prisma.Sql) {
      const statement = sql.strings.join('')
      if (statement.includes('WITH locked_product')) {
        stockQueryCount++
        const [productId, accountId, variantId, , operationId] = sql.values as string[]
        const product = store.products.get(productId)
        if (!product || product.accountId !== accountId) return []
        const variant = store.variants.get(variantId)
        const current = variant?.productId === productId && variant.accountId === accountId ? variant : { id:null }
        const replay = movements.find(m => m.id === operationId && m.accountId === accountId)
        return [{ ...current, productActive:product.isActive, replayVariantId:replay?.variantId ?? null, replayActorId:replay?.performedById ?? null, replayQuantity:replay?.quantityChange ?? null, replayType:replay?.type ?? null, replayNote:replay?.note ?? null }]
      }
      if (statement.includes('WITH updated AS')) {
        stockQueryCount++
        const [delta, variantId, productId, accountId, operationId, , performedById, type, quantity, cost, note, idempotencyKey, requestFingerprint] = sql.values as (string | null)[]
        const row = store.variants.get(variantId!)
        if (!row || row.productId !== productId || row.accountId !== accountId) return []
        row.currentStock += Number(delta)
        if (failMovement) throw new Error('ledger failed')
        movements.push({ id:operationId!, accountId:accountId!, variantId:variantId!, performedById:performedById!, type:type!, quantityChange:Number(quantity), unitCost:cost ? new Prisma.Decimal(cost) : null, note:note!, ...(idempotencyKey ? { idempotencyKey, requestFingerprint:requestFingerprint! } : {}) })
        return [row]
      }
      if (sql.strings.join('').includes('FROM "Category"')) {
        const [id, accountId] = sql.values as string[]
        const row = store.categories.get(id)
        return row?.accountId === accountId && row.isActive ? [row] : []
      }
      if (sql.strings.join('').includes('FROM "ProductVariant"')) {
        const [id, productId, accountId] = sql.values as string[]
        const row = store.variants.get(id)
        return row?.productId === productId && row.accountId === accountId ? [row] : []
      }
      const [id, accountId] = sql.values as string[]
      const row = store.products.get(id)
      return row?.accountId === accountId ? [row] : []
    },
    productVariant: {
      ...client.productVariant,
      async createMany({ data }: { data: (Omit<VariantRow, 'isActive' | 'sellingPrice'> & { sellingPrice: string | null })[] }) {
        for (const item of data) store.variants.set(item.id, { ...item, sellingPrice: item.sellingPrice ? new Prisma.Decimal(item.sellingPrice) : null, isActive: true })
        return { count: data.length }
      },
      async update(args: { where: { id_productId_accountId: { id: string; productId: string; accountId: string } }; data: Record<string, unknown> }) {
        const row = store.variants.get(args.where.id_productId_accountId.id)!
        if (store.failPriceOnId === row.id && args.data.sellingPrice !== undefined) throw new Error('Price write failed')
        if (typeof args.data.currentStock === 'object') row.currentStock += (args.data.currentStock as { increment: number }).increment
        else Object.assign(row, args.data)
        return row
      },
      async findUnique({ where }: { where: { id_productId_accountId: { id: string; productId: string; accountId: string } } }) {
        const key = where.id_productId_accountId, row = store.variants.get(key.id)
        return row?.productId === key.productId && row.accountId === key.accountId ? row : null
      },
    },
    inventoryMovement: {
      async createMany({ data }: { data: typeof movements }) { if (failMovement) throw new Error('ledger failed'); movements.push(...data); return { count: data.length } },
      async create({ data }: { data: typeof movements[number] }) { if (failMovement) throw new Error('ledger failed'); movements.push(data); return data },
      async findFirst({ where }: { where: { id: string; accountId: string } }) { return movements.find(m => m.id === where.id && m.accountId === where.accountId) ?? null },
      async count({ where }: { where: { accountId: string; variantId: string } }) { return movements.filter(m => m.accountId === where.accountId && m.variantId === where.variantId && !(m.unitCost === null && (['SALE','RETURN','SALE_VOID'].includes(m.type) || (m.type === 'ADJUSTMENT' && ((m.quantityChange === 1 && ['Opening stock: one piece; purchase cost pending.', 'Quick add: one piece; purchase cost pending.'].includes(m.note)) || (m.quantityChange === -1 && m.note === 'Quick remove: one piece; purchase cost pending.')))))).length },
      async aggregate({ where }: { where: { accountId: string; variantId: string } }) { return { _sum: { quantityChange: movements.filter(m => m.accountId === where.accountId && m.variantId === where.variantId).reduce((total, m) => total + m.quantityChange, 0) } } },
      async findMany({ where }: { where: { accountId: string; variantId: string } }) { return movements.filter(m => m.accountId === where.accountId && m.variantId === where.variantId) },
    },
  }
  const db = { ...client, async $transaction<T>(callback: (transaction: typeof tx) => Promise<T>) {
    const products = new Map(store.products)
    const snapshot = new Map([...store.variants].map(([id, row]) => [id, { ...row }]))
    const count = movements.length
    try { return await callback(tx) } catch (error) { store.products.clear(); for (const [id, row] of products) store.products.set(id, row); store.variants.clear(); for (const [id, row] of snapshot) store.variants.set(id, row); movements.length = count; throw error }
  } } as unknown as PrismaClient
  return { store, movements, get stockQueryCount() { return stockQueryCount }, service: createProductDependencies(db, () => new ImageDouble()) }
}

describe('opening piece and deferred purchase cost', () => {
  test('creates one unknown-cost piece with tenant/actor ledger, then sets cost without changing quantity or ledger', async () => {
    const { service, movements, store } = openingFixture()
    const variant = await service.createVariant(accountA, productA, UserRole.OWNER, { sku: 'OPENING', openingStock: true }, userId)
    assert.equal(variant.currentStock, 1)
    assert.equal(variant.lastPurchaseCost, null)
    assert.equal(movements.length, 1)
    assert.equal(movements[0].quantityChange, 1)
    assert.equal(movements[0].type, 'ADJUSTMENT')
    assert.equal(movements[0].accountId, accountA)
    const saved = await service.setOpeningCost(accountA, productA, variant.id, UserRole.OWNER, '8.1234')
    assert.equal(saved.currentStock, 1)
    assert.equal(saved.lastPurchaseCost, '8.1234')
    await service.setOpeningCost(accountA, productA, variant.id, UserRole.OWNER, '8.1234')
    await assert.rejects(service.setOpeningCost(accountA, productA, variant.id, UserRole.OWNER, '9'), e => expectError(e, 409, 'OPENING_COST_ALREADY_SET'))
    assert.equal(movements.length, 1)
    assert.equal(movements[0].unitCost, null)
    assert.equal(store.variants.get(variant.id)?.currentStock, 1)
  })
  test('ledger failure rolls back variant; WAREHOUSE and cross-tenant mutations are rejected', async () => {
    const failed = openingFixture(true)
    await assert.rejects(failed.service.createVariant(accountA, productA, UserRole.OWNER, { sku: 'OPENING', openingStock: true }, userId))
    assert.equal(failed.store.variants.size, 0)
    const { service } = openingFixture()
    assert.throws(() => parseVariantCreate({ sku: 'X', openingStock: true }, false), e => expectError(e, 403, 'SENSITIVE_FIELD_FORBIDDEN'))
    assert.throws(() => parseVariantCreate({ sku: 'X', openingStock: 2 }, true))
    await assert.rejects(service.createVariant(accountA, productA, UserRole.WAREHOUSE, { sku: 'OPENING', openingStock: true }, userId), e => expectError(e, 403, 'ROLE_FORBIDDEN'))
    await assert.rejects(service.setOpeningCost(accountA, productA, variantA, UserRole.WAREHOUSE, '8'), e => expectError(e, 403, 'ROLE_FORBIDDEN'))
    await assert.rejects(service.setOpeningCost(accountB, productA, variantA, UserRole.OWNER, '8'), e => expectError(e, 404, 'PRODUCT_NOT_FOUND'))
  })
  test('rejects invalid costs and ordinary or altered inventory', async () => {
    const { service, store } = openingFixture()
    store.addVariant().lastPurchaseCost = null
    await assert.rejects(service.setOpeningCost(accountA, productA, variantA, UserRole.OWNER, '8'), e => expectError(e, 409, 'OPENING_COST_UNAVAILABLE'))
    for (const cost of ['0', '-1', '1.12345', 'NaN', '100000000000000']) await assert.rejects(service.setOpeningCost(accountA, productA, variantA, UserRole.OWNER, cost), e => expectError(e, 422, 'INVALID_OPENING_COST'))
  })
})

describe('one-click stock addition', () => {
  test('each operation adds one piece; same-operation replay is harmless and pending cost can be set later', async () => {
    const { service, movements } = openingFixture()
    const created = await service.createVariant(accountA, productA, UserRole.OWNER, { sku: 'QUICK', openingStock: true }, userId)
    const key = randomUUID()
    const first = await service.quickAddStock(accountA, productA, created.id, UserRole.OWNER, userId, key)
    assert.equal(first.currentStock, 2)
    const replay = await service.quickAddStock(accountA, productA, created.id, UserRole.OWNER, userId, key)
    assert.equal(replay.currentStock, 2)
    await service.quickAddStock(accountA, productA, created.id, UserRole.OWNER, userId, randomUUID())
    assert.equal(movements.length, 3)
    assert.ok(movements.every(m => m.type === 'ADJUSTMENT' && m.unitCost === null))
    const costed = await service.setOpeningCost(accountA, productA, created.id, UserRole.OWNER, '8')
    assert.equal(costed.currentStock, 3)
    assert.equal(costed.lastPurchaseCost, '8')
    const pricedKey = randomUUID()
    const priced = await service.quickAddStock(accountA, productA, created.id, UserRole.OWNER, userId, pricedKey)
    assert.equal(priced.currentStock, 4)
    assert.equal(movements[3].type, 'RESTOCK')
    assert.equal(movements[3].unitCost?.toString(), '8')
    assert.equal(movements[3].idempotencyKey, pricedKey)
    assert.match(movements[3].requestFingerprint!, /^[0-9a-f]{64}$/)
  })
  test('isolates tenants, prevents non-owner/inactive changes and rolls back ledger failure', async () => {
    const { service, store } = openingFixture()
    store.addVariant()
    await assert.rejects(service.quickAddStock(accountB, productA, variantA, UserRole.OWNER, userId, randomUUID()), e => expectError(e, 404, 'PRODUCT_NOT_FOUND'))
    await assert.rejects(service.quickAddStock(accountA, productA, variantA, UserRole.WAREHOUSE, userId, randomUUID()), e => expectError(e, 403, 'ROLE_FORBIDDEN'))
    store.products.get(productA)!.isActive = false
    await assert.rejects(service.quickAddStock(accountA, productA, variantA, UserRole.OWNER, userId, randomUUID()), e => expectError(e, 409, 'PRODUCT_INACTIVE'))
    const failed = openingFixture(true)
    failed.store.addVariant()
    await assert.rejects(failed.service.quickAddStock(accountA, productA, variantA, UserRole.OWNER, userId, randomUUID()))
    assert.equal(failed.store.variants.get(variantA)?.currentStock, 7)
  })
})

describe('batched product setup', () => {
  test('creates all options and opening ledger entries in one atomic tenant operation', async () => {
    const { service, movements } = openingFixture()
    const options = ['XS','S','M','L','XL','XXL','3XL','4XL'].map(size => ({ sku:`BATCH-${size}`, size, color:'Black', openingStock:true, sellingPrice:'15' }))
    const product = await service.createProductSetup(accountA, userId, UserRole.OWNER, { name:'Batch', categoryId:categoryA }, options)
    assert.equal(product.variants.length, 8)
    assert.ok(product.variants.every(v => v.currentStock === 1 && v.lastPurchaseCost === null))
    assert.equal(movements.length, 8)
    assert.ok(movements.every(m => m.accountId === accountA && m.performedById === userId))
  })
  test('rejects foreign category, privileged warehouse input, duplicates and rolls back all writes on ledger failure', async () => {
    const { service } = openingFixture()
    await assert.rejects(service.createProductSetup(accountA, userId, UserRole.OWNER, { name:'Batch', categoryId:categoryB }, [{ sku:'X' }]), e => expectError(e, 404, 'CATEGORY_NOT_FOUND'))
    assert.throws(() => parseProductSetup({ product:{ name:'Batch', categoryId:categoryA }, variants:[{ sku:'X' },{ sku:'X' }] }, true))
    await assert.rejects(service.createProductSetup(accountA, userId, UserRole.WAREHOUSE, { name:'Batch', categoryId:categoryA }, [{ sku:'X', openingStock:true }]), e => expectError(e, 403, 'SENSITIVE_FIELD_FORBIDDEN'))
    const failed = openingFixture(true)
    await assert.rejects(failed.service.createProductSetup(accountA, userId, UserRole.OWNER, { name:'Batch', categoryId:categoryA }, [{ sku:'X', openingStock:true }]))
    assert.equal(failed.store.variants.size, 0)
    assert.equal(failed.movements.length, 0)
    assert.equal(failed.store.products.get(productA)?.name, 'Cargo Pants')
  })
})

test('quick stock requires two database statements for a new piece and one on replay', async () => {
  const fixture = openingFixture()
  fixture.store.addVariant()
  const id = randomUUID()
  await fixture.service.quickAddStock(accountA, productA, variantA, UserRole.OWNER, userId, id)
  assert.equal(fixture.stockQueryCount, 2)
  await fixture.service.quickAddStock(accountA, productA, variantA, UserRole.OWNER, userId, id)
  assert.equal(fixture.stockQueryCount, 3)
})

 test('quick stock removes one piece, replays safely and rejects negative stock or direction reuse', async () => {
  const fixture = openingFixture()
  const variant = await fixture.service.createVariant(accountA, productA, UserRole.OWNER, { sku: 'CORRECTION', openingStock: true }, userId)
  const key = randomUUID()
  assert.equal((await fixture.service.quickAddStock(accountA, productA, variant.id, UserRole.OWNER, userId, key, -1)).currentStock, 0)
  assert.equal((await fixture.service.quickAddStock(accountA, productA, variant.id, UserRole.OWNER, userId, key, -1)).currentStock, 0)
  assert.equal(fixture.movements.at(-1)?.quantityChange, -1)
  await assert.rejects(fixture.service.quickAddStock(accountA, productA, variant.id, UserRole.OWNER, userId, key, 1), e => expectError(e, 409, 'QUICK_STOCK_CONFLICT'))
  await assert.rejects(fixture.service.quickAddStock(accountA, productA, variant.id, UserRole.OWNER, userId, randomUUID(), -1), e => expectError(e, 409, 'INSUFFICIENT_STOCK'))
  await fixture.service.quickAddStock(accountA, productA, variant.id, UserRole.OWNER, userId, randomUUID(), 1)
  assert.equal((await fixture.service.setOpeningCost(accountA, productA, variant.id, UserRole.OWNER, '8')).currentStock, 1)
})

test('normalized combinations are enforced during create, edit and atomic setup',async()=>{
 const fixture=openingFixture();fixture.store.addVariant()
 await assert.rejects(fixture.service.createVariant(accountA,productA,UserRole.OWNER,{sku:'NEW',color:' black ',size:'m'}),e=>expectError(e,409,'VARIANT_COMBINATION_ALREADY_EXISTS'))
 const other=await fixture.service.createVariant(accountA,productA,UserRole.OWNER,{sku:'WHITE-M',color:'White',size:'M'})
 await assert.rejects(fixture.service.updateVariant(accountA,productA,other.id,UserRole.OWNER,{color:'BLACK'}),e=>expectError(e,409,'VARIANT_COMBINATION_ALREADY_EXISTS'))
 await assert.rejects(fixture.service.createProductSetup(accountA,userId,UserRole.OWNER,{name:'Duplicate',categoryId:categoryA},[{sku:'A',color:'Black',size:'M'},{sku:'B',color:' black ',size:'m'}]),e=>expectError(e,409,'VARIANT_COMBINATION_ALREADY_EXISTS'))
})
test('bulk pricing is OWNER-only, validates every target and rolls back all changes on failure',async()=>{
 const fixture=openingFixture();fixture.store.addVariant()
 const other=await fixture.service.createVariant(accountA,productA,UserRole.OWNER,{sku:'SECOND',color:'White',size:'M',sellingPrice:'19'})
 await assert.rejects(fixture.service.applyVariantPrice(accountA,productA,UserRole.WAREHOUSE,[variantA],'12'),e=>expectError(e,403,'ROLE_FORBIDDEN'))
 await assert.rejects(fixture.service.applyVariantPrice(accountA,productA,UserRole.OWNER,[variantA,randomUUID()],'12'),e=>expectError(e,409,'BULK_PRICE_TARGET_UNAVAILABLE'))
 assert.equal(fixture.store.variants.get(variantA)!.sellingPrice?.toFixed(2),'25.00')
 fixture.store.failPriceOnId=other.id
 await assert.rejects(fixture.service.applyVariantPrice(accountA,productA,UserRole.OWNER,[variantA,other.id],'12.50'))
 assert.equal(fixture.store.variants.get(variantA)!.sellingPrice?.toFixed(2),'25.00')
 fixture.store.failPriceOnId=null
 const product=await fixture.service.applyVariantPrice(accountA,productA,UserRole.OWNER,[variantA,other.id],'12.50')
 assert.ok(product.variants.every(v=>v.sellingPrice==='12.5'))
 await assert.rejects(fixture.service.applyVariantPrice(accountB,productA,UserRole.OWNER,[variantA],'1'),e=>expectError(e,404,'PRODUCT_NOT_FOUND'))
})
test('summary catalog keeps active prices and physical inactive stock without variant or financial fields',async()=>{
 const store=new CatalogDouble();store.addProduct();store.addVariant()
 const inactive=store.addVariant(randomUUID());inactive.isActive=false;inactive.currentStock=9;inactive.sellingPrice=new Prisma.Decimal('99')
 const result=await createProductDependencies(store.asClient(),()=>new ImageDouble()).listProductSummaries(accountA,{page:1,limit:12})
 assert.deepEqual(result.products[0].catalogSummary,{activeVariantCount:1,inactiveVariantCount:1,availableStock:'7',inactiveStock:'9',priceMin:'25.00',priceMax:'25.00'})
 assert.doesNotMatch(JSON.stringify(result),/lastPurchaseCost|profitMargin|sku|barcode|variants/)
})

test('cost entered after an uncosted sale changes only current variant basis',async()=>{
 const fixture=openingFixture()
 const variant=await fixture.service.createVariant(accountA,productA,UserRole.OWNER,{sku:'PENDING-SALE',openingStock:true},userId)
 fixture.store.variants.get(variant.id)!.currentStock=0
 fixture.movements.push({accountId:accountA,variantId:variant.id,type:'SALE',quantityChange:-1,unitCost:null,note:'Uncosted sale'})
 const updated=await fixture.service.setOpeningCost(accountA,productA,variant.id,UserRole.OWNER,'8.1234')
 assert.equal(updated.currentStock,0);assert.equal(updated.lastPurchaseCost,'8.1234')
 assert.equal(fixture.movements.at(-1)?.unitCost,null)
})

describe('Phase 3 image failure isolation', () => {
  test('summary and full catalogs isolate one failed signer and keep healthy or absent images', async () => {
    const store = new CatalogDouble()
    store.addProduct().imageKey = productImageKey(accountA, productA)
    store.addProduct(productB).imageKey = productImageKey(accountA, productB)
    const emptyId = randomUUID(); store.addProduct(emptyId)
    const images = new ImageDouble()
    images.signedReadUrl = async (_account, id) => {
      if (id === productA) throw new Error('signing unavailable')
      return 'https://images.example.test/healthy.webp'
    }
    const service = createProductDependencies(store.asClient(), () => images)
    for (const result of [await service.listProductSummaries(accountA,{page:1,limit:12}), await service.listProducts(accountA,UserRole.WAREHOUSE,{page:1,limit:12})]) {
      assert.equal(result.total,3)
      assert.equal(result.products.find(p=>p.id===productA)?.imageStatus,'unavailable')
      assert.equal(result.products.find(p=>p.id===productA)?.imageUrl,null)
      assert.equal(result.products.find(p=>p.id===productB)?.imageStatus,'available')
      assert.equal(result.products.find(p=>p.id===emptyId)?.imageStatus,'none')
      assert.doesNotMatch(JSON.stringify(result),/imageKey|lastPurchaseCost|profitMarginOverride/)
    }
  })
  test('catalog HTTP 200 and committed edit/price success survive unavailable image storage', async () => {
    const store=new CatalogDouble();store.addProduct().imageKey=productImageKey(accountA,productA);store.addVariant()
    store.addProduct(productB,accountB,categoryB)
    const service=createProductDependencies(store.asClient(),()=>{throw Error('storage unavailable')})
    const app=express();app.use(express.json());app.use('/api/products',createProductRouter(auth(UserRole.OWNER),service));app.use(errorHandler)
    const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))})
    const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/products`
    const headers={Authorization:'Bearer fixture','Content-Type':'application/json'}
    try {
      for(const query of ['', '?view=summary']) {
        const response=await fetch(base+query,{headers});assert.equal(response.status,200)
        const body=await response.json();assert.equal(body.products.length,1);assert.equal(body.products[0].imageStatus,'unavailable')
      }
      const edit=await fetch(`${base}/${productA}`,{method:'PATCH',headers,body:JSON.stringify({name:'Saved despite photo failure'})})
      assert.equal(edit.status,200);assert.equal((await edit.json()).product.imageStatus,'unavailable')
      assert.equal(store.products.get(productA)?.name,'Saved despite photo failure')
      const pricing=await fetch(`${base}/${productA}/variant-prices`,{method:'POST',headers,body:JSON.stringify({variantIds:[variantA],sellingPrice:'31.50'})})
      assert.equal(pricing.status,200);assert.equal((await pricing.json()).product.imageStatus,'unavailable')
      assert.equal(store.variants.get(variantA)?.sellingPrice?.toFixed(2),'31.50')
      const foreign=await fetch(`${base}/${productB}`,{headers});assert.equal(foreign.status,404)
    }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
  })
  test('canonical key validation remains mandatory even when signer is unavailable', async () => {
    const store=new CatalogDouble();store.addProduct().imageKey=productImageKey(accountB,productA)
    let signCalls=0
    const service=createProductDependencies(store.asClient(),()=>{signCalls++;throw Error('storage unavailable')})
    await assert.rejects(service.listProductSummaries(accountA,{page:1,limit:12}),e=>expectError(e,403,'PRODUCT_IMAGE_KEY_FORBIDDEN'))
    await assert.rejects(service.getProduct(accountA,productA,UserRole.OWNER),e=>expectError(e,403,'PRODUCT_IMAGE_KEY_FORBIDDEN'))
    assert.equal(signCalls,0)
  })
})

test('Phase 3 post-commit signer rejection preserves name and transactional bulk price success',async()=>{
 const store=new CatalogDouble();store.addProduct().imageKey=productImageKey(accountA,productA);store.addVariant()
 const images=new ImageDouble();images.signedReadUrl=async()=>{throw Error('signing failed')}
 const service=createProductDependencies(store.asClient(),()=>images)
 const edited=await service.updateProduct(accountA,productA,UserRole.WAREHOUSE,{name:'Warehouse saved'})
 assert.equal(edited.name,'Warehouse saved');assert.equal(edited.imageStatus,'unavailable')
 assert.equal(Object.hasOwn(edited,'profitMarginOverride'),false)
 assert.equal(Object.hasOwn(edited.variants[0],'lastPurchaseCost'),false)
 const priced=await service.applyVariantPrice(accountA,productA,UserRole.OWNER,[variantA],'44.25')
 assert.equal(priced.imageStatus,'unavailable');assert.equal(priced.variants[0].sellingPrice,'44.25')
 assert.equal(store.variants.get(variantA)?.sellingPrice?.toFixed(2),'44.25')
})
