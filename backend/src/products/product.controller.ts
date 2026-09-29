import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseCatalogId, parseProductSetup, parseProductCreate, parseProductList, parseProductUpdate, parseVariantCreate, parseVariantUpdate } from './product.schemas.js'
import { parseIdempotencyKey, parseRestockInput } from '../restocks/restock.schemas.js'
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
      const { view, ...query } = request.query
      if (view !== undefined && view !== 'summary') throw new HttpError(422, 'INVALID_PRODUCT_FILTER', 'Unsupported catalog view')
      response.json(view === 'summary' ? await dependencies.listProductSummaries(context.accountId, parseProductList(query)) : await dependencies.listProducts(context.accountId, context.role, parseProductList(query)))
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
        parseVariantCreate(request.body, context.role === UserRole.OWNER),
        context.userId,
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
        parseVariantUpdate(request.body, context.role === UserRole.OWNER),
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

export function setOpeningCost(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      if (context.role !== UserRole.OWNER) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Only an owner can set cost')
      const body = request.body
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'unitCost')) {
        throw new HttpError(422, 'INVALID_OPENING_COST', 'Only unitCost is accepted')
      }
      const input = parseRestockInput({ quantity: 1, unitCost: body.unitCost })
      const variant = await dependencies.setOpeningCost(context.accountId, parseCatalogId(request.params.productId, 'productId'), parseCatalogId(request.params.variantId, 'variantId'), context.role, input.unitCost)
      response.json({ variant })
    } catch (error) { next(error) }
  }
}

export function quickAddStock(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      if (context.role !== UserRole.OWNER) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Only an owner can add stock')
      if (request.body !== undefined && (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).some(key => key !== 'delta') || (request.body.delta !== undefined && request.body.delta !== 1 && request.body.delta !== -1))) throw new HttpError(422, 'INVALID_QUICK_STOCK', 'Stock change must be 1 or -1')
      const started = performance.now()
      const variant = await dependencies.quickAddStock(context.accountId, parseCatalogId(request.params.productId, 'productId'), parseCatalogId(request.params.variantId, 'variantId'), context.role, context.userId, parseIdempotencyKey(request.headers, request.rawHeaders), request.body?.delta ?? 1)
      response.setHeader('Server-Timing', `auth;dur=${Number(response.locals.productAuthMs ?? 0).toFixed(1)},stock;dur=${(performance.now() - started).toFixed(1)}`)
      response.json({ variant })
    } catch (error) { next(error) }
  }
}

export function createProductSetup(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      const input = parseProductSetup(request.body, context.role === UserRole.OWNER)
      const product = await dependencies.createProductSetup(context.accountId, context.userId, context.role, input.product, input.variants)
      response.status(201).json({ product })
    } catch (error) { next(error) }
  }
}

export function applyVariantPrice(dependencies: ProductDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const context = tenant(request.auth)
      if (context.role !== UserRole.OWNER) throw new HttpError(403, 'ROLE_FORBIDDEN', 'Pricing requires an owner')
      const body = request.body
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['variantIds', 'sellingPrice'].includes(key)) || !Array.isArray(body.variantIds) || typeof body.sellingPrice !== 'string') throw new HttpError(422, 'INVALID_BULK_PRICE', 'Choose options and a price')
      const ids = body.variantIds.map((id: unknown) => parseCatalogId(id, 'variantId'))
      response.json({ product: await dependencies.applyVariantPrice(context.accountId, parseCatalogId(request.params.productId, 'productId'), context.role, ids, body.sellingPrice) })
    } catch (error) { next(error) }
  }
}
