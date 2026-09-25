import type { RequestHandler } from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'

export const READINESS_TIMEOUT_MS = 2_000

export class ReadinessState {
  private started = false
  private shuttingDown = false

  markStarted(): void {
    if (!this.shuttingDown) this.started = true
  }

  beginShutdown(): void {
    this.shuttingDown = true
  }

  isReady(): boolean {
    return this.started && !this.shuttingDown
  }
}

export interface ReadinessDependencies {
  readonly state: ReadinessState
  readonly probeDatabase: () => Promise<void>
}

export function createPrismaReadinessProbe(
  prisma: PrismaClient,
  timeoutMs = READINESS_TIMEOUT_MS,
): () => Promise<void> {
  return async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('readiness probe timed out')),
            timeoutMs,
          )
          timeout.unref?.()
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}

export function createReadinessHandler(
  dependencies: ReadinessDependencies,
): RequestHandler {
  return async (_request, response) => {
    if (!dependencies.state.isReady()) {
      response.status(503).json({ status: 'not_ready' })
      return
    }

    try {
      await dependencies.probeDatabase()
      response.json({ status: 'ready' })
    } catch {
      response.status(503).json({ status: 'not_ready' })
    }
  }
}
