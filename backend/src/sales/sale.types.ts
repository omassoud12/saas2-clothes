import type { Prisma } from '../generated/prisma/client.js'

export interface SaleLineInput {
  readonly variantId: string
  readonly quantity: number
  readonly unitSoldPrice: string
}

export type PaymentMethodValue = 'CASH' | 'CARD' | 'WHISH_OMT' | 'DEBT'

export interface SaleCustomerInput {
  readonly name: string
  readonly phone: string | null
}

export interface SaleInput {
  readonly items: readonly SaleLineInput[]
  /** Defaults to CASH. */
  readonly paymentMethod?: PaymentMethodValue
  /** Required (name) for DEBT. */
  readonly customer?: SaleCustomerInput
  /** Percent the OWNER chose at the till, 0-100 with two decimals. The money discount is derived from catalog prices. */
  readonly discountPercent?: string
}

export interface SalePayInput {
  readonly confirm: true
}

export interface SaleCommercialFields {
  readonly receiptNumber: number | null
  readonly paymentMethod: PaymentMethodValue
  readonly customer: { readonly name: string; readonly phone: string | null } | null
  readonly discountAmount: string
  readonly discountPercent: string | null
  readonly lbpRateAtSale: string | null
  readonly paidAt: Date | null
}

export interface SaleHistoryQuery {
  readonly status?: 'COMPLETED' | 'VOIDED'
  readonly soldById?: string
  readonly from?: Date
  readonly to?: Date
  readonly cursor?: { readonly createdAt: Date; readonly id: string }
  /** Only Sales that have at least one Return. */
  readonly returned?: true
  readonly paymentMethod?: PaymentMethodValue
  /** Only COMPLETED DEBT Sales that are not paid yet. */
  readonly unpaid?: true
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
  readonly receiptNumber: number | null
  readonly paymentMethod: PaymentMethodValue
  readonly customerName: string | null
  readonly discountAmount: string
  readonly paidAt: Date | null
  readonly itemCount: number
  readonly totalUnits: number
  readonly hasReturns: boolean
  readonly totalReturnedAmount: string
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
    readonly commercial: SaleCommercialFields & { readonly paidBy: { readonly name: string; readonly employeeCode: string | null } | null }
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
    readonly exchangeSummary: {
      readonly originalExchangeCount: number
      readonly replacementForExchangeId: string | null
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
      readonly listUnitPrice: string | null
      readonly discountAmount: string
      readonly lineTotal: string
      readonly returnedQuantity: number
      readonly remainingReturnableQuantity: number
    } & {
      readonly unitCostAtSale?: string | null
      readonly lineCost?: string | null
      readonly lineGrossProfit?: string | null
    })[]
    readonly economics?: {
      readonly costStatus: 'COMPLETE' | 'INCOMPLETE'
      readonly totalCOGS: string | null
      readonly grossProfit: string | null
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
    readonly commercial: SaleCommercialFields
    readonly items: readonly {
      readonly id: string
      readonly productName: string
      readonly categoryName: string
      readonly sku: string
      readonly color: string | null
      readonly size: string | null
      readonly quantity: number
      readonly unitSoldPrice: string
      readonly listUnitPrice: string | null
      readonly discountAmount: string
      readonly lineTotal: string
    }[]
  }
  readonly idempotentReplay: boolean
}

export interface SalePayView {
  readonly sale: {
    readonly id: string
    readonly status: 'COMPLETED' | 'VOIDED'
    readonly currency: string
    readonly totalAmount: string
    readonly receiptNumber: number | null
    readonly paymentMethod: 'DEBT'
    readonly customer: { readonly name: string; readonly phone: string | null } | null
    readonly paidAt: Date
    readonly paidBy: { readonly name: string; readonly employeeCode: string | null }
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
  readonly receiptNumber: number | null
  readonly paymentMethod: PaymentMethodValue
  readonly customerName: string | null
  readonly customerPhone: string | null
  readonly discountAmount: Prisma.Decimal
  readonly discountPercent: Prisma.Decimal | null
  readonly lbpRateAtSale: Prisma.Decimal | null
  readonly paidAt: Date | null
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
    readonly listUnitPrice: Prisma.Decimal | null
    readonly discountAmount: Prisma.Decimal
    readonly unitSoldPrice: Prisma.Decimal
    readonly unitCostAtSale: Prisma.Decimal | null
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
  /** OWNER only: marks an unpaid DEBT Sale as paid. Repeating it returns the stored settlement. */
  markSalePaid(
    accountId: string,
    paidById: string,
    saleId: string,
    input: SalePayInput,
  ): Promise<SalePayView>
}
