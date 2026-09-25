import 'dotenv/config'
import { once } from 'node:events'
import { createAdminAccountDependencies } from './admin/admin-account.service.js'
import { createApp } from './app.js'
import { createAuthDependencies } from './auth/auth.service.js'
import { createCategoryDependencies } from './categories/category.service.js'
import { loadEnvironment } from './config/env.js'
import { createExchangeHistoryDependencies } from './exchanges/exchange.history.service.js'
import { createExchangeDependencies } from './exchanges/exchange.service.js'
import { createExpenseDependencies } from './expenses/expense.service.js'
import { createInventoryAuditDependencies } from './inventory/inventory.service.js'
import { createPrismaClient } from './lib/prisma.js'
import {
  createR2ProductImageStore,
  loadR2Environment,
} from './product-images/r2-product-image-store.js'
import { createProductDependencies } from './products/product.service.js'
import { createReportDependencies } from './reports/report.service.js'
import { createReturnDependencies } from './returns/return.service.js'
import { createJsonLogger } from './runtime/logger.js'
import {
  createPrismaReadinessProbe,
  ReadinessState,
} from './runtime/readiness.js'
import {
  configureHttpServer,
  createShutdownCoordinator,
  installProcessHandlers,
} from './runtime/server-lifecycle.js'
import { createSaleDependencies } from './sales/sale.service.js'
import { createSupabaseVerifier } from './supabase.js'

const logger = createJsonLogger()

async function start(): Promise<void> {
  let prisma: ReturnType<typeof createPrismaClient> | undefined
  let imageStore: ReturnType<typeof createR2ProductImageStore> | undefined
  const readiness = new ReadinessState()

  try {
    const environment = loadEnvironment()
    prisma = createPrismaClient(environment.databaseUrl, {
      caPath: environment.databaseCaPath,
      nodeEnvironment: environment.nodeEnvironment,
    })
    const supabaseVerifier = createSupabaseVerifier(environment)
    const auth = createAuthDependencies(prisma, supabaseVerifier, (failure) => {
      logger.warn('supabase_auth_verification_failed', {
        status: failure.status ?? 502,
        code: failure.code,
      })
    })
    const adminAccounts = createAdminAccountDependencies(prisma)
    const categories = createCategoryDependencies(prisma)
    const products = createProductDependencies(prisma, () => {
      imageStore ??= createR2ProductImageStore(loadR2Environment())
      return imageStore
    })
    const inventory = createInventoryAuditDependencies(prisma)
    const sales = createSaleDependencies(prisma)
    const returns = createReturnDependencies(prisma)
    const exchanges = createExchangeDependencies(prisma)
    const exchangeHistory = createExchangeHistoryDependencies(prisma)
    const expenses = createExpenseDependencies(prisma)
    const reports = createReportDependencies(prisma)
    const app = createApp(
      {
        auth,
        adminAccounts,
        categories,
        products,
        inventory,
        sales,
        returns,
        exchanges,
        exchangeHistory,
        expenses,
        reports,
      },
      environment,
      {
        logger,
        readiness: {
          state: readiness,
          probeDatabase: createPrismaReadinessProbe(prisma),
        },
      },
    )

    const server = app.listen(environment.port)
    configureHttpServer(server)
    await once(server, 'listening')

    const shutdown = createShutdownCoordinator({
      server,
      readiness,
      logger,
      disconnectPrisma: () => prisma?.$disconnect() ?? Promise.resolve(),
      closeResources: () => imageStore?.destroy?.(),
    })
    installProcessHandlers(shutdown)
    readiness.markStarted()
    logger.info('server_started')
  } catch {
    readiness.beginShutdown()
    logger.error('server_startup_failed', { reason: 'startup' })

    try {
      await prisma?.$disconnect()
    } catch {
      logger.error('prisma_disconnect_failed', { reason: 'startup' })
    }

    try {
      imageStore?.destroy?.()
    } catch {
      logger.error('runtime_resource_close_failed', { reason: 'startup' })
    }

    process.exitCode = 1
  }
}

await start()
