import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseReturnIdempotencyKey, parseReturnInput, parseReturnSaleId } from './return.schemas.js'
import type { ReturnDependencies } from './return.types.js'

export function createReturn(dependencies: ReturnDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const auth = request.auth
      if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE ||
          (auth.role !== UserRole.OWNER && auth.role !== UserRole.WAREHOUSE)) {
        throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An active tenant is required')
      }
      const idempotencyKey = parseReturnIdempotencyKey(request.headers, request.rawHeaders)
      const saleId = parseReturnSaleId(request.params.saleId)
      const input = parseReturnInput(request.body)
      const result = await dependencies.createReturn(auth.accountId, auth.userId, saleId, idempotencyKey, input)
      response.status(result.idempotentReplay ? 200 : 201).json(result)
    } catch (error) {
      next(error)
    }
  }
}
