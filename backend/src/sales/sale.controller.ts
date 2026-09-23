import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseSaleHistoryQuery, parseSaleId, parseSaleIdempotencyKey, parseSaleInput, parseSaleVoidInput } from './sale.schemas.js'
import type { SaleDependencies } from './sale.types.js'

function tenantContext(auth: Express.Request['auth']): { accountId: string; role: UserRole } {
  if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE ||
      (auth.role !== UserRole.OWNER && auth.role !== UserRole.WAREHOUSE)) {
    throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An active tenant is required')
  }
  return { accountId: auth.accountId, role: auth.role }
}

export function listSales(dependencies: SaleDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const { accountId } = tenantContext(request.auth)
      response.json(await dependencies.listSales(accountId, parseSaleHistoryQuery(request.query)))
    } catch (error) { next(error) }
  }
}

export function getSale(dependencies: SaleDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const { accountId, role } = tenantContext(request.auth)
      response.json(await dependencies.getSale(accountId, role, parseSaleId(request.params.saleId)))
    } catch (error) { next(error) }
  }
}

export function createSale(dependencies: SaleDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const auth = request.auth
      const { accountId } = tenantContext(auth)
      const idempotencyKey = parseSaleIdempotencyKey(request.headers, request.rawHeaders)
      const input = parseSaleInput(request.body)
      const result = await dependencies.createSale(accountId, auth!.userId, idempotencyKey, input)
      response.status(result.idempotentReplay ? 200 : 201).json(result)
    } catch (error) {
      next(error)
    }
  }
}

export function voidSale(dependencies: SaleDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const auth = request.auth
      const { accountId, role } = tenantContext(auth)
      if (role !== UserRole.OWNER) {
        throw new HttpError(403, 'ROLE_FORBIDDEN', 'Only an active OWNER may Void a Sale')
      }
      const result = await dependencies.voidSale(
        accountId,
        auth!.userId,
        parseSaleId(request.params.saleId),
        parseSaleVoidInput(request.body),
      )
      response.status(result.idempotentReplay ? 200 : 201).json(result)
    } catch (error) {
      next(error)
    }
  }
}
