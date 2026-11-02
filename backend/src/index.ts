import { createReceiptDependencies } from './receipts/receipt.service.js'
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
import { createSettingsDependencies } from './settings/settings.js'
import { createCountCheckDependencies } from './inventory/count-check.js'
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
import {
  classifyStartupError,
  type StartupStage,
} from './runtime/startup-diagnostics.js'
import { createSaleDependencies } from './sales/sale.service.js'
import { createBusinessDependencies } from './business/business.routes.js'
import { createVoidRefresher, scheduleNightlyRollups } from './business/rollup-jobs.js'
import { ReportCache } from './business/business-cache.js'
import { createSupabaseVerifier } from './supabase.js'
import { createVoiceMatchingDependencies } from './voice-sales/matching.service.js'
import { createVoiceTranscriptionDependencies } from './voice-sales/transcription.service.js'

const logger = createJsonLogger()

async function start(): Promise<void> {
  let prisma: ReturnType<typeof createPrismaClient> | undefined
  let imageStore: ReturnType<typeof createR2ProductImageStore> | undefined
  const readiness = new ReadinessState()
  let startupStage: StartupStage = 'environment'

  try {
    const environment = loadEnvironment()
    startupStage = 'database_client'
    prisma = createPrismaClient(environment.databaseUrl, {
      caPath: environment.databaseCaPath,
      nodeEnvironment: environment.nodeEnvironment,
    })
    startupStage = 'supabase_client'
    const supabaseVerifier = createSupabaseVerifier(environment)
    startupStage = 'dependencies'
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
    // A void rewrites the day the sale was made: refresh that day of the business rollups after commit.
    const businessCache = new ReportCache()
    const forgetBusinessReports = (accountId: string) => businessCache.invalidateAccount(accountId)
    const sales = createSaleDependencies(prisma, { afterVoid: createVoidRefresher(prisma, logger, forgetBusinessReports) })
    const returns = createReturnDependencies(prisma)
    const exchanges = createExchangeDependencies(prisma)
    const exchangeHistory = createExchangeHistoryDependencies(prisma)
    const expenses = createExpenseDependencies(prisma)
    const reports = createReportDependencies(prisma)
    const settings = createSettingsDependencies(prisma)
    const countChecks = createCountCheckDependencies(prisma)
    startupStage = 'app'
    const app = createApp(
      {
        auth,
        adminAccounts,
        categories,
        products,
        voiceMatching: createVoiceMatchingDependencies(prisma, async (context, productId, imageKey) => {
          if (!context.accountId) return null
          try {
            imageStore ??= createR2ProductImageStore(loadR2Environment())
            return await imageStore.signedReadUrl(context.accountId, productId, imageKey)
          } catch { return null }
        }),
        voiceTranscription: createVoiceTranscriptionDependencies({
          apiKey: environment.elevenLabsApiKey,
          timeoutMs: environment.elevenLabsSttTimeoutMs,
          onFailure: (failure) => {
            logger.warn('voice_transcription_failed', {
              requestId: failure.requestId,
              stage: failure.stage,
              upstreamStatus: failure.upstreamStatus,
              code: failure.providerCode,
              mimeType: failure.mimeType,
              byteCount: failure.byteCount,
            })
          },
        }),
        inventory,
        receipts: createReceiptDependencies(prisma),
        sales,
        returns,
        exchanges,
        exchangeHistory,
        expenses,
        reports,
        settings,
        countChecks,
        business: createBusinessDependencies(prisma, { cache: businessCache, logger }),
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

    startupStage = 'listen'
    const server = app.listen(environment.port)
    configureHttpServer(server)
    await once(server, 'listening')

    // Nightly business rollups (03:30 Asia/Beirut) for the last 3 days of active accounts.
    scheduleNightlyRollups(prisma, logger, { invalidate: forgetBusinessReports })

    startupStage = 'runtime_handlers'
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
  } catch (error: unknown) {
    readiness.beginShutdown()
    logger.error('server_startup_failed', {
      reason: 'startup',
      stage: startupStage,
      code: classifyStartupError(error, startupStage),
    })

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
