import cors from 'cors'
import express from 'express'
import { createAdminAccountRouter } from './admin/admin-account.routes.js'
import type { AdminAccountDependencies } from './admin/admin-account.types.js'
import { createAuthRouter } from './auth/auth.routes.js'
import type { AuthDependencies } from './auth/auth.types.js'
import { createCategoryRouter } from './categories/category.routes.js'
import type { CategoryDependencies } from './categories/category.types.js'
import { errorHandler } from './middleware/error-handler.js'
import { createProductRouter } from './products/product.routes.js'
import type { ProductDependencies } from './products/product.types.js'

export interface AppDependencies {
  readonly auth: AuthDependencies
  readonly adminAccounts: AdminAccountDependencies
  readonly categories: CategoryDependencies
  readonly products: ProductDependencies
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
  app.use(
    '/api/admin/accounts',
    createAdminAccountRouter(dependencies.auth, dependencies.adminAccounts),
  )
  app.use(errorHandler)

  return app
}
