import { Router } from 'express'
import {
  createBootstrapOwner,
  createGetCurrentUser,
} from './auth.controller.js'
import {
  createBootstrapRateLimit,
  createRequireAuth,
  createRequireVerifiedIdentity,
} from './auth.middleware.js'
import type { AuthDependencies } from './auth.types.js'

export function createAuthRouter(dependencies: AuthDependencies): Router {
  const router = Router()

  router.post(
    '/bootstrap-owner',
    createRequireVerifiedIdentity(dependencies),
    createBootstrapRateLimit(),
    createBootstrapOwner(dependencies),
  )

  router.get(
    '/me',
    createRequireAuth(dependencies),
    createGetCurrentUser(dependencies),
  )

  return router
}
