/**
 * Data shapes shared by the API layer, the mappers and the UI.
 * The backend sends DTOs (snake/camel exactly as in docs/API.md); mappers turn them into view models.
 * Money from the backend is a decimal STRING (e.g. "1248.50") to avoid float errors in transit.
 */

/**
 * @typedef {Object} DailySummaryDTO
 * @property {string} date               Business day in the shop's timezone, "YYYY-MM-DD".
 * @property {string} timezone           IANA zone used for the day boundaries, e.g. "Asia/Beirut".
 * @property {string} currency           Base currency, e.g. "USD".
 * @property {string} exchangeRate       USD -> LBP rate in force that day, decimal string.
 * @property {boolean} live              true while the day is still running (today).
 * @property {string|null} asOf          "HH:mm" shop time the numbers run to when live; null for past days.
 * @property {string} salesTotal         Revenue after discounts and returns; voided sales excluded.
 * @property {string|null} costTotal     Cost of goods sold. null when the user may not see costs.
 * @property {string|null} profitTotal   Gross profit = salesTotal - costTotal. null when hidden.
 * @property {boolean} costComplete      false if some sold items have no cost recorded.
 * @property {number} invoiceCount       Completed invoices (voided excluded).
 * @property {number} piecesSold
 * @property {string} discountsTotal     Discounts given on today's sales.
 * @property {{count: number, amountTotal: string}} returns   Returns processed today.
 * @property {{date: string, salesTotal: string, invoiceCount: number}} previousDay           Cut at `asOf` when live.
 * @property {{date: string, salesTotal: string, invoiceCount: number}} sameWeekdayLastWeek   Same weekday 7 days ago, cut at `asOf` when live.
 * @property {{method: 'CASH'|'WHISH', salesTotal: string, invoiceCount: number}[]} paymentSplit
 * @property {{id: string, name: string, storeNames: string[], salesTotal: string, profitTotal: string|null, invoiceCount: number}[]} byStaff
 * @property {ProductDTO[]} products   Every product sold that day (UI shows top 5 + See all).
 * @property {boolean} closed   Holiday: no invoices.
 * @property {{hour: number, salesTotal: string}[]} byHour   Opening hours so far, 24h clock in shop time.
 */

/**
 * @typedef {Object} InvoiceDTO
 * @property {string} id
 * @property {number} number             Per-account sequential receipt number.
 * @property {string} createdAt          ISO timestamp (UTC).
 * @property {number} itemCount
 * @property {string} total              Decimal string.
 * @property {'CASH'|'WHISH'} paymentMethod
 * @property {'COMPLETED'|'VOIDED'|'RETURNED'} status
 * @property {{id: string, name: string}} staff
 * @property {{id: string, name: string}} store
 * @property {string|null} customerName  Optional, when the cashier adds one.
 */

/**
 * @typedef {Object} InvoicePageDTO
 * @property {InvoiceDTO[]} items
 * @property {string|null} nextCursor
 */

/**
 * @typedef {Object} DailyFilters
 * @property {string} date               "YYYY-MM-DD"
 * @property {string} storeId            "all" or a store id
 * @property {string} method             "all" or a payment method
 * @property {string} q                  search text (receipt number or customer)
 */

/**
 * @typedef {Object} MonthDayDTO
 * @property {string} date            "YYYY-MM-DD"
 * @property {string} salesTotal
 * @property {string|null} costTotal   null for non-owners
 * @property {string|null} profitTotal null for non-owners
 * @property {number} invoiceCount
 */

/**
 * @typedef {Object} ProductDTO   Grouped by product, same shape in Daily, Weekly and Monthly.
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {number} quantity
 * @property {string} salesTotal
 * @property {string|null} profitTotal   OWNER only
 * @property {{id: string, label: string, quantity: number, salesTotal: string, profitTotal: string|null}[]} variants  label: "Black · Size 56"
 */

/**
 * @typedef {Object} MonthlySummaryDTO   See docs/API.md. Every day = the Daily day function.
 * @property {string} month
 * @property {string} timezone
 * @property {string} exchangeRate
 * @property {boolean} live
 * @property {string|null} asOf
 * @property {string|null} asOfDate
 * @property {{salesTotal: string, costTotal: string|null, profitTotal: string|null, invoiceCount: number, piecesSold: number, discountsTotal: string, returns: {count: number, amountTotal: string}}} totals
 * @property {{date: string, salesTotal: string|null, costTotal: string|null, profitTotal: string|null, invoiceCount: number, closed: boolean, forecastSalesTotal: string|null}[]} days  Every day of the month.
 * @property {{sameWeekdaysLastMonth: {from: string, to: string, salesTotal: string, invoiceCount: number}, sameWeekdaysLastYear: {from: string, to: string, salesTotal: string, invoiceCount: number}, previousMonthFull: {month: string, salesTotal: string}}} comparisons
 * @property {{salesTotal: string}|null} target
 * @property {{category: string, label: string, amountTotal: string}[]|null} expenses   OWNER only, spread over the month.
 * @property {{method: 'CASH'|'WHISH', salesTotal: string, invoiceCount: number}[]} paymentSplit
 * @property {{id: string, name: string, storeNames: string[], salesTotal: string, profitTotal: string|null, invoiceCount: number}[]} byStaff
 * @property {ProductDTO[]} products
 * @property {{basisDays: number, stockUnits: number, stockValue: string|null, deadStockValue: string|null, piecesSoldThisMonth: number, deadStock: object[]}|null} inventory  Current month only.
 */

/**
 * @typedef {Object} WeeklySummaryDTO   See docs/API.md. Totals = sum of the Daily day function.
 * @property {string} weekStart        Monday, "YYYY-MM-DD"
 * @property {string} weekEnd          Sunday, "YYYY-MM-DD"
 * @property {string} timezone
 * @property {string} exchangeRate
 * @property {boolean} live            true when the week contains today
 * @property {string|null} asOf        "HH:mm" when live
 * @property {string|null} asOfDate    today when live
 * @property {{salesTotal: string, costTotal: string|null, profitTotal: string|null, invoiceCount: number, piecesSold: number}} totals
 * @property {{salesTotal: string, invoiceCount: number}} previousWeek   Same days of last week, cut at asOf on today's weekday.
 * @property {{salesTotal: string}|null} target
 * @property {{date: string, salesTotal: string|null, costTotal: string|null, profitTotal: string|null, invoiceCount: number, previousSalesTotal: string, forecastSalesTotal: string|null}[]} days
 * @property {{method: 'CASH'|'WHISH', salesTotal: string, invoiceCount: number}[]} paymentSplit
 * @property {{id: string, name: string, storeNames: string[], salesTotal: string, profitTotal: string|null, invoiceCount: number}[]} byStaff
 * @property {ProductDTO[]} products
 * @property {number} slowMoversBasisDays  Window used for slowMovers (28).
 * @property {{id: string, name: string, variant: string, stock: number, soldLastNDays: number, lastSoldDate: string|null, stockValue: string|null}[]|null} slowMovers  Current week only.
 */

/**
 * @typedef {Object} YearMonthDTO
 * @property {string} month              "YYYY-MM"
 * @property {string} salesTotal
 * @property {string} cogsTotal          Cost of the goods that were sold
 * @property {string} purchasesTotal     Stock bought (stock receipts) that month
 * @property {string} rentTotal
 * @property {string} otherExpensesTotal Salaries, generator, supplies... (everything except rent)
 * @property {number} invoiceCount
 */

/**
 * @typedef {Object} YearlySummaryDTO   OWNER only (403 for other roles).
 * @property {number} year
 * @property {string} timezone
 * @property {string} exchangeRate
 * @property {YearMonthDTO[]} months      Jan up to the current month (shop timezone); past years have 12.
 * @property {{salesTotal: string, monthsCompared: number}} previousYear  Same months of the previous year.
 */

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'WHISH', label: 'Whish' },
];
