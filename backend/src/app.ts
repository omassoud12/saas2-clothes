import cors from 'cors'
import express from 'express'
import { createAuthRouter } from './auth/auth.routes.js'
import type { AuthDependencies } from './auth/auth.types.js'
import { errorHandler } from './middleware/error-handler.js'

export interface AppDependencies {
  readonly auth: AuthDependencies
}

export function createApp(dependencies: AppDependencies) {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', supabaseConfigured: true })
  })

  app.use('/api/auth', createAuthRouter(dependencies.auth))
  app.use(errorHandler)

  return app
}
