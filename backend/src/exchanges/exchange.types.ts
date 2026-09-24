import type { SaleInput } from '../sales/sale.types.js'
import type { ReturnLineInput } from '../returns/return.types.js'

export interface ExchangeInput {
  readonly reason: string | null
  readonly returnItems: readonly ReturnLineInput[]
  readonly replacementItems: SaleInput['items']
}

export interface ExchangeView {
  readonly exchange: {
    readonly id: string
    readonly createdAt: Date
    readonly originalSaleId: string
    readonly currency: string
    readonly return: {
      readonly id: string
      readonly createdAt: Date
      readonly reason: string | null
      readonly processor: { readonly name: string; readonly employeeCode: string | null }
      readonly totalRefund: string
      readonly items: readonly {
        readonly saleItemId: string
        readonly productId: string
        readonly variantId: string
        readonly productName: string
        readonly categoryName: string
        readonly sku: string
        readonly color: string | null
        readonly size: string | null
        readonly quantity: number
        readonly refundAmount: string
      }[]
    }
    readonly replacementSale: {
      readonly id: string
      readonly status: 'COMPLETED' | 'VOIDED'
      readonly createdAt: Date
      readonly seller: { readonly name: string; readonly employeeCode: string | null }
      readonly subtotal: string
      readonly totalAmount: string
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
    readonly differenceAmount: string
  }
  readonly idempotentReplay: boolean
}

export interface ExchangeDependencies {
  createExchange(
    accountId: string,
    actorId: string,
    originalSaleId: string,
    idempotencyKey: string,
    input: ExchangeInput,
  ): Promise<ExchangeView>
}

export interface ExchangeHistoryQuery {
  readonly from?: Date
  readonly to?: Date
  readonly cursor?: { readonly createdAt: Date; readonly id: string }
  readonly limit: number
}

export interface ExchangeHistoryItem {
  readonly id: string
  readonly createdAt: Date
  readonly originalSaleId: string
  readonly replacementSaleId: string
  readonly currency: string
  readonly totalRefund: string
  readonly replacementTotal: string
  readonly differenceAmount: string
  readonly processor: { readonly name: string; readonly employeeCode: string | null }
}
