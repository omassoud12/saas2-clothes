import type { Prisma } from '../generated/prisma/client.js'

export interface DailyFinancials {
  readonly reportDate: string
  readonly currency: string
  readonly salesCount: number
  readonly totalUnitsSold: number
  readonly grossRevenue: string
  readonly returnedRevenue: string
  readonly voidedRevenue: string
  readonly netRevenue: string
  readonly grossCOGS: string
  readonly returnedCOGS: string
  readonly voidedCOGS: string
  readonly netCOGS: string
  readonly grossProfit: string
  readonly operatingExpenses: string
  readonly netProfit: string
  readonly stockValue: null
}

export type FinancialSummary = Omit<DailyFinancials, 'reportDate'>

export interface RebuiltDailyReport extends DailyFinancials {
  readonly computedAt: Date
}

export interface DailyReportService {
  rebuildDailyReport(accountId: string, reportDate: string): Promise<RebuiltDailyReport>
}

export type FinancialTransaction = Prisma.TransactionClient

export type FinancialErrorCode =
  | 'INVALID_FINANCIAL_DATE'
  | 'INVALID_FINANCIAL_RANGE'
  | 'FINANCIAL_ACCOUNT_NOT_FOUND'
  | 'FINANCIAL_INVARIANT_VIOLATION'
  | 'FINANCIAL_VALUE_OVERFLOW'
  | 'FINANCIAL_REBUILD_FAILED'

export class FinancialComputationError extends Error {
  readonly code: FinancialErrorCode

  constructor(code: FinancialErrorCode, message: string) {
    super(message)
    this.name = 'FinancialComputationError'
    this.code = code
  }
}
