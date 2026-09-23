import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { productImageKey, requireProductImageKey } from '../product-images/product-image-key.js'
import { uploadProductImage } from '../product-images/product-image.service.js'
import type { ProductImageStore } from '../product-images/r2-product-image-store.js'
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
  variants: { select: variantSelect, orderBy: { createdAt: 'asc' as const } },
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

  async function productView(product: ProductRecord, role: UserRole): Promise<ProductView> {
    const imageUrl = product.imageKey
      ? await imageStore().signedReadUrl(product.accountId, product.id, product.imageKey)
      : null
    return {
      id: product.id,
      name: product.name,
      category: { id: product.category.id, name: product.category.name },
      isActive: product.isActive,
      imageUrl,
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

  async function listProducts(accountId: string, role: UserRole, input: ProductListInput) {
    const where: Prisma.ProductWhereInput = {
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

  async function updateProduct(accountId: string, productId: string, role: UserRole, input: ProductUpdateInput): Promise<ProductView> {
    if (role !== UserRole.OWNER && input.profitMarginOverride !== undefined) {
      throw new HttpError(403, 'SENSITIVE_FIELD_FORBIDDEN', 'profitMarginOverride is OWNER-only')
    }
    const current = await getProductRecord(accountId, productId)
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

  async function createVariant(accountId: string, productId: string, role: UserRole, input: VariantCreateInput): Promise<VariantView> {
    if (role !== UserRole.OWNER && Object.hasOwn(input, 'sellingPrice')) {
      throw new HttpError(403, 'SENSITIVE_FIELD_FORBIDDEN', 'sellingPrice is OWNER-only')
    }
    const product = await prisma.product.findUnique({
      where: { id_accountId: { id: productId, accountId } },
      select: { id: true, isActive: true },
    })
    if (!product) throw productNotFound()
    if (!product.isActive) throw new HttpError(409, 'PRODUCT_INACTIVE', 'Variants require an active Product')
    try {
      const variant = await prisma.productVariant.create({
        data: {
          accountId,
          productId,
          sku: input.sku,
          currentStock: 0,
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
      const variant = await prisma.productVariant.update({
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
      return variantView(variant, role)
    } catch (error) {
      if (known(error, 'P2025')) throw variantNotFound()
      if (known(error, 'P2002')) throw mapVariantUnique(error)
      throw error
    }
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
    listProducts,
    getProduct,
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
