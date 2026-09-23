import cors from 'cors'
import express from 'express'
import { createAdminAccountRouter } from './admin/admin-account.routes.js'
import type { AdminAccountDependencies } from './admin/admin-account.types.js'
import { createAuthRouter } from './auth/auth.routes.js'
import type { AuthDependencies } from './auth/auth.types.js'
import { createCategoryRouter } from './categories/category.routes.js'
import type { CategoryDependencies } from './categories/category.types.js'
import { errorHandler } from './middleware/error-handler.js'
import { createInventoryRouter } from './inventory/inventory.routes.js'
import type { InventoryAuditDependencies } from './inventory/inventory.types.js'
import { createProductRouter } from './products/product.routes.js'
import type { ProductDependencies } from './products/product.types.js'
import { createSaleRouter } from './sales/sale.routes.js'
import type { SaleDependencies } from './sales/sale.types.js'
import type { ReturnDependencies } from './returns/return.types.js'

export interface AppDependencies {
  readonly auth: AuthDependencies
  readonly adminAccounts: AdminAccountDependencies
  readonly categories: CategoryDependencies
  readonly products: ProductDependencies
  readonly inventory: InventoryAuditDependencies
  readonly sales: SaleDependencies
  readonly returns: ReturnDependencies
}

export function createApp(dependencies: AppDependencies) {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', supabaseConfigured: true })
  })

  app.use('/api/auth', createAuthRouter(dependencies.auth))
  app.use(
    '/api/categories',
    createCategoryRouter(dependencies.auth, dependencies.categories),
  )
  app.use('/api/products', createProductRouter(dependencies.auth, dependencies.products))
  app.use('/api/inventory', createInventoryRouter(dependencies.auth, dependencies.inventory))
  app.use('/api/sales', createSaleRouter(dependencies.auth, dependencies.sales, dependencies.returns))
  app.use(
    '/api/admin/accounts',
    createAdminAccountRouter(dependencies.auth, dependencies.adminAccounts),
  )
  app.use(errorHandler)

  return app
}
