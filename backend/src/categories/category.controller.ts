import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseCategoryId, parseCategoryInput } from './category.schemas.js'
import type { CategoryDependencies } from './category.types.js'

function requireTenantAccountId(auth: Express.Request['auth']): string {
  if (
    !auth?.accountId ||
    auth.accountStatus !== AccountStatus.ACTIVE ||
    (auth.role !== UserRole.OWNER && auth.role !== UserRole.WAREHOUSE)
  ) {
    throw new HttpError(
      403,
      'TENANT_ACCESS_REQUIRED',
      'An active authenticated tenant is required',
    )
  }

  return auth.accountId
}

export function createListCategories(
  dependencies: CategoryDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const categories = await dependencies.listCategories(
        requireTenantAccountId(request.auth),
      )
      response.json({ categories })
    } catch (error) {
      next(error)
    }
  }
}

export function createCreateCategory(
  dependencies: CategoryDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const accountId = requireTenantAccountId(request.auth)
      const input = parseCategoryInput(request.body)
      const category = await dependencies.createCategory(accountId, input)
      response.status(201).json({ category })
    } catch (error) {
      next(error)
    }
  }
}

export function createUpdateCategory(
  dependencies: CategoryDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const accountId = requireTenantAccountId(request.auth)
      const categoryId = parseCategoryId(request.params.categoryId)
      const input = parseCategoryInput(request.body)
      const category = await dependencies.updateCategory(
        accountId,
        categoryId,
        input,
      )
      response.json({ category })
    } catch (error) {
      next(error)
    }
  }
}

export function createDeleteCategory(
  dependencies: CategoryDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const accountId = requireTenantAccountId(request.auth)
      const categoryId = parseCategoryId(request.params.categoryId)
      await dependencies.deleteCategory(accountId, categoryId)
      response.status(204).send()
    } catch (error) {
      next(error)
    }
  }
}
