import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseCatalogId, parseProductCreate, parseProductList, parseProductUpdate, parseVariantCreate, parseVariantUpdate } from './product.schemas.js'
import type { ProductDependencies } from './product.types.js'

function tenant(auth: Express.Request['auth']): { accountId: string; userId: string; role: UserRole } {
  if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE ||
      (auth.role !== UserRole.OWNER && auth.role !== UserRole.WAREHOUSE)) {
    throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An active authenticated tenant is required')
  }
  return { accountId: auth.accountId, userId: auth.userId, role: auth.role }
}

export function productOwnership(dependencies: ProductDependencies): RequestHandler {
  return async (request, _response, next) => {
    try {
      const context = tenant(request.auth)
      await dependencies.assertProductOwned(context.accountId, parseCatalogId(request.params.productId, 'productId'))
      next()
    } catch (error) { next(error) }
  }
}

export function listProducts(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      response.json(await dependencies.listProducts(context.accountId, context.role, parseProductList(request.query)))
    } catch (error) { next(error) }
  }
}

export function getProduct(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      const product = await dependencies.getProduct(context.accountId, parseCatalogId(request.params.productId, 'productId'), context.role)
      response.json({ product })
    } catch (error) { next(error) }
  }
}

export function createProduct(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      const input = parseProductCreate(request.body, context.role === UserRole.OWNER)
      const product = await dependencies.createProduct(context.accountId, context.userId, context.role, input)
      response.status(201).json({ product })
    } catch (error) { next(error) }
  }
}

export function updateProduct(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      const input = parseProductUpdate(request.body, context.role === UserRole.OWNER)
      const product = await dependencies.updateProduct(context.accountId, parseCatalogId(request.params.productId, 'productId'), context.role, input)
      response.json({ product })
    } catch (error) { next(error) }
  }
}

export function createVariant(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      const variant = await dependencies.createVariant(
        context.accountId,
        parseCatalogId(request.params.productId, 'productId'),
        context.role,
        parseVariantCreate(request.body),
      )
      response.status(201).json({ variant })
    } catch (error) { next(error) }
  }
}

export function updateVariant(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      const variant = await dependencies.updateVariant(
        context.accountId,
        parseCatalogId(request.params.productId, 'productId'),
        parseCatalogId(request.params.variantId, 'variantId'),
        context.role,
        parseVariantUpdate(request.body),
      )
      response.json({ variant })
    } catch (error) { next(error) }
  }
}

export function uploadImage(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      if (!request.file) throw new HttpError(422, 'PRODUCT_IMAGE_REQUIRED', 'One image is required')
      const product = await dependencies.uploadImage(
        context.accountId,
        parseCatalogId(request.params.productId, 'productId'),
        context.role,
        request.file.buffer,
      )
      response.json({ product })
    } catch (error) { next(error) }
  }
}

export function deleteImage(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      if (request.body !== undefined &&
          (typeof request.body !== 'object' || request.body === null ||
            Array.isArray(request.body) || Object.keys(request.body).length > 0)) {
        throw new HttpError(422, 'INVALID_IMAGE_DELETE_INPUT', 'Image deletion accepts no request body')
      }
      await dependencies.deleteImage(context.accountId, parseCatalogId(request.params.productId, 'productId'))
      response.status(204).send()
    } catch (error) { next(error) }
  }
}
