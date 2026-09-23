import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'
import { parseSaleIdempotencyKey, parseSaleInput } from './sale.schemas.js'
import type { SaleDependencies } from './sale.types.js'

export function createSale(dependencies: SaleDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const auth = request.auth
      if (!auth?.accountId) {
        throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An authenticated tenant user is required')
      }
      const idempotencyKey = parseSaleIdempotencyKey(request.headers, request.rawHeaders)
      const input = parseSaleInput(request.body)
      const result = await dependencies.createSale(auth.accountId, auth.userId, idempotencyKey, input)
      response.status(result.idempotentReplay ? 200 : 201).json(result)
    } catch (error) {
      next(error)
    }
  }
}
