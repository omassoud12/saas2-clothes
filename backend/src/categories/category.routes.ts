import { Router } from 'express'
import { createRequireAuth, createRequireTenant } from '../auth/auth.middleware.js'
import type { AuthDependencies } from '../auth/auth.types.js'
import {
  createCreateCategory,
  createDeleteCategory,
  createListCategories,
  createUpdateCategory,
} from './category.controller.js'
import type { CategoryDependencies } from './category.types.js'

export function createCategoryRouter(
  auth: AuthDependencies,
  categories: CategoryDependencies,
): Router {
  const router = Router()

  router.use(createRequireAuth(auth), createRequireTenant(auth))
  router.get('/', createListCategories(categories))
  router.post('/', createCreateCategory(categories))
  router.patch('/:categoryId', createUpdateCategory(categories))
  router.delete('/:categoryId', createDeleteCategory(categories))

  return router
}
