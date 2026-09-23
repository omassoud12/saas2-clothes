import type { Prisma } from '../generated/prisma/client.js'

export interface SaleLineInput {
  readonly variantId: string
  readonly quantity: number
  readonly unitSoldPrice: string
}

export interface SaleInput {
  readonly items: readonly SaleLineInput[]
}

export interface SaleHistoryQuery {
  readonly status?: 'COMPLETED' | 'VOIDED'
  readonly soldById?: string
  readonly from?: Date
  readonly to?: Date
  readonly cursor?: { readonly createdAt: Date; readonly id: string }
  readonly limit: number
}

export interface SaleListItem {
  readonly id: string
  readonly status: 'COMPLETED' | 'VOIDED'
  readonly currency: string
  readonly subtotal: string
  readonly totalAmount: string
  readonly createdAt: Date
  readonly seller: { readonly name: string; readonly employeeCode: string | null }
  readonly itemCount: number
  readonly totalUnits: number
}

export interface SaleDetailView {
  readonly sale: {
    readonly id: string
    readonly status: 'COMPLETED' | 'VOIDED'
    readonly currency: string
    readonly subtotal: string
    readonly totalAmount: string
    readonly createdAt: Date
    readonly seller: { readonly name: string; readonly employeeCode: string | null }
    readonly void: null | {
      readonly voidedAt: Date
      readonly voidedByName: string
      readonly voidedByCode: string | null
      readonly voidReason: string
    }
    readonly returnSummary: {
      readonly hasReturns: boolean
      readonly returnCount: number
      readonly totalReturnedUnits: number
      readonly totalReturnedAmount: string
    }
    readonly items: readonly ({
      readonly id: string
      readonly productId: string
      readonly variantId: string
      readonly productName: string
      readonly categoryName: string
      readonly sku: string
      readonly color: string | null
      readonly size: string | null
      readonly quantity: number
      readonly unitSoldPrice: string
      readonly lineTotal: string
      readonly returnedQuantity: number
      readonly remainingReturnableQuantity: number
    } & {
      readonly unitCostAtSale?: string
      readonly lineCost?: string
      readonly lineGrossProfit?: string
    })[]
    readonly economics?: {
      readonly totalCOGS: string
      readonly grossProfit: string
    }
  }
}

export interface SaleView {
  readonly sale: {
    readonly id: string
    readonly status: 'COMPLETED' | 'VOIDED'
    readonly currency: string
    readonly subtotal: string
    readonly totalAmount: string
    readonly createdAt: Date
    readonly seller: {
      readonly name: string
      readonly employeeCode: string | null
    }
    readonly items: readonly {
      readonly id: string
      readonly productName: string
      readonly categoryName: string
      readonly sku: string
      readonly color: string | null
      readonly size: string | null
      readonly quantity: number
      readonly unitSoldPrice: string
      readonly lineTotal: string
    }[]
  }
  readonly idempotentReplay: boolean
}

export type SaleTransaction = Prisma.TransactionClient

export interface SaleTransactionContext {
  readonly accountId: string
  readonly soldById: string
}

export interface SaleOperationMetadata {
  readonly idempotencyKey: string
  readonly requestFingerprint: string
}

export interface SaleTransactionResult {
  readonly id: string
  readonly status: 'COMPLETED'
  readonly currency: string
  readonly subtotal: Prisma.Decimal
  readonly totalAmount: Prisma.Decimal
  readonly createdAt: Date
  readonly sellerNameAtSale: string
  readonly sellerCodeAtSale: string | null
  readonly items: readonly {
    readonly id: string
    readonly productId: string
    readonly variantId: string
    readonly productNameAtSale: string
    readonly categoryNameAtSale: string
    readonly skuAtSale: string
    readonly colorAtSale: string | null
    readonly sizeAtSale: string | null
    readonly quantity: number
    readonly unitSoldPrice: Prisma.Decimal
    readonly unitCostAtSale: Prisma.Decimal
    readonly lineTotal: Prisma.Decimal
  }[]
}

export interface SaleVoidInput {
  readonly reason: string
}

export interface SaleVoidView {
  readonly sale: {
    readonly id: string
    readonly status: 'VOIDED'
    readonly currency: string
    readonly subtotal: string
    readonly totalAmount: string
    readonly createdAt: Date
    readonly seller: {
      readonly name: string
      readonly employeeCode: string | null
    }
    readonly void: {
      readonly voidedAt: Date
      readonly voidedByName: string
      readonly voidedByCode: string | null
      readonly reason: string
    }
    readonly items: readonly {
      readonly id: string
      readonly productId: string
      readonly variantId: string
      readonly productName: string
      readonly categoryName: string
      readonly sku: string
      readonly color: string | null
      readonly size: string | null
      readonly quantity: number
      readonly unitSoldPrice: string
      readonly lineTotal: string
    }[]
  }
  readonly idempotentReplay: boolean
}

export interface SaleDependencies {
  createSale(
    accountId: string,
    soldById: string,
    idempotencyKey: string,
    input: SaleInput,
  ): Promise<SaleView>
  listSales(
    accountId: string,
    query: SaleHistoryQuery,
  ): Promise<{ sales: readonly SaleListItem[]; nextCursor: string | null }>
  getSale(
    accountId: string,
    role: import('../generated/prisma/enums.js').UserRole,
    saleId: string,
  ): Promise<SaleDetailView>
  voidSale(
    accountId: string,
    voidedById: string,
    saleId: string,
    input: SaleVoidInput,
  ): Promise<SaleVoidView>
}
