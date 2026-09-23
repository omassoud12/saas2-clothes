export interface SaleLineInput {
  readonly variantId: string
  readonly quantity: number
  readonly unitSoldPrice: string
}

export interface SaleInput {
  readonly items: readonly SaleLineInput[]
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

export interface SaleDependencies {
  createSale(
    accountId: string,
    soldById: string,
    idempotencyKey: string,
    input: SaleInput,
  ): Promise<SaleView>
}
