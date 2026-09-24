import type { RequestHandler } from 'express'
import { HttpError } from '../errors/http-error.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { parseDailyReportQuery, parseSummaryReportQuery } from './report.schemas.js'
import type { ReportDependencies } from './report.types.js'

function ownerAccountId(auth: Express.Request['auth']): string {
  if (!auth?.accountId || auth.accountStatus !== AccountStatus.ACTIVE || auth.role !== UserRole.OWNER) {
    throw new HttpError(403, 'REPORT_OWNER_REQUIRED', 'An active tenant OWNER is required')
  }
  return auth.accountId
}

export function getDailyReport(dependencies: ReportDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      response.json(await dependencies.getDailyReport(
        ownerAccountId(request.auth),
        parseDailyReportQuery(request.query),
      ))
    } catch (error) {
      next(error)
    }
  }
}

export function getSummaryReport(dependencies: ReportDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      response.json(await dependencies.getSummaryReport(
        ownerAccountId(request.auth),
        parseSummaryReportQuery(request.query),
      ))
    } catch (error) {
      next(error)
    }
  }
}
