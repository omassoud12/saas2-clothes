import type { Server } from 'node:http'
import type { ReadinessState } from './readiness.js'
import type { RuntimeLogger } from './logger.js'

export const HTTP_REQUEST_TIMEOUT_MS = 30_000
export const HTTP_HEADERS_TIMEOUT_MS = 10_000
export const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5_000
export const SHUTDOWN_DEADLINE_MS = 10_000

export function configureHttpServer(server: Server): void {
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS
  server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS
}

interface ClosableServer {
  close(callback: (error?: Error) => void): unknown
  closeAllConnections?: () => void
}

export interface ShutdownDependencies {
  readonly server: ClosableServer
  readonly readiness: ReadinessState
  readonly disconnectPrisma: () => Promise<void>
  readonly closeResources?: () => void | Promise<void>
  readonly logger: RuntimeLogger
  readonly deadlineMs?: number
  readonly exit?: (code: number) => void
  readonly setTimer?: typeof setTimeout
  readonly clearTimer?: typeof clearTimeout
}

export interface ShutdownCoordinator {
  shutdown(reason: string, exitCode?: number): Promise<void>
}

export function createShutdownCoordinator(
  dependencies: ShutdownDependencies,
): ShutdownCoordinator {
  const deadlineMs = dependencies.deadlineMs ?? SHUTDOWN_DEADLINE_MS
  const exit = dependencies.exit ?? ((code) => process.exit(code))
  const setTimer = dependencies.setTimer ?? setTimeout
  const clearTimer = dependencies.clearTimer ?? clearTimeout
  let shutdownPromise: Promise<void> | undefined
  let requestedExitCode = 0
  let cleanupPromise: Promise<void> | undefined

  function cleanupOnce(): Promise<void> {
    cleanupPromise ??= (async () => {
      try {
        await dependencies.disconnectPrisma()
      } catch {
        dependencies.logger.error('prisma_disconnect_failed', {
          reason: 'shutdown',
        })
      }

      try {
        await dependencies.closeResources?.()
      } catch {
        dependencies.logger.error('runtime_resource_close_failed', {
          reason: 'shutdown',
        })
      }
    })()
    return cleanupPromise
  }

  async function closeServer(): Promise<void> {
    await new Promise<void>((resolve) => {
      try {
        dependencies.server.close(() => resolve())
      } catch {
        resolve()
      }
    })
  }

  const coordinator: ShutdownCoordinator = {
    shutdown(reason, exitCode = 0) {
      requestedExitCode = Math.max(requestedExitCode, exitCode)
      if (shutdownPromise) return shutdownPromise

      dependencies.readiness.beginShutdown()
      dependencies.logger.warn('shutdown_started', { reason })

      shutdownPromise = new Promise<void>((resolve) => {
        let finished = false
        const deadline = setTimer(() => {
          if (finished) return
          finished = true
          dependencies.server.closeAllConnections?.()
          void cleanupOnce()
          dependencies.logger.error('shutdown_deadline_exceeded', {
            reason: 'forced_shutdown',
          })
          exit(Math.max(1, requestedExitCode))
          resolve()
        }, deadlineMs)
        deadline.unref?.()

        void (async () => {
          await closeServer()
          await cleanupOnce()
          if (finished) return
          finished = true
          clearTimer(deadline)
          dependencies.logger.info('shutdown_completed', { reason })
          exit(requestedExitCode)
          resolve()
        })()
      })

      return shutdownPromise
    },
  }
  return Object.freeze(coordinator)
}

export function installProcessHandlers(
  coordinator: ShutdownCoordinator,
): void {
  process.on('SIGTERM', () => void coordinator.shutdown('SIGTERM'))
  process.on('SIGINT', () => void coordinator.shutdown('SIGINT'))
  process.on(
    'unhandledRejection',
    createFatalProcessHandler(coordinator, 'unhandled_rejection'),
  )
  process.on(
    'uncaughtException',
    createFatalProcessHandler(coordinator, 'uncaught_exception'),
  )
}

export function createFatalProcessHandler(
  coordinator: ShutdownCoordinator,
  reason: 'unhandled_rejection' | 'uncaught_exception',
): () => void {
  return () => void coordinator.shutdown(reason, 1)
}
