export interface CategoryInput {
  readonly name: string
}

export interface CategoryRecord {
  readonly id: string
  readonly name: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface CategoryDependencies {
  listCategories(accountId: string): Promise<readonly CategoryRecord[]>
  createCategory(
    accountId: string,
    input: CategoryInput,
  ): Promise<CategoryRecord>
  updateCategory(
    accountId: string,
    categoryId: string,
    input: CategoryInput,
  ): Promise<CategoryRecord>
  deleteCategory(accountId: string, categoryId: string): Promise<void>
}
