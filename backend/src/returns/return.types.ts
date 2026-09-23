import type { Prisma } from '../generated/prisma/client.js'

export interface ReturnLineInput {
  readonly saleItemId: string
  readonly quantity: number
}

export interface ReturnInput {
  readonly reason: string | null
  readonly items: readonly ReturnLineInput[]
}

export interface ReturnView {
  readonly return: {
    readonly id: string
    readonly saleId: string
    readonly createdAt: Date
    readonly reason: string | null
    readonly processor: {
      readonly name: string
      readonly employeeCode: string | null
    }
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
    readonly totalRefund: string
  }
  readonly idempotentReplay: boolean
}

export interface ReturnTransactionInput {
  readonly accountId: string
  readonly processedById: string
  readonly saleId: string
  readonly idempotencyKey: string
  readonly requestFingerprint: string
  readonly input: ReturnInput
}

export interface ReturnDependencies {
  createReturn(
    accountId: string,
    processedById: string,
    saleId: string,
    idempotencyKey: string,
    input: ReturnInput,
  ): Promise<ReturnView>
}

export type ReturnTransaction = Prisma.TransactionClient
