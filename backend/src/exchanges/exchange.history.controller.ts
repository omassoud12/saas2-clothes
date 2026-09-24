import type { RequestHandler } from 'express'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { HttpError } from '../errors/http-error.js'
import { parseExchangeHistoryQuery, parseExchangeId } from './exchange.history.schemas.js'
import type { ExchangeHistoryDependencies } from './exchange.history.service.js'

function tenantAccountId(auth: Express.Request['auth']): string {
  if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE ||
      (auth.role !== UserRole.OWNER && auth.role !== UserRole.WAREHOUSE)) {
    throw new HttpError(403, 'TENANT_ACCESS_REQUIRED', 'An active tenant is required')
  }
  return auth.accountId
}

export function listExchanges(dependencies: ExchangeHistoryDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      response.json(await dependencies.listExchanges(
        tenantAccountId(request.auth),
        parseExchangeHistoryQuery(request.query),
      ))
    } catch (error) { next(error) }
  }
}

export function getExchange(dependencies: ExchangeHistoryDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      response.json(await dependencies.getExchange(
        tenantAccountId(request.auth),
        parseExchangeId(request.params.exchangeId),
      ))
    } catch (error) { next(error) }
  }
}
