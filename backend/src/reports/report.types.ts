import type { DailyFinancials } from './financial.types.js'

export interface DailyReportQuery {
  readonly date: string
}

export interface ReportDependencies {
  getDailyReport(accountId: string, query: DailyReportQuery): Promise<{ report: DailyFinancials }>
}
