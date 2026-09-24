import { HttpError } from '../errors/http-error.js'
import { enumerateReportDates, parseReportDate } from './financial.service.js'
import { FinancialComputationError } from './financial.types.js'
import type { DailyReportQuery, SummaryReportQuery } from './report.types.js'

function invalid(code: string, message: string): never {
  throw new HttpError(422, code, message)
}

function exactQuery(
  query: Record<string, unknown>,
  fields: readonly string[],
  code: string,
): void {
  const keys = Object.keys(query)
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    invalid(code, `Exactly ${fields.join(' and ')} must be provided`)
  }
}

function reportDate(value: unknown, name: string, code: string): string {
  if (typeof value !== 'string') invalid(code, `${name} must use YYYY-MM-DD`)
  try {
    parseReportDate(value)
    return value
  } catch (error) {
    if (error instanceof FinancialComputationError) invalid(code, `${name} must be a valid YYYY-MM-DD date`)
    throw error
  }
}

export function parseDailyReportQuery(query: Record<string, unknown>): DailyReportQuery {
  exactQuery(query, ['date'], 'INVALID_DAILY_REPORT_QUERY')
  return { date: reportDate(query.date, 'date', 'INVALID_DAILY_REPORT_DATE') }
}

export function parseSummaryReportQuery(query: Record<string, unknown>): SummaryReportQuery {
  exactQuery(query, ['from', 'to'], 'INVALID_SUMMARY_REPORT_QUERY')
  const from = reportDate(query.from, 'from', 'INVALID_SUMMARY_REPORT_DATE')
  const to = reportDate(query.to, 'to', 'INVALID_SUMMARY_REPORT_DATE')
  try {
    enumerateReportDates(from, to)
  } catch (error) {
    if (error instanceof FinancialComputationError) {
      invalid('INVALID_SUMMARY_REPORT_RANGE', 'Report range must contain 1 to 366 inclusive days')
    }
    throw error
  }
  return { from, to }
}
