import cors from 'cors'
import express, { type Express, type RequestHandler } from 'express'
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
import type { ExchangeDependencies } from './exchanges/exchange.types.js'
import { createExchangeHistoryRouter } from './exchanges/exchange.history.routes.js'
import type { ExchangeHistoryDependencies } from './exchanges/exchange.history.service.js'
import { createExpenseRouter } from './expenses/expense.routes.js'
import type { ExpenseDependencies } from './expenses/expense.types.js'
import { createReportRouter } from './reports/report.routes.js'
import type { ReportDependencies } from './reports/report.types.js'
import type { HttpRuntimeConfiguration } from './config/env.js'
import { HttpError } from './errors/http-error.js'

export const JSON_BODY_LIMIT = '100kb'

const DEFAULT_HTTP_CONFIGURATION: HttpRuntimeConfiguration = Object.freeze({
  corsAllowedOrigins: Object.freeze([]),
  trustProxyHops: 0,
})

export function configureHttpSecurity(
  app: Express,
  configuration: HttpRuntimeConfiguration,
): void {
  const allowedOrigins = new Set(configuration.corsAllowedOrigins)

  app.disable('x-powered-by')
  app.set('trust proxy', configuration.trustProxyHops)
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true)
          return
        }

        callback(
          new HttpError(403, 'CORS_ORIGIN_FORBIDDEN', 'Origin is not allowed'),
        )
      },
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      optionsSuccessStatus: 204,
    }),
  )
}

export const jsonNotFoundHandler: RequestHandler = (
  _request,
  _response,
  next,
) => {
  next(new HttpError(404, 'API_ROUTE_NOT_FOUND', 'API route not found'))
}

export interface AppDependencies {
  readonly auth: AuthDependencies
  readonly adminAccounts: AdminAccountDependencies
  readonly categories: CategoryDependencies
  readonly products: ProductDependencies
  readonly inventory: InventoryAuditDependencies
  readonly sales: SaleDependencies
  readonly returns: ReturnDependencies
  readonly exchanges?: ExchangeDependencies
  readonly exchangeHistory?: ExchangeHistoryDependencies
  readonly expenses?: ExpenseDependencies
  readonly reports?: ReportDependencies
}

export function createApp(
  dependencies: AppDependencies,
  httpConfiguration: HttpRuntimeConfiguration = DEFAULT_HTTP_CONFIGURATION,
) {
  const app = express()

  configureHttpSecurity(app, httpConfiguration)
  app.use(express.json({ limit: JSON_BODY_LIMIT }))

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.use('/api/auth', createAuthRouter(dependencies.auth))
  app.use(
    '/api/categories',
    createCategoryRouter(dependencies.auth, dependencies.categories),
  )
  app.use('/api/products', createProductRouter(dependencies.auth, dependencies.products))
  app.use('/api/inventory', createInventoryRouter(dependencies.auth, dependencies.inventory))
  app.use('/api/sales', createSaleRouter(
    dependencies.auth,
    dependencies.sales,
    dependencies.returns,
    dependencies.exchanges,
  ))
  if (dependencies.exchangeHistory) {
    app.use('/api/exchanges', createExchangeHistoryRouter(dependencies.auth, dependencies.exchangeHistory))
  }
  if (dependencies.expenses) {
    app.use('/api/expenses', createExpenseRouter(dependencies.auth, dependencies.expenses))
  }
  if (dependencies.reports) {
    app.use('/api/reports', createReportRouter(dependencies.auth, dependencies.reports))
  }
  app.use(
    '/api/admin/accounts',
    createAdminAccountRouter(dependencies.auth, dependencies.adminAccounts),
  )
  app.use(jsonNotFoundHandler)
  app.use(errorHandler)

  return app
}
