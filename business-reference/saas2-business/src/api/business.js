// Business API. Each function returns DTOs exactly as documented in docs/API.md.
// VITE_USE_MOCK=true serves the same shapes from the built-in mock.
import { apiGet } from './client.js';
import { mockGetDailySummary, mockGetInvoices, mockGetMonthly, mockGetStores, mockGetWeekly, mockGetYearly } from './mock/mockBusiness.js';

const USE_MOCK = String(import.meta.env?.VITE_USE_MOCK ?? 'true') === 'true';

/** GET /api/stores -> { items: [{ id, name }] } */
export function getStores(opts) {
  return USE_MOCK ? mockGetStores(opts) : apiGet('/api/stores', {}, opts);
}

/** GET /api/business/daily?date=YYYY-MM-DD&storeId=... -> DailySummaryDTO */
export function getDailySummary({ date, storeId }, opts) {
  return USE_MOCK
    ? mockGetDailySummary({ date, storeId }, opts)
    : apiGet('/api/business/daily', { date, storeId }, opts);
}

/** GET /api/business/daily/invoices?date&storeId&method&q&cursor&limit -> InvoicePageDTO */
export function getInvoices({ date, storeId, method, q, cursor, limit = 10 }, opts) {
  return USE_MOCK
    ? mockGetInvoices({ date, storeId, method, q, cursor, limit }, opts)
    : apiGet('/api/business/daily/invoices', { date, storeId, method, q, cursor, limit }, opts);
}

/** GET /api/business/monthly?month=YYYY-MM&storeId=... -> MonthlySummaryDTO */
export function getMonthly({ month, storeId }, opts) {
  return USE_MOCK
    ? mockGetMonthly({ month, storeId }, opts)
    : apiGet('/api/business/monthly', { month, storeId }, opts);
}

/** GET /api/business/weekly?week=YYYY-MM-DD (Monday)&storeId=... -> WeeklySummaryDTO */
export function getWeekly({ week, storeId }, opts) {
  return USE_MOCK
    ? mockGetWeekly({ week, storeId }, opts)
    : apiGet('/api/business/weekly', { week, storeId }, opts);
}

/** GET /api/business/yearly?year=YYYY&storeId=... -> YearlySummaryDTO (OWNER only) */
export function getYearly({ year, storeId }, opts) {
  return USE_MOCK
    ? mockGetYearly({ year, storeId }, opts)
    : apiGet('/api/business/yearly', { year, storeId }, opts);
}

