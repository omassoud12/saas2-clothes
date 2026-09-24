import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseExchangeIdempotencyKey, parseExchangeInput, parseExchangeSaleId } from './exchange.schemas.js'
import type { ExchangeDependencies } from './exchange.types.js'

export function createExchange(dependencies: ExchangeDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const auth = request.auth
      if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE ||
          (auth.role !== UserRole.OWNER && auth.role !== UserRole.WAREHOUSE)) {
        throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An active tenant is required')
      }
      const result = await dependencies.createExchange(
        auth.accountId,
        auth.userId,
        parseExchangeSaleId(request.params.saleId),
        parseExchangeIdempotencyKey(request.headers, request.rawHeaders),
        parseExchangeInput(request.body),
      )
      response.status(result.idempotentReplay ? 200 : 201).json(result)
    } catch (error) {
      next(error)
    }
  }
}
