import { normalizeText, tokenizeText } from './normalization.js'
import type { CatalogSnapshot, CatalogVariant } from './match.types.js'

export interface CatalogSearchCategory {
  readonly categoryId: string | null
  readonly categoryName: string
  readonly normalizedName: string
  readonly productIds: readonly string[]
  readonly variantIds: readonly string[]
}

export interface CatalogSearchProduct {
  readonly productId: string
  readonly productName: string
  readonly normalizedName: string
  readonly nameTokens: readonly string[]
  readonly categoryId: string | null
  readonly categoryName: string
  readonly variantIds: readonly string[]
}

export interface TenantCatalogSearchIndex {
  readonly categories: readonly CatalogSearchCategory[]
  readonly products: readonly CatalogSearchProduct[]
  readonly variantsById: ReadonlyMap<string, CatalogVariant>
  readonly coverageComplete: boolean
}

/**
 * Per-request, tenant-local search representation. It contains no mutable
 * database client and is never shared between authenticated requests.
 */
export function buildTenantCatalogSearchIndex(catalog: CatalogSnapshot): TenantCatalogSearchIndex {
  const categoryRows = new Map<string, { categoryId: string | null; categoryName: string;
    productIds: Set<string>; variantIds: Set<string> }>()
  const productRows = new Map<string, { row: CatalogVariant; variantIds: Set<string> }>()
  const variantsById = new Map<string, CatalogVariant>()

  for (const row of catalog.variants) {
    variantsById.set(row.variantId, row)
    const categoryKey = row.categoryId ?? `name:${normalizeText(row.categoryName)}`
    const category = categoryRows.get(categoryKey) ?? { categoryId: row.categoryId ?? null,
      categoryName: row.categoryName, productIds: new Set<string>(), variantIds: new Set<string>() }
    category.productIds.add(row.productId); category.variantIds.add(row.variantId)
    categoryRows.set(categoryKey, category)
    const product = productRows.get(row.productId) ?? { row, variantIds: new Set<string>() }
    product.variantIds.add(row.variantId); productRows.set(row.productId, product)
  }

  const categories = [...categoryRows.values()].map(row => Object.freeze({
    categoryId: row.categoryId, categoryName: row.categoryName, normalizedName: normalizeText(row.categoryName),
    productIds: Object.freeze([...row.productIds].sort()), variantIds: Object.freeze([...row.variantIds].sort()),
  })).sort((left, right) => left.categoryName.localeCompare(right.categoryName)
    || (left.categoryId ?? '').localeCompare(right.categoryId ?? ''))
  const products = [...productRows.values()].map(({ row, variantIds }) => Object.freeze({
    productId: row.productId, productName: row.productName, normalizedName: normalizeText(row.productName),
    nameTokens: tokenizeText(row.productName), categoryId: row.categoryId ?? null, categoryName: row.categoryName,
    variantIds: Object.freeze([...variantIds].sort()),
  })).sort((left, right) => left.productName.localeCompare(right.productName) || left.productId.localeCompare(right.productId))

  return Object.freeze({ categories: Object.freeze(categories), products: Object.freeze(products),
    variantsById, coverageComplete: !catalog.truncated })
}
