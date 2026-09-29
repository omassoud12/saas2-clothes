import type { UserRole } from '../generated/prisma/enums.js'
import type { RestockDependencies } from '../restocks/restock.types.js'

export interface ProductCreateInput {
  readonly categoryId: string
  readonly name: string
  readonly profitMarginOverride?: string | null
}

export interface ProductUpdateInput {
  readonly categoryId?: string
  readonly name?: string
  readonly profitMarginOverride?: string | null
  readonly isActive?: boolean
}

export interface VariantCreateInput {
  readonly openingStock?: boolean
  readonly sku: string
  readonly barcode?: string | null
  readonly color?: string | null
  readonly size?: string | null
  readonly sellingPrice?: string | null
}

export interface VariantUpdateInput {
  readonly sku?: string
  readonly barcode?: string | null
  readonly color?: string | null
  readonly size?: string | null
  readonly sellingPrice?: string | null
  readonly isActive?: boolean
}

export interface ProductListInput {
  readonly isActive?: boolean
  readonly categoryId?: string
  readonly search?: string
  readonly page: number
  readonly limit: number
}

export interface VariantView {
  readonly id: string
  readonly sku: string
  readonly barcode: string | null
  readonly color: string | null
  readonly size: string | null
  readonly sellingPrice: string | null
  readonly currentStock: number
  readonly isActive: boolean
  readonly lastPurchaseCost?: string | null
}

export interface ProductView {
  readonly id: string
  readonly name: string
  readonly category: { readonly id: string; readonly name: string }
  readonly isActive: boolean
  readonly imageUrl: string | null
  readonly imageStatus?: 'none' | 'available' | 'unavailable'
  readonly variants: readonly VariantView[]
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly profitMarginOverride?: string | null
}

export interface ProductSummaryView {
 readonly id: string
 readonly name: string
 readonly category: { readonly id: string; readonly name: string }
 readonly isActive: boolean
 readonly imageUrl: string | null
  readonly imageStatus?: 'none' | 'available' | 'unavailable'
 readonly catalogSummary: { readonly activeVariantCount: number; readonly inactiveVariantCount: number; readonly availableStock: string; readonly inactiveStock: string; readonly priceMin: string | null; readonly priceMax: string | null }
}

export interface ProductDependencies extends RestockDependencies {
  listProductSummaries(accountId: string, input: ProductListInput): Promise<{ products: readonly ProductSummaryView[]; total: number; page: number; limit: number }>
  applyVariantPrice(accountId: string, productId: string, role: UserRole, variantIds: readonly string[], sellingPrice: string): Promise<ProductView>
  createProductSetup(accountId: string, createdById: string, role: UserRole, product: ProductCreateInput, variants: readonly VariantCreateInput[]): Promise<ProductView>
  listProducts(accountId: string, role: UserRole, input: ProductListInput): Promise<{ products: readonly ProductView[]; total: number; page: number; limit: number }>
  getProduct(accountId: string, productId: string, role: UserRole): Promise<ProductView>
  createProduct(accountId: string, createdById: string, role: UserRole, input: ProductCreateInput): Promise<ProductView>
  updateProduct(accountId: string, productId: string, role: UserRole, input: ProductUpdateInput): Promise<ProductView>
  createVariant(accountId: string, productId: string, role: UserRole, input: VariantCreateInput, performedById?: string): Promise<VariantView>
  updateVariant(accountId: string, productId: string, variantId: string, role: UserRole, input: VariantUpdateInput): Promise<VariantView>
  quickAddStock(accountId: string, productId: string, variantId: string, role: UserRole, performedById: string, operationId: string, delta?: 1 | -1): Promise<VariantView>
  setOpeningCost(accountId: string, productId: string, variantId: string, role: UserRole, unitCost: string): Promise<VariantView>
  assertProductOwned(accountId: string, productId: string): Promise<void>
  uploadImage(accountId: string, productId: string, role: UserRole, buffer: Buffer): Promise<ProductView>
  deleteImage(accountId: string, productId: string): Promise<void>
}
