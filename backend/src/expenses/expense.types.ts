export interface ExpenseInput {
  readonly amount: string
  readonly description: string
  readonly expenseDate: Date
}

export interface ExpenseHistoryQuery {
  readonly from?: Date
  readonly to?: Date
  readonly cursor?: {
    readonly expenseDate: Date
    readonly id: string
  }
  readonly limit: number
}

export interface ExpenseView {
  readonly id: string
  readonly amount: string
  readonly currency: string
  readonly description: string
  readonly expenseDate: string
  readonly createdById: string
  readonly createdAt: Date
}

export interface ExpenseDependencies {
  createExpense(
    accountId: string,
    createdById: string,
    input: ExpenseInput,
  ): Promise<{ expense: ExpenseView }>
  listExpenses(
    accountId: string,
    query: ExpenseHistoryQuery,
  ): Promise<{ expenses: readonly ExpenseView[]; nextCursor: string | null }>
}
