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
        async update({ where, data }: { where: { id_productId_accountId: { id: string; productId: string; accountId: string } }; data: Record<string, unknown> }) {
          const route = where.id_productId_accountId
          const row = store.variants.get(route.id)
          if (!row || row.productId !== route.productId || row.accountId !== route.accountId) throw prismaError('P2025')
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
    assert.throws(() => parseVariantCreate({ sku: 'SKU', currentStock: 5 }), (error) => expectError(error, 422, 'INVALID_VARIANT_INPUT'))
    assert.throws(() => parseVariantCreate({ sku: 'SKU', lastPurchaseCost: '10' }), (error) => expectError(error, 422, 'INVALID_VARIANT_INPUT'))
    assert.throws(() => parseVariantUpdate({ currentStock: 5 }), (error) => expectError(error, 422, 'INVALID_VARIANT_INPUT'))
    assert.throws(() => parseVariantUpdate({ productId: productB }), (error) => expectError(error, 422, 'INVALID_VARIANT_INPUT'))
    assert.throws(() => parseVariantCreate({ sku: ' ', sellingPrice: '-1' }), (error) => error instanceof HttpError)
    assert.throws(() => parseVariantCreate({ sku: 'SKU', sellingPrice: '-1' }), (error) => expectError(error, 422, 'INVALID_CATALOG_PRICE'))
    assert.equal(parseVariantCreate({ sku: ' SKU ', barcode: '  ', sellingPrice: '25.00' }).barcode, null)
    assert.equal(parseVariantCreate({ sku: ' SKU ' }).sku, 'SKU')
    assert.equal(parseProductList({}).limit, 20)
    assert.throws(() => parseProductList({ limit: '1000' }), (error) => expectError(error, 422, 'INVALID_PRODUCT_FILTER'))
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
    await assert.rejects(service.getProduct(accountA, productA, UserRole.OWNER), (error) => expectError(error, 503, 'IMAGE_STORAGE_UNAVAILABLE'))
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

  test('new Variant has stock zero and null cost; WAREHOUSE cannot see cost', async () => {
    const store = new CatalogDouble()
    store.addProduct()
    const service = createProductDependencies(store.asClient(), () => new ImageDouble())
    const created = await service.createVariant(accountA, productA, UserRole.WAREHOUSE, parseVariantCreate({ sku: 'SKU-NEW', barcode: ' BAR ', sellingPrice: '25.00' }))
    assert.equal(created.currentStock, 0)
    assert.equal(Object.hasOwn(created, 'lastPurchaseCost'), false)
    assert.equal(store.variants.get(variantA)?.lastPurchaseCost, null)
    assert.equal(store.variants.get(variantA)?.barcode, 'BAR')
    store.variants.get(variantA)!.lastPurchaseCost = new Prisma.Decimal('12.00')
    const limited = await service.getProduct(accountA, productA, UserRole.WAREHOUSE)
    assert.equal(Object.hasOwn(limited, 'profitMarginOverride'), false)
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
      assert.deepEqual(images.calls, [])
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
