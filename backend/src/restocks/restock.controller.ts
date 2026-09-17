import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseCatalogId } from '../products/product.schemas.js'
import { parseIdempotencyKey, parseRestockInput } from './restock.schemas.js'
import type { RestockDependencies } from './restock.types.js'

export function createRestock(dependencies: RestockDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const auth = request.auth
      if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE || auth.role !== UserRole.OWNER) {
        throw new HttpError(403, 'ROLE_FORBIDDEN', 'Only an active OWNER may Restock')
      }
      const idempotencyKey = parseIdempotencyKey(request.headers, request.rawHeaders)
      const productId = parseCatalogId(request.params.productId, 'productId')
      const variantId = parseCatalogId(request.params.variantId, 'variantId')
      const input = parseRestockInput(request.body)
      const result = await dependencies.restock(auth.accountId, auth.userId, productId, variantId, idempotencyKey, input)
      response.status(result.idempotentReplay ? 200 : 201).json(result)
    } catch (error) { next(error) }
  }
}
