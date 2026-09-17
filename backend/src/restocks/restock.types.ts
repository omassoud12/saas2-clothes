export interface RestockInput {
  readonly quantity: number
  readonly unitCost: string
  readonly note: string | null
}

export interface RestockView {
  readonly restock: {
    readonly id: string
    readonly variantId: string
    readonly quantity: number
    readonly unitCost: string
    readonly note: string | null
    readonly createdAt: Date
  }
  readonly variant: {
    readonly id: string
    readonly currentStock: number
    readonly lastPurchaseCost: string | null
  }
  readonly idempotentReplay: boolean
}

export interface RestockDependencies {
  restock(
    accountId: string,
    performedById: string,
    productId: string,
    variantId: string,
    idempotencyKey: string,
    input: RestockInput,
  ): Promise<RestockView>
}
