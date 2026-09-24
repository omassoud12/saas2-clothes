import type { DailyFinancials, FinancialSummary } from './financial.types.js'

export interface DailyReportQuery {
  readonly date: string
}

export interface SummaryReportQuery {
  readonly from: string
  readonly to: string
}

export interface SummaryReportView extends FinancialSummary {
  readonly from: string
  readonly to: string
  readonly daysCount: number
}

export interface ReportDependencies {
  getDailyReport(accountId: string, query: DailyReportQuery): Promise<{ report: DailyFinancials }>
  getSummaryReport(accountId: string, query: SummaryReportQuery): Promise<{ report: SummaryReportView }>
}
