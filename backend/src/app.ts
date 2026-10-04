import { createReceiptRouter } from './receipts/receipt.routes.js'
import type { ReceiptDependencies } from './receipts/receipt.service.js'
import cors from 'cors'
import express, { type Express, type RequestHandler } from 'express'
import { createAdminAccountRouter } from './admin/admin-account.routes.js'
import type { AdminAccountDependencies } from './admin/admin-account.types.js'
import { createAuthRouter } from './auth/auth.routes.js'
import type { AuthDependencies } from './auth/auth.types.js'
import { createCategoryRouter } from './categories/category.routes.js'
import type { CategoryDependencies } from './categories/category.types.js'
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
import type {
  HttpRuntimeConfiguration,
  RateLimitConfiguration,
} from './config/env.js'
import { HttpError } from './errors/http-error.js'
import { createErrorHandler } from './middleware/error-handler.js'
import { createRateLimit } from './middleware/rate-limit.js'
import { createRequestContext } from './middleware/request-context.js'
import {
  createReadinessHandler,
  ReadinessState,
  type ReadinessDependencies,
} from './runtime/readiness.js'
import type { RuntimeLogger } from './runtime/logger.js'

export const JSON_BODY_LIMIT = '100kb'

export interface AppRuntimeConfiguration
  extends HttpRuntimeConfiguration,
    RateLimitConfiguration {}

const DEFAULT_HTTP_CONFIGURATION: AppRuntimeConfiguration = Object.freeze({
  corsAllowedOrigins: Object.freeze([]),
  trustProxyHops: 0,
  generalRateLimitMax: 300,
  writeRateLimitMax: 120,
  expensiveRateLimitMax: 30,
  imageRateLimitMax: 10,
})

const silentLogger: RuntimeLogger = Object.freeze({
  info() {},
  warn() {},
  error() {},
})

const defaultReadinessState = new ReadinessState()
defaultReadinessState.markStarted()

const DEFAULT_RUNTIME_DEPENDENCIES: AppRuntimeDependencies = Object.freeze({
  logger: silentLogger,
  readiness: {
    state: defaultReadinessState,
    async probeDatabase() {},
  },
})

const FIVE_MINUTES_MS = 5 * 60 * 1_000
const TEN_MINUTES_MS = 10 * 60 * 1_000

export interface AppRuntimeDependencies {
  readonly logger: RuntimeLogger
  readonly readiness: ReadinessDependencies
  readonly requestIdFactory?: () => string
  readonly now?: () => number
}

function requestPath(request: express.Request): string {
  return request.originalUrl.split('?', 1)[0]
}

export function isWriteRequest(request: express.Request): boolean {
  return (
    request.method === 'POST' ||
    request.method === 'PATCH' ||
    request.method === 'DELETE'
  )
}

export function isExpensiveRead(request: express.Request): boolean {
  if (request.method !== 'GET') return false
  const path = requestPath(request)
  return (
    path.startsWith('/api/reports/') ||
    path.startsWith('/api/inventory/') ||
    path === '/api/sales' ||
    path.includes('/returns') ||
    path.startsWith('/api/exchanges') ||
    path.startsWith('/api/expenses')
  )
}

export function isImageUpload(request: express.Request): boolean {
  return (
    request.method === 'POST' &&
    /^\/api\/products\/[^/]+\/image$/u.test(requestPath(request))
  )
}

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
  readonly receipts?: ReceiptDependencies
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
  httpConfiguration: AppRuntimeConfiguration = DEFAULT_HTTP_CONFIGURATION,
  runtime: AppRuntimeDependencies = DEFAULT_RUNTIME_DEPENDENCIES,
) {
  const app = express()

  app.use(
    createRequestContext(runtime.logger, {
      idFactory: runtime.requestIdFactory,
      now: runtime.now,
    }),
  )
  configureHttpSecurity(app, httpConfiguration)

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })
  app.get('/api/ready', createReadinessHandler(runtime.readiness))

  app.use(
    '/api',
    createRateLimit(
      {
        limit: httpConfiguration.generalRateLimitMax,
        windowMs: FIVE_MINUTES_MS,
      },
      { now: runtime.now },
    ),
    createRateLimit(
      {
        limit: httpConfiguration.writeRateLimitMax,
        windowMs: FIVE_MINUTES_MS,
      },
      { now: runtime.now, shouldLimit: isWriteRequest },
    ),
    createRateLimit(
      {
        limit: httpConfiguration.expensiveRateLimitMax,
        windowMs: FIVE_MINUTES_MS,
      },
      { now: runtime.now, shouldLimit: isExpensiveRead },
    ),
    createRateLimit(
      {
        limit: httpConfiguration.imageRateLimitMax,
        windowMs: TEN_MINUTES_MS,
      },
      { now: runtime.now, shouldLimit: isImageUpload },
    ),
  )
  app.use(express.json({ limit: JSON_BODY_LIMIT }))

  app.use('/api/auth', createAuthRouter(dependencies.auth))
  app.use(
    '/api/categories',
    createCategoryRouter(dependencies.auth, dependencies.categories),
  )
  app.use('/api/products', createProductRouter(dependencies.auth, dependencies.products))
  if (dependencies.receipts) app.use('/api/inventory', createReceiptRouter(dependencies.auth, dependencies.receipts))
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
  app.use(createErrorHandler(runtime.logger))

  return app
}
