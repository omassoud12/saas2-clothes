import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { productImageKey, requireProductImageKey } from '../product-images/product-image-key.js'
import { uploadProductImage } from '../product-images/product-image.service.js'
import type { ProductImageStore } from '../product-images/r2-product-image-store.js'
import { restockFingerprint } from '../restocks/restock.schemas.js'
import { createRestockDependencies } from '../restocks/restock.service.js'
import type {
  ProductCreateInput,
  ProductDependencies,
  ProductListInput,
  ProductUpdateInput,
  ProductView,
  VariantCreateInput,
  VariantUpdateInput,
  VariantView,
} from './product.types.js'

const variantSelect = {
  id: true,
  sku: true,
  barcode: true,
  color: true,
  size: true,
  sellingPrice: true,
  currentStock: true,
  lastPurchaseCost: true,
  isActive: true,
} as const

const productSelect = {
  id: true,
  accountId: true,
  categoryId: true,
  name: true,
  imageKey: true,
  profitMarginOverride: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  variants: { select: variantSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] as Prisma.ProductVariantOrderByWithRelationInput[] },
} as const

type ProductRecord = Prisma.ProductGetPayload<{ select: typeof productSelect }>
type VariantRecord = Prisma.ProductVariantGetPayload<{ select: typeof variantSelect }>

function known(error: unknown, code: string): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

function productNotFound(): HttpError {
  return new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product does not exist')
}

function variantNotFound(): HttpError {
  return new HttpError(404, 'VARIANT_NOT_FOUND', 'Variant does not exist')
}

function mapVariantUnique(error: Prisma.PrismaClientKnownRequestError): HttpError {
  const target = JSON.stringify(error.meta?.target ?? error.meta?.constraint ?? '')
  if (target.includes('barcode')) return new HttpError(409, 'VARIANT_BARCODE_ALREADY_EXISTS', 'Barcode already exists in this account')
  if (target.includes('sku')) return new HttpError(409, 'VARIANT_SKU_ALREADY_EXISTS', 'SKU already exists in this account')
  return new HttpError(409, 'VARIANT_IDENTIFIER_ALREADY_EXISTS', 'SKU or barcode already exists in this account')
}

function variantView(variant: VariantRecord, role: UserRole): VariantView {
  return {
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    color: variant.color,
    size: variant.size,
    sellingPrice: variant.sellingPrice?.toString() ?? null,
    currentStock: variant.currentStock,
    isActive: variant.isActive,
    ...(role === UserRole.OWNER ? { lastPurchaseCost: variant.lastPurchaseCost?.toString() ?? null } : {}),
  }
}

export function createProductDependencies(
  prisma: PrismaClient,
  getImageStore: () => ProductImageStore,
): ProductDependencies {
  function imageStore(): ProductImageStore {
    try {
      return getImageStore()
    } catch {
      throw new HttpError(503, 'IMAGE_STORAGE_UNAVAILABLE', 'Image storage is unavailable')
    }
  }

  async function imageView(accountId: string, productId: string, imageKey: string | null): Promise<{ imageUrl: string | null; imageStatus: 'none' | 'available' | 'unavailable' }> {
    if (!imageKey) return { imageUrl: null, imageStatus: 'none' }
    // Authorization failures remain errors; never sign a noncanonical key.
    const key = requireProductImageKey(accountId, productId, imageKey)
    try {
      const imageUrl = await imageStore().signedReadUrl(accountId, productId, key)
      return { imageUrl, imageStatus: 'available' }
    } catch {
      // Preserve catalog data and successful writes when image infrastructure fails.
      return { imageUrl: null, imageStatus: 'unavailable' }
    }
  }

  async function productView(product: ProductRecord, role: UserRole): Promise<ProductView> {
    const image = await imageView(product.accountId, product.id, product.imageKey)
    return {
      id: product.id,
      name: product.name,
      category: { id: product.category.id, name: product.category.name },
      isActive: product.isActive,
      ...image,
      variants: product.variants.map((variant) => variantView(variant, role)),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      ...(role === UserRole.OWNER ? { profitMarginOverride: product.profitMarginOverride?.toString() ?? null } : {}),
    }
  }

  async function getProductRecord(accountId: string, productId: string): Promise<ProductRecord> {
    const product = await prisma.product.findUnique({
      where: { id_accountId: { id: productId, accountId } },
      select: productSelect,
    })
    if (!product) throw productNotFound()
    return product
  }

  async function requireActiveCategory(accountId: string, categoryId: string): Promise<void> {
    const category = await prisma.category.findFirst({
      where: { id: categoryId, accountId, isActive: true },
      select: { id: true },
    })
    if (!category) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'Active Category does not exist')
  }

  function catalogWhere(accountId: string, input: ProductListInput): Prisma.ProductWhereInput {
    return {
      accountId,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.search ? {
        OR: [
          { name: { contains: input.search, mode: 'insensitive' } },
          { variants: { some: { sku: { contains: input.search, mode: 'insensitive' } } } },
          { variants: { some: { barcode: { contains: input.search, mode: 'insensitive' } } } },
        ],
      } : {}),
    }
  }

  async function listProductSummaries(accountId: string, input: ProductListInput) {
    const where = catalogWhere(accountId, input)
    const [records,total] = await Promise.all([
      prisma.product.findMany({where, orderBy:[{createdAt:'desc'},{id:'desc'}], skip:(input.page-1)*input.limit, take:input.limit,
        select:{id:true,name:true,isActive:true,imageKey:true,category:{select:{id:true,name:true}},variants:{select:{isActive:true,currentStock:true,sellingPrice:true}}}}),
      prisma.product.count({where}),
    ])
    const products = await Promise.all(records.map(async record => {
      const active = record.variants.filter(v=>record.isActive&&v.isActive)
      const inactive = record.variants.filter(v=>!record.isActive||!v.isActive)
      const prices = active.flatMap(v=>v.sellingPrice===null?[]:[v.sellingPrice]).sort((a,b)=>a.comparedTo(b))
      const image = await imageView(accountId, record.id, record.imageKey)
      return {id:record.id,name:record.name,isActive:record.isActive,category:record.category,...image,
        catalogSummary:{activeVariantCount:active.length,inactiveVariantCount:inactive.length,availableStock:active.reduce((sum,v)=>sum+BigInt(v.currentStock),0n).toString(),inactiveStock:inactive.reduce((sum,v)=>sum+BigInt(v.currentStock),0n).toString(),priceMin:prices[0]?.toFixed(2)??null,priceMax:prices.at(-1)?.toFixed(2)??null}}
    }))
    return {products,total,page:input.page,limit:input.limit}
  }

  async function listProducts(accountId: string, role: UserRole, input: ProductListInput) {
    const where = catalogWhere(accountId, input)
    const [records, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        select: productSelect,
      }),
      prisma.product.count({ where }),
    ])
    return {
      products: await Promise.all(records.map((record) => productView(record, role))),
      total,
      page: input.page,
      limit: input.limit,
    }
  }

  async function getProduct(accountId: string, productId: string, role: UserRole): Promise<ProductView> {
    return productView(await getProductRecord(accountId, productId), role)
  }

  async function createProduct(accountId: string, createdById: string, role: UserRole, input: ProductCreateInput): Promise<ProductView> {
    if (role !== UserRole.OWNER && input.profitMarginOverride !== undefined) {
      throw new HttpError(403, 'SENSITIVE_FIELD_FORBIDDEN', 'profitMarginOverride is OWNER-only')
    }
    await requireActiveCategory(accountId, input.categoryId)
    try {
      const product = await prisma.product.create({
        data: {
          accountId,
          categoryId: input.categoryId,
          createdById,
          name: input.name,
          ...(input.profitMarginOverride !== undefined ? { profitMarginOverride: input.profitMarginOverride } : {}),
        },
        select: productSelect,
      })
      return productView(product, role)
    } catch (error) {
      if (known(error, 'P2003')) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'Active Category does not exist')
      throw error
    }
  }

  function combination(option: { color?: string | null; size?: string | null }): string {
    return JSON.stringify([option.color, option.size].map(value => (value ?? '').normalize('NFC').trim().toLowerCase()))
  }

  function assertUniqueCombination(option: { color?: string | null; size?: string | null }, variants: readonly { id?: string; color?: string | null; size?: string | null }[], excludeId?: string) {
    if (variants.some(existing => (!excludeId || existing.id !== excludeId) && combination(existing) === combination(option))) throw new HttpError(409, 'VARIANT_COMBINATION_ALREADY_EXISTS', 'This color and size already exist')
  }

  async function lockProduct(tx: Prisma.TransactionClient, accountId: string, productId: string) {
    const rows = await tx.$queryRaw<{ isActive: boolean }[]>(Prisma.sql`SELECT "isActive" FROM "Product" WHERE "id" = ${productId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`)
    if (!rows[0]) throw productNotFound()
    const product = await tx.product.findUnique({ where: { id_accountId: { id: productId, accountId } }, select: productSelect })
    if (!product) throw productNotFound()
    return product
  }

  async function applyVariantPrice(accountId: string, productId: string, role: UserRole, variantIds: readonly string[], sellingPrice: string): Promise<ProductView> {
    if (role !== UserRole.OWNER) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Pricing requires an owner')
    if (!variantIds.length || variantIds.length > 200 || new Set(variantIds).size !== variantIds.length || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(sellingPrice)) throw new HttpError(422, 'INVALID_BULK_PRICE', 'Choose 1 to 200 options and a nonnegative price')
    const updated = await prisma.$transaction(async tx => {
      const product = await lockProduct(tx, accountId, productId)
      if (!product.isActive || variantIds.some(id => !product.variants.some(v => v.id === id && v.isActive))) throw new HttpError(409, 'BULK_PRICE_TARGET_UNAVAILABLE', 'All selected options must belong to this active product and be active')
      // Product locks serialize all variant catalog changes. Updates are one transaction.
      const changed = await tx.productVariant.updateMany({ where: { accountId, productId, isActive: true, id: { in: [...variantIds] } }, data: { sellingPrice: new Prisma.Decimal(sellingPrice) } })
      if (changed.count !== variantIds.length) throw new HttpError(409, 'BULK_PRICE_TARGET_UNAVAILABLE', 'Selected options changed')
      const result = await tx.product.findUnique({ where: { id_accountId: { id: productId, accountId } }, select: productSelect })
      if (!result) throw productNotFound()
      return result
    })
    return productView(updated, role)
  }

  async function createProductSetup(accountId: string, createdById: string, role: UserRole, input: ProductCreateInput, options: readonly VariantCreateInput[]): Promise<ProductView> {
    if (role !== UserRole.OWNER && (input.profitMarginOverride !== undefined || options.some(option => option.openingStock || Object.hasOwn(option, 'sellingPrice')))) throw new HttpError(403, 'SENSITIVE_FIELD_FORBIDDEN', 'Stock and pricing require an owner')
    options.forEach((option, index) => assertUniqueCombination(option, options.slice(0, index)))
    if (!options.length || options.length > 200) throw new HttpError(422, 'INVALID_PRODUCT_SETUP', 'Choose 1 to 200 options')
    try {
      const product = await prisma.$transaction(async (tx) => {
        const categories = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Category" WHERE "id" = ${input.categoryId}::uuid AND "accountId" = ${accountId}::uuid AND "isActive" = true FOR SHARE`)
        if (!categories[0]) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'Active Category does not exist')
        const created = await tx.product.create({ data: { accountId, createdById, categoryId: input.categoryId, name: input.name, ...(input.profitMarginOverride !== undefined ? { profitMarginOverride: input.profitMarginOverride } : {}) }, select: { id: true } })
        const variants = options.map(option => ({ id: randomUUID(), accountId, productId: created.id, sku: option.sku, barcode: option.barcode ?? null, color: option.color ?? null, size: option.size ?? null, sellingPrice: role === UserRole.OWNER ? option.sellingPrice ?? null : null, currentStock: option.openingStock ? 1 : 0, lastPurchaseCost: null }))
        await tx.productVariant.createMany({ data: variants })
        const movements = variants.filter(variant => variant.currentStock === 1).map(variant => ({ accountId, variantId: variant.id, performedById: createdById, type: 'ADJUSTMENT' as const, quantityChange: 1, unitCost: null, note: 'Opening stock: one piece; purchase cost pending.' }))
        if (movements.length) await tx.inventoryMovement.createMany({ data: movements })
        const result = await tx.product.findUnique({ where: { id_accountId: { id: created.id, accountId } }, select: productSelect })
        if (!result) throw productNotFound()
        return result
      })
      return productView(product, role)
    } catch (error) {
      if (known(error, 'P2002')) throw mapVariantUnique(error)
      if (known(error, 'P2003')) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'Active Category does not exist')
      throw error
    }
  }

  async function updateProduct(accountId: string, productId: string, role: UserRole, input: ProductUpdateInput): Promise<ProductView> {
    if (role !== UserRole.OWNER && input.profitMarginOverride !== undefined) {
      throw new HttpError(403, 'SENSITIVE_FIELD_FORBIDDEN', 'profitMarginOverride is OWNER-only')
    }
    const current = await prisma.product.findUnique({ where: { id_accountId: { id: productId, accountId } }, select: { categoryId: true } })
    if (!current) throw productNotFound()
    if (input.categoryId || input.isActive === true) {
      await requireActiveCategory(accountId, input.categoryId ?? current.categoryId)
    }
    try {
      const product = await prisma.product.update({
        where: { id_accountId: { id: productId, accountId } },
        data: input,
        select: productSelect,
      })
      return productView(product, role)
    } catch (error) {
      if (known(error, 'P2025')) throw productNotFound()
      if (known(error, 'P2003')) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'Active Category does not exist')
      throw error
    }
  }

  async function createVariant(accountId: string, productId: string, role: UserRole, input: VariantCreateInput, performedById?: string): Promise<VariantView> {
    if (role !== UserRole.OWNER && Object.hasOwn(input, 'sellingPrice')) {
      throw new HttpError(403, 'SENSITIVE_FIELD_FORBIDDEN', 'sellingPrice is OWNER-only')
    }
    if (input.openingStock && (role !== UserRole.OWNER || !performedById)) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Opening stock requires an owner')
    const product = await prisma.product.findUnique({
      where: { id_accountId: { id: productId, accountId } },
      select: { id: true, isActive: true },
    })
    if (!product) throw productNotFound()
    if (!product.isActive) throw new HttpError(409, 'PRODUCT_INACTIVE', 'Variants require an active Product')
    try {
      const create = async (db: Prisma.TransactionClient | PrismaClient) => db.productVariant.create({
        data: {
          accountId,
          productId,
          sku: input.sku,
          currentStock: input.openingStock ? 1 : 0,
          lastPurchaseCost: null,
          ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.size !== undefined ? { size: input.size } : {}),
          ...(role === UserRole.OWNER && input.sellingPrice !== undefined
            ? { sellingPrice: input.sellingPrice }
            : {}),
        },
        select: variantSelect,
      })
      const variant = await prisma.$transaction(async (tx) => {
        const locked = await lockProduct(tx, accountId, productId)
        if (!locked.isActive) throw new HttpError(409, 'PRODUCT_INACTIVE', 'Product is inactive')
        assertUniqueCombination(input, locked.variants)
        const created = await create(tx)
        if (input.openingStock) await tx.inventoryMovement.create({ data: { accountId, variantId: created.id, performedById: performedById!, type: 'ADJUSTMENT', quantityChange: 1, unitCost: null, note: 'Opening stock: one piece; purchase cost pending.' } })
        return created
      })
      return variantView(variant, role)
    } catch (error) {
      if (known(error, 'P2002')) throw mapVariantUnique(error)
      if (known(error, 'P2003')) throw productNotFound()
      throw error
    }
  }

  async function updateVariant(accountId: string, productId: string, variantId: string, role: UserRole, input: VariantUpdateInput): Promise<VariantView> {
    if (role !== UserRole.OWNER && Object.hasOwn(input, 'sellingPrice')) {
      throw new HttpError(403, 'SENSITIVE_FIELD_FORBIDDEN', 'sellingPrice is OWNER-only')
    }
    try {
      const variant = await prisma.$transaction(async tx => {
      const product = await lockProduct(tx, accountId, productId)
      const existing = product.variants.find(v => v.id === variantId)
      if (!existing) throw variantNotFound()
      if (input.color !== undefined || input.size !== undefined) assertUniqueCombination({ color: input.color === undefined ? existing.color : input.color, size: input.size === undefined ? existing.size : input.size }, product.variants, variantId)
      return tx.productVariant.update({
        where: { id_productId_accountId: { id: variantId, productId, accountId } },
        data: {
          ...(input.sku !== undefined ? { sku: input.sku } : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.size !== undefined ? { size: input.size } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(role === UserRole.OWNER && input.sellingPrice !== undefined
            ? { sellingPrice: input.sellingPrice }
            : {}),
        },
        select: variantSelect,
      })
      })
      return variantView(variant, role)
    } catch (error) {
      if (error instanceof HttpError && error.code === 'PRODUCT_NOT_FOUND') throw variantNotFound()
      if (known(error, 'P2025')) throw variantNotFound()
      if (known(error, 'P2002')) throw mapVariantUnique(error)
      throw error
    }
  }

  async function quickAddStock(accountId: string, productId: string, variantId: string, role: UserRole, performedById: string, operationId: string, delta: 1 | -1 = 1): Promise<VariantView> {
    if (role !== UserRole.OWNER) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Only an owner can add stock')
    if (delta !== 1 && delta !== -1) throw new HttpError(422, 'INVALID_QUICK_STOCK', 'Stock change must be 1 or -1')
    try {
      return await prisma.$transaction(async (tx) => {
        // Lock Product before Variant, and fetch replay metadata in the same trip.
        const rows = await tx.$queryRaw<(VariantRecord & { productActive: boolean; replayVariantId: string | null; replayActorId: string | null; replayQuantity: number | null; replayType: string | null; replayNote: string | null })[]>(Prisma.sql`
          WITH locked_product AS MATERIALIZED (
            SELECT "id", "isActive" FROM "Product" WHERE "id" = ${productId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE
          ), locked_variant AS MATERIALIZED (
            SELECT v.* FROM "ProductVariant" v JOIN locked_product p ON p."id" = v."productId"
            WHERE v."id" = ${variantId}::uuid AND v."accountId" = ${accountId}::uuid FOR UPDATE OF v
          )
          SELECT p."isActive" AS "productActive", v."id", v."sku", v."barcode", v."color", v."size", v."sellingPrice", v."currentStock", v."lastPurchaseCost", v."isActive",
            m."variantId" AS "replayVariantId", m."performedById" AS "replayActorId", m."quantityChange" AS "replayQuantity", m."type"::text AS "replayType", m."note" AS "replayNote"
          FROM locked_product p LEFT JOIN locked_variant v ON true
          LEFT JOIN "InventoryMovement" m ON m."id" = ${operationId}::uuid AND m."accountId" = ${accountId}::uuid
        `)
        const current = rows[0]
        if (!current) throw productNotFound()
        if (!current.id) throw variantNotFound()
        if (current.replayVariantId) {
          if (current.replayVariantId !== variantId || current.replayActorId !== performedById || current.replayQuantity !== delta || !['RESTOCK', 'ADJUSTMENT'].includes(current.replayType ?? '') || !(delta === 1 ? ['Quick add: one piece.', 'Quick add: one piece; purchase cost pending.'] : ['Quick remove: one piece.', 'Quick remove: one piece; purchase cost pending.']).includes(current.replayNote ?? '')) throw new HttpError(409, 'QUICK_STOCK_CONFLICT', 'This stock operation belongs to another request')
          return variantView(current, role)
        }
        if (!current.productActive || !current.isActive) throw new HttpError(409, 'PRODUCT_INACTIVE', 'Only active items can receive stock')
        if (delta === -1 && current.currentStock < 1) throw new HttpError(409, 'INSUFFICIENT_STOCK', 'Stock is already zero')
        if (delta === 1 && current.currentStock >= 2147483647) throw new HttpError(409, 'STOCK_LIMIT_REACHED', 'Stock limit reached')
        const cost = current.lastPurchaseCost
        if (cost !== null && !cost.gt(0)) throw new HttpError(409, 'INVALID_QUICK_STOCK_COST', 'Set a positive purchase cost before adding stock')
        const note = `Quick ${delta === 1 ? 'add' : 'remove'}: one piece${cost ? '.' : '; purchase cost pending.'}`
        const isRestock = delta === 1 && cost !== null
        const fingerprint = isRestock ? restockFingerprint(accountId, performedById, variantId, { quantity: 1, unitCost: cost.toFixed(4), note }) : null
        // The ledger insert and stock increment share one statement. Any failure
        // rolls back both; the surrounding transaction retains the row locks.
        const updated = await tx.$queryRaw<VariantRecord[]>(Prisma.sql`
          WITH updated AS (
            UPDATE "ProductVariant" SET "currentStock" = "currentStock" + ${delta}, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${variantId}::uuid AND "productId" = ${productId}::uuid AND "accountId" = ${accountId}::uuid
            RETURNING "id", "sku", "barcode", "color", "size", "sellingPrice", "currentStock", "lastPurchaseCost", "isActive"
          ), movement AS (
            INSERT INTO "InventoryMovement" ("id", "accountId", "variantId", "performedById", "type", "quantityChange", "unitCost", "note", "idempotencyKey", "requestFingerprint")
            SELECT ${operationId}::uuid, ${accountId}::uuid, u."id", ${performedById}::uuid, ${isRestock ? 'RESTOCK' : 'ADJUSTMENT'}::"InventoryMovementType", ${delta},
              ${cost?.toFixed(4) ?? null}::numeric, ${note}, ${isRestock ? operationId : null}::uuid, ${fingerprint}
            FROM updated u RETURNING "id"
          ) SELECT u.* FROM updated u CROSS JOIN movement m
        `)
        if (!updated[0]) throw variantNotFound()
        return variantView(updated[0], role)
      })
    } catch (error) {
      if (known(error, 'P2002')) throw new HttpError(409, 'QUICK_STOCK_CONFLICT', 'Stock operation ID already exists')
      throw error
    }
  }

  async function setOpeningCost(accountId: string, productId: string, variantId: string, role: UserRole, unitCost: string): Promise<VariantView> {
    if (role !== UserRole.OWNER) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Only an owner can set cost')
    if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(unitCost) || !new Prisma.Decimal(unitCost).gt(0)) throw new HttpError(422, 'INVALID_OPENING_COST', 'Enter a positive purchase cost')
    return prisma.$transaction(async (tx) => {
      const products = await tx.$queryRaw<{ isActive: boolean }[]>(Prisma.sql`SELECT "isActive" FROM "Product" WHERE "id" = ${productId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`)
      if (!products[0]) throw productNotFound()
      const variants = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "ProductVariant" WHERE "id" = ${variantId}::uuid AND "productId" = ${productId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`)
      if (!variants[0]) throw variantNotFound()
      const current = await tx.productVariant.findUnique({ where: { id_productId_accountId: { id: variantId, productId, accountId } }, select: variantSelect })
      if (!current) throw variantNotFound()
      if (current.lastPurchaseCost !== null) {
        if (current.lastPurchaseCost.eq(unitCost)) return variantView(current, role)
        throw new HttpError(409, 'OPENING_COST_ALREADY_SET', 'Cost is already set; refresh inventory')
      }
      if (!products[0].isActive || !current.isActive || current.currentStock < 0) throw new HttpError(409, 'OPENING_COST_UNAVAILABLE', 'Cost requires active pending inventory')
      const invalidMovements = await tx.inventoryMovement.count({ where: { accountId, variantId, NOT: { unitCost: null, OR: [{ type: 'ADJUSTMENT', quantityChange: 1, note: { in: ['Opening stock: one piece; purchase cost pending.', 'Quick add: one piece; purchase cost pending.'] } }, { type: 'ADJUSTMENT', quantityChange: -1, note: 'Quick remove: one piece; purchase cost pending.' }, { type: { in: ['SALE', 'RETURN', 'SALE_VOID'] } }] } } })
      const ledger = await tx.inventoryMovement.aggregate({ where: { accountId, variantId }, _sum: { quantityChange: true } })
      if (invalidMovements !== 0 || ledger._sum.quantityChange !== current.currentStock) throw new HttpError(409, 'OPENING_COST_UNAVAILABLE', 'This inventory has no pending purchase cost')
      const updated = await tx.productVariant.update({ where: { id_productId_accountId: { id: variantId, productId, accountId } }, data: { lastPurchaseCost: new Prisma.Decimal(unitCost) }, select: variantSelect })
      return variantView(updated, role)
    })
  }

  async function uploadImage(accountId: string, productId: string, role: UserRole, buffer: Buffer): Promise<ProductView> {
    const product = await getProductRecord(accountId, productId)
    const key = productImageKey(accountId, productId)
    if (product.imageKey) requireProductImageKey(accountId, productId, product.imageKey)
    const store = imageStore()
    await uploadProductImage(store, accountId, productId, buffer)

    if (!product.imageKey) {
      try {
        const result = await prisma.product.updateMany({
          where: { id: productId, accountId, imageKey: null },
          data: { imageKey: key },
        })
        if (result.count !== 1) {
          const current = await getProductRecord(accountId, productId)
          if (current.imageKey !== key) throw new HttpError(409, 'PRODUCT_IMAGE_CONFLICT', 'Product image changed concurrently')
        }
      } catch (error) {
        // Never delete a canonical object if another request may already have
        // attached that same key. Only clear a confirmed unreferenced upload.
        try {
          const current = await prisma.product.findUnique({
            where: { id_accountId: { id: productId, accountId } },
            select: { imageKey: true },
          })
          if (current?.imageKey !== key) await store.delete(accountId, productId, key)
        } catch {
          // Best effort only; preserve the original database failure.
        }
        throw error
      }
    }
    return getProduct(accountId, productId, role)
  }

  async function deleteImage(accountId: string, productId: string): Promise<void> {
    const product = await getProductRecord(accountId, productId)
    if (!product.imageKey) return
    const key = requireProductImageKey(accountId, productId, product.imageKey)
    const result = await prisma.product.updateMany({
      where: { id: productId, accountId, imageKey: key },
      data: { imageKey: null },
    })
    if (result.count !== 1) throw new HttpError(409, 'PRODUCT_IMAGE_CONFLICT', 'Product image changed concurrently')
    await imageStore().delete(accountId, productId, key)
  }

  return {
    ...createRestockDependencies(prisma),
    applyVariantPrice,
    quickAddStock,
    setOpeningCost,
    listProductSummaries,
    listProducts,
    getProduct,
    createProductSetup,
    createProduct,
    updateProduct,
    createVariant,
    updateVariant,
    async assertProductOwned(accountId, productId) {
      await getProductRecord(accountId, productId)
    },
    uploadImage,
    deleteImage,
  }
}
