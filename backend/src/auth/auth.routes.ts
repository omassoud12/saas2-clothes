import { Router } from 'express'
import { createGetCurrentUser } from './auth.controller.js'
import { createRequireAuth } from './auth.middleware.js'
import type { AuthDependencies } from './auth.types.js'

export function createAuthRouter(dependencies: AuthDependencies): Router {
  const router = Router()

  router.get(
    '/me',
    createRequireAuth(dependencies),
    createGetCurrentUser(dependencies),
  )

  return router
}
