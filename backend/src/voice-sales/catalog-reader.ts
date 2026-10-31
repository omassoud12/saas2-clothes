import type { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { requireVoiceSaleTenant } from './authenticated-tenant.js'
import type { CatalogReader, CatalogVariant } from './match.types.js'

export const CATALOG_PAGE_SIZE = 200
export const MAX_CATALOG_VARIANTS = 1000
export const catalogVariantSelect = {
  id: true, accountId: true, sku: true, barcode: true, color: true, size: true, currentStock: true,
  sellingPrice: true, isActive: true, createdAt: true,
  product: { select: {
    id: true, accountId: true, name: true, imageKey: true, isActive: true,
    category: { select: { id: true, accountId: true, name: true } },
    account: { select: { id: true, baseCurrency: true } },
  } },
} as const satisfies Prisma.ProductVariantSelect

/** Dependency is deliberately restricted to findMany: no business write capability. */
export function createCatalogReader(prisma: { productVariant: Pick<PrismaClient['productVariant'], 'findMany'> }): CatalogReader {
  return {
    async read(context) {
      const { accountId, role } = requireVoiceSaleTenant(context)
      const variants: CatalogVariant[] = []
      const productImageKeys = new Map<string, string>()
      let scannedVariants = 0
      let cursor: { createdAt: Date; id: string } | undefined
      let truncated = false
      while (scannedVariants <= MAX_CATALOG_VARIANTS) {
        const take = Math.min(CATALOG_PAGE_SIZE, MAX_CATALOG_VARIANTS + 1 - scannedVariants)
        const rows = await prisma.productVariant.findMany({
          where: {
            accountId, isActive: true,
            product: { accountId, isActive: true, category: { accountId }, account: { id: accountId } },
            ...(role === UserRole.WAREHOUSE ? { sellingPrice: { gt: '0' } } : {}),
            ...(cursor ? { OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ] } : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: catalogVariantSelect,
        })
        for (const row of rows) {
          scannedVariants++
          if (row.accountId !== accountId || row.product.accountId !== accountId
            || row.product.category.accountId !== accountId || row.product.account.id !== accountId) {
            throw new HttpError(503, 'CATALOG_UNAVAILABLE', 'Catalog is unavailable')
          }
          if (scannedVariants > MAX_CATALOG_VARIANTS) { truncated = true; break }
          if (!row.isActive || !row.product.isActive || row.currentStock < 0) continue
          const priced = row.sellingPrice !== null && row.sellingPrice.isFinite() && row.sellingPrice.gt(0)
          if (row.sellingPrice !== null && !row.sellingPrice.isFinite()) continue
          if (!priced && role === UserRole.WAREHOUSE) continue
          variants.push(Object.freeze({
            productId: row.product.id, variantId: row.id, categoryId: row.product.category.id,
            productName: row.product.name, categoryName: row.product.category.name,
            sku: row.sku, barcode: row.barcode, color: row.color, size: row.size,
            sellingPrice: row.sellingPrice?.toFixed(2) ?? null,
            availableStock: row.currentStock, currency: row.product.account.baseCurrency,
          }))
          if (row.product.imageKey) productImageKeys.set(row.product.id, row.product.imageKey)
        }
        if (truncated || rows.length < take) break
        const last = rows.at(-1)!
        cursor = { id: last.id, createdAt: last.createdAt }
      }
      return Object.freeze({ variants: Object.freeze(variants), scannedVariants: Math.min(scannedVariants, MAX_CATALOG_VARIANTS), truncated,
        productImageKeys })
    },
  }
}
