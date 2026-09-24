import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import {
  computeDailyFinancialsInTransaction,
  computeFinancialRangeInTransaction,
  summarizeFinancialDays,
} from './financial.service.js'
import { FinancialComputationError } from './financial.types.js'
import type { ReportDependencies } from './report.types.js'

function safeFinancialError(error: FinancialComputationError): HttpError {
  switch (error.code) {
    case 'INVALID_FINANCIAL_DATE':
    case 'INVALID_FINANCIAL_RANGE':
      return new HttpError(422, 'INVALID_REPORT_QUERY', 'Financial report query is invalid')
    case 'FINANCIAL_ACCOUNT_NOT_FOUND':
      return new HttpError(409, 'REPORT_ACCOUNT_UNAVAILABLE', 'Financial report Account is unavailable')
    case 'FINANCIAL_INVARIANT_VIOLATION':
    case 'FINANCIAL_VALUE_OVERFLOW':
      return new HttpError(500, 'FINANCIAL_REPORT_INVARIANT', 'Financial report could not be calculated safely')
    case 'FINANCIAL_REBUILD_FAILED':
      return new HttpError(500, 'FINANCIAL_REPORT_UNAVAILABLE', 'Financial report is unavailable')
  }
}

export function createReportDependencies(prisma: PrismaClient): ReportDependencies {
  async function getDailyReport(accountId: string, query: { readonly date: string }) {
    try {
      const report = await prisma.$transaction(
        (transaction) => computeDailyFinancialsInTransaction(transaction, accountId, query.date),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
      return { report }
    } catch (error) {
      if (error instanceof HttpError) throw error
      if (error instanceof FinancialComputationError) throw safeFinancialError(error)
      throw new HttpError(503, 'FINANCIAL_REPORT_UNAVAILABLE', 'Financial report is temporarily unavailable')
    }
  }

  async function getSummaryReport(accountId: string, query: { readonly from: string; readonly to: string }) {
    try {
      const report = await prisma.$transaction(async (transaction) => {
        const days = await computeFinancialRangeInTransaction(
          transaction,
          accountId,
          query.from,
          query.to,
        )
        return {
          from: query.from,
          to: query.to,
          daysCount: days.length,
          ...summarizeFinancialDays(days),
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
      return { report }
    } catch (error) {
      if (error instanceof HttpError) throw error
      if (error instanceof FinancialComputationError) throw safeFinancialError(error)
      throw new HttpError(503, 'FINANCIAL_REPORT_UNAVAILABLE', 'Financial report is temporarily unavailable')
    }
  }

  return { getDailyReport, getSummaryReport }
}
