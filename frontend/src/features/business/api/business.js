// Business API. Each function returns DTOs exactly as documented in business-reference docs/API.md.
// The mock (api/mock/mockBusiness.js) is only used in local development with VITE_USE_MOCK=true; the
// production build never includes it (the condition is false at build time, so the import is dropped).
import { apiGet } from './client.js'

const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true'
const mock = () => import('./mock/mockBusiness.js')

/** GET /api/stores -> { items: [{ id, name }] } */
export function getStores(opts) {
  return USE_MOCK ? mock().then((m) => m.mockGetStores(opts)) : apiGet('/api/stores', {}, opts)
}

/** GET /api/business/daily?date=YYYY-MM-DD&storeId=... -> DailySummaryDTO */
export function getDailySummary({ date, storeId }, opts) {
  return USE_MOCK
    ? mock().then((m) => m.mockGetDailySummary({ date, storeId }, opts))
    : apiGet('/api/business/daily', { date, storeId }, opts)
}

/** GET /api/business/daily/invoices?date&storeId&method&q&cursor&limit -> InvoicePageDTO */
export function getInvoices({ date, storeId, method, q, cursor, limit = 10 }, opts) {
  return USE_MOCK
    ? mock().then((m) => m.mockGetInvoices({ date, storeId, method, q, cursor, limit }, opts))
    : apiGet('/api/business/daily/invoices', { date, storeId, method, q, cursor, limit }, opts)
}

/** GET /api/business/monthly?month=YYYY-MM&storeId=... -> MonthlySummaryDTO */
export function getMonthly({ month, storeId }, opts) {
  return USE_MOCK
    ? mock().then((m) => m.mockGetMonthly({ month, storeId }, opts))
    : apiGet('/api/business/monthly', { month, storeId }, opts)
}

/** GET /api/business/weekly?week=YYYY-MM-DD (Monday)&storeId=... -> WeeklySummaryDTO */
export function getWeekly({ week, storeId }, opts) {
  return USE_MOCK
    ? mock().then((m) => m.mockGetWeekly({ week, storeId }, opts))
    : apiGet('/api/business/weekly', { week, storeId }, opts)
}

/** GET /api/business/yearly?year=YYYY&storeId=... -> YearlySummaryDTO (OWNER only) */
export function getYearly({ year, storeId }, opts) {
  return USE_MOCK
    ? mock().then((m) => m.mockGetYearly({ year, storeId }, opts))
    : apiGet('/api/business/yearly', { year, storeId }, opts)
}
