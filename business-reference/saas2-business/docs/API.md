# Business API (Daily)

The frontend calls these endpoints through `src/api/business.js`. With `VITE_USE_MOCK=true` the built-in mock returns the same shapes, so switching to the real backend changes no UI code.

## Rules for every endpoint

- **Tenant**: the account (tenant) comes from the authenticated session on the server. The client never sends `accountId`. Every query filters by it.
- **Roles**: `OWNER` sees everything. Other roles get `costTotal: null` and `profitTotal: null` (enforced on the server, not only hidden in the UI).
- **Business day**: a `date` is a calendar day in the account's timezone (default `Asia/Beirut`). Day boundaries are computed on the server: `[date 00:00, date+1 00:00)` in that zone.
- **Money**: decimal strings with 2 decimals (`"1248.50"`), never floats.
- **Errors**: `{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": {} } }` with a 4xx/5xx status. `401` not logged in, `403` no access to the store.
- **Store filter**: `storeId` is optional. Missing or `all` means every store of the account. A store id from another account returns `403`.
- **One definition of a day's numbers** (most important rule): Daily, Weekly, Monthly and Yearly all sum the **same** day function: completed invoices only (voided excluded), sales **net of returns**, cost = quantity × unit cost at time of sale, invoice count = completed invoices. Never write a second query with its own filters for a report: the week of Mon 2 Nov with only Monday done must show exactly the Daily numbers of Mon 2 Nov. The mock checks this (weekly = sum of daily, monthly day = daily).
- **Closed days** (holidays set in Settings) have no invoices, so they are $0 in every report and marked `closed: true`. A day is never closed in one report and open in another.
- **One rounding rule** for every percentage (margins, shares, changes): whole percent, half up (36.5% → 37%). In the UI: `pct()` in `lib/money.js`.
- **Products** are grouped by product (all colours and sizes), each with its `variants` (`label` like "Black · Size 56"). Same shape in Daily, Weekly and Monthly: `products`.
- **Live periods**: when a period contains today, the response has `live: true` and `asOf: "HH:mm"`. Comparisons with earlier periods stop at the same time of day on the matching day.

## GET /api/stores

```json
{ "items": [{ "id": "st_hamra", "name": "Hamra" }, { "id": "st_jounieh", "name": "Jounieh" }] }
```

## GET /api/business/daily

Query: `date` (required, `YYYY-MM-DD`, not in the future), `storeId` (optional).

```json
{
  "date": "2026-11-02",
  "timezone": "Asia/Beirut",
  "currency": "USD",
  "exchangeRate": "89500",
  "live": true,
  "asOf": "19:31",
  "salesTotal": "1507.00",
  "costTotal": "949.40",
  "profitTotal": "557.60",
  "costComplete": true,
  "invoiceCount": 16,
  "piecesSold": 39,
  "discountsTotal": "2.00",
  "returns": { "count": 0, "amountTotal": "0.00" },
  "previousDay": { "date": "2026-11-01", "salesTotal": "1447.00", "invoiceCount": 15 },
  "sameWeekdayLastWeek": { "date": "2026-10-26", "salesTotal": "1954.00", "invoiceCount": 21 },
  "paymentSplit": [{ "method": "CASH", "salesTotal": "613.00", "invoiceCount": 7 }, { "method": "WHISH", "salesTotal": "894.00", "invoiceCount": 9 }],
  "byStaff": [{ "id": "u_rami", "name": "Rami", "storeNames": ["Hamra"], "salesTotal": "689.00", "profitTotal": "254.00", "invoiceCount": 7 }],
  "products": [{ "id": "p_linen", "name": "Linen shirt", "category": "Shirts", "quantity": 21, "salesTotal": "733.00", "profitTotal": "271.00",
     "variants": [{ "id": "v_linen_beige_m", "label": "Beige · Size M", "quantity": 10, "salesTotal": "349.00", "profitTotal": "129.00" }] }],
  "byHour": [{ "hour": 10, "salesTotal": "84.00" }]
}
```

- `live`: `true` when `date` is today in Beirut and the shop day is not over. `asOf` is the Beirut time (`HH:mm`) the numbers stop at.
- **Fair comparisons**: when `live`, `previousDay` and `sameWeekdayLastWeek` are summed **only up to `asOf`** on those days ("by this time"). For past days they are full days.
- `sameWeekdayLastWeek`: `date − 7 days` (Monday vs last Monday). Replaces `sameDayLastMonth`.
- `salesTotal`: completed sales minus returns made that day; voided sales excluded. `discountsTotal` and `returns` are shown separately so the owner sees what was given away.
- `costTotal`: sum of `quantity × unit cost at time of sale`. `profitTotal` is **gross profit** (sales − cost of goods), before rent and other costs. `costComplete: false` when any sold line has no cost.
- `costTotal`, `profitTotal`, `byStaff[].profitTotal`, `products[].profitTotal`: OWNER only, `null` for other roles.
- `products`: every product sold that day (the UI shows the top 5 with "See all"). `byHour`: shop hours, up to `asOf` when live. `closed`: holiday.
- `paymentSplit`: only `CASH` and `WHISH`; the Cash total is what should be in the drawer.

## GET /api/business/daily/invoices

Query: `date` (required), `storeId`, `method` (`CASH|WHISH`), `q` (receipt number), `cursor`, `limit` (1–50, default 10). Newest first.

```json
{
  "items": [
    {
      "id": "sale_8f2",
      "number": 1024,
      "createdAt": "2026-11-02T16:41:00.000Z",
      "itemCount": 3,
      "total": "67.00",
      "paymentMethod": "CASH",
      "status": "COMPLETED",
      "staff": { "id": "u_rami", "name": "Rami" },
      "store": { "id": "st_hamra", "name": "Hamra" },
      "customerName": null
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOi4uLn0"
}
```

- Cursor pagination on `(createdAt DESC, id DESC)`; `nextCursor` is opaque (base64 of the last row's keys) and `null` on the last page.
- Invoice rows never include cost.

## GET /api/business/weekly

Query: `week` (required, the Monday `YYYY-MM-DD`; any other day is moved back to its Monday), `storeId` (optional). Weeks run Monday to Sunday in the shop timezone.

```json
{
  "weekStart": "2026-11-02",
  "weekEnd": "2026-11-08",
  "timezone": "Asia/Beirut",
  "exchangeRate": "89500",
  "live": true,
  "asOf": "19:43",
  "asOfDate": "2026-11-02",
  "totals": { "salesTotal": "1596.00", "costTotal": "1013.47", "profitTotal": "582.53", "invoiceCount": 17, "piecesSold": 43 },
  "previousWeek": { "salesTotal": "1954.00", "invoiceCount": 21 },
  "target": { "salesTotal": "17000.00" },
  "days": [
    { "date": "2026-11-02", "salesTotal": "1596.00", "costTotal": "1013.47", "profitTotal": "582.53", "invoiceCount": 17, "previousSalesTotal": "1954.00", "forecastSalesTotal": null },
    { "date": "2026-11-03", "salesTotal": null, "costTotal": null, "profitTotal": null, "invoiceCount": 0, "previousSalesTotal": "2862.00", "forecastSalesTotal": "2380.00" }
  ],
  "paymentSplit": [{ "method": "CASH", "salesTotal": "613.00", "invoiceCount": 7 }, { "method": "WHISH", "salesTotal": "983.00", "invoiceCount": 10 }],
  "byStaff": [{ "id": "u_rami", "name": "Rami", "storeNames": ["Hamra"], "salesTotal": "570.00", "profitTotal": "204.00", "invoiceCount": 6 }],
  "products": [{ "id": "p_linen", "name": "Linen shirt", "category": "Shirts", "quantity": 21, "salesTotal": "733.00", "profitTotal": "271.00",
     "variants": [{ "id": "v_linen_beige_m", "label": "Beige · Size M", "quantity": 10, "salesTotal": "349.00", "profitTotal": "129.00" }] }],
  "slowMovers": [{ "id": "v_coat_l", "name": "Wool coat", "variant": "Camel · L", "stock": 15, "soldLastNDays": 0, "lastSoldDate": "2026-09-13", "stockValue": "570.00" }],
  "slowMoversBasisDays": 30
}
```

- **Totals** are the sum of the Daily day function for each day (see the rule at the top). Same numbers as Daily, always.
- `previousWeek`: the **same days** of last week; while `live`, last week's matching day stops at `asOf` ("by this time"). The same applies to `days[].previousSalesTotal` for today.
- `days`: always 7. Days still to come have `salesTotal: null` and `forecastSalesTotal` = average of that weekday over the last 4 weeks (drawn as a dashed outline).
- `target`: the weekly sales target the owner set for the store (or the sum of the stores' targets for "all"). `null` when none is set.
- `byStaff[].profitTotal`, `costTotal`, `profitTotal`, `stockValue`: OWNER only, `null` otherwise.
- `products`: every product sold this week, grouped, with variants.
- `slowMovers`: **stock right now**, so only returned for the current week (`null` for past weeks).
  - variants with stock and ≤ 2 pieces sold in the last `slowMoversBasisDays` days, with the money tied up.

## GET /api/business/monthly

Query: `month` (required, `YYYY-MM`, not in the future), `storeId` (optional).

```json
{
  "month": "2026-11",
  "timezone": "Asia/Beirut",
  "exchangeRate": "89500",
  "live": true,
  "asOf": "19:57",
  "asOfDate": "2026-11-02",
  "totals": {
    "salesTotal": "2822.00", "costTotal": "1768.00", "profitTotal": "1054.00", "invoiceCount": 39, "piecesSold": 81,
    "discountsTotal": "29.00", "returns": { "count": 0, "amountTotal": "0.00" }
  },
  "days": [
    { "date": "2026-11-01", "salesTotal": "1254.00", "costTotal": "785.00", "profitTotal": "469.00", "invoiceCount": 19, "closed": false, "forecastSalesTotal": null },
    { "date": "2026-11-02", "salesTotal": "1568.00", "costTotal": "983.00", "profitTotal": "585.00", "invoiceCount": 20, "closed": false, "forecastSalesTotal": "1823.75" },
    { "date": "2026-11-03", "salesTotal": null, "costTotal": null, "profitTotal": null, "invoiceCount": 0, "closed": false, "forecastSalesTotal": "1694.00" }
  ],
  "comparisons": {
    "sameWeekdaysLastMonth": { "from": "2026-10-04", "to": "2026-10-05", "salesTotal": "3120.00", "invoiceCount": 43 },
    "sameWeekdaysLastYear": { "from": "2025-11-02", "to": "2025-11-03", "salesTotal": "2951.00", "invoiceCount": 41 },
    "previousMonthFull": { "month": "2026-10", "salesTotal": "53503.00" }
  },
  "target": { "salesTotal": "52000.00" },
  "expenses": [
    { "category": "RENT", "label": "Rent", "amountTotal": "100.00" },
    { "category": "SALARIES", "label": "Salaries", "amountTotal": "160.00" },
    { "category": "ELECTRICITY", "label": "Electricity (EDL)", "amountTotal": "15.00" },
    { "category": "GENERATOR", "label": "Generator", "amountTotal": "40.00" },
    { "category": "OTHER", "label": "Other", "amountTotal": "14.00" }
  ],
  "paymentSplit": [{ "method": "CASH", "salesTotal": "1720.00", "invoiceCount": 24 }, { "method": "WHISH", "salesTotal": "1102.00", "invoiceCount": 15 }],
  "byStaff": [{ "id": "u_owner", "name": "Abu Ali", "storeNames": ["Hamra", "Jounieh"], "salesTotal": "1188.00", "profitTotal": "440.00", "invoiceCount": 13 }],
  "products": [{ "id": "p_linen", "name": "Linen shirt", "category": "Shirts", "quantity": 21, "salesTotal": "733.00", "profitTotal": "271.00",
     "variants": [{ "id": "v_linen_beige_m", "label": "Beige · Size M", "quantity": 10, "salesTotal": "349.00", "profitTotal": "129.00" }] }],
  "inventory": {
    "basisDays": 30, "stockUnits": 805, "stockValue": "17579.00", "deadStockValue": "1392.00", "piecesSoldThisMonth": 81,
    "deadStock": [{ "id": "v_coat_camel_l", "name": "Wool coat", "variant": "Camel · Size L", "stock": 9, "soldLastNDays": 0, "lastSoldDate": "2026-09-07", "stockValue": "540.00" }]
  }
}
```

- `days`: **every** day of the month, each = the Daily day function (so 1 Nov here = 1 Nov in Daily). Days still to come: `salesTotal: null` + `forecastSalesTotal` (average of the last 4 finished days with the same weekday). Today also has `forecastSalesTotal` (whole day) so the UI can project the month.
- `comparisons`: while `live`, the **same weekdays** (4 weeks earlier, or 5 after day 28; and 52 weeks earlier for last year), with the last day cut at `asOf`. Sun+Mon is compared with Sun+Mon, never Thu+Fri. For a finished month: the whole previous month and the whole same month last year. `previousMonthFull` is a reference for the projection.
- `target`: monthly target from Settings (or `null`).
- `expenses`: OWNER only. Monthly costs (rent, salaries, electricity, generator, other) **spread evenly over the days of the month**, so mid-month net profit is fair. Net profit = `profitTotal` − sum(expenses), computed in `mapMonthly`.
- `inventory`: stock right now, so current month only (`null` for past months). Sell-through = piecesSoldThisMonth ÷ (piecesSoldThisMonth + stockUnits).
- UI rules: "Best day / Slowest" only after 5 finished open days; projection = sales + rest of today's forecast + forecasts of the days to come.

## GET /api/business/yearly

Owner only (`403` for other roles). Query: `year` (required, `YYYY`, not in the future), `storeId` (optional).

```json
{
  "year": 2026,
  "timezone": "Asia/Beirut",
  "exchangeRate": "89500",
  "months": [
    {
      "month": "2026-01",
      "salesTotal": "18420.00",
      "cogsTotal": "11380.00",
      "purchasesTotal": "12950.00",
      "rentTotal": "1500.00",
      "otherExpensesTotal": "1960.00",
      "invoiceCount": 402
    }
  ],
  "previousYear": { "salesTotal": "151200.00", "monthsCompared": 11 }
}
```

- `months`: January up to the current month for this year; 12 months for past years. The current month holds what is recorded so far; the UI shows it as "so far" and leaves it out of growth and the trend line.
- `cogsTotal`: cost of the goods sold that month (used for net profit). `purchasesTotal`: stock bought that month (stock receipts), which is cash out even if not sold yet.
- `rentTotal` / `otherExpensesTotal`: from expenses, split by category (rent vs everything else). Keep an expense category for rent.
- `previousYear`: sales for the **same months** of the previous year.
- The UI computes: net profit = sales − COGS − rent − other; money out = purchases + rent + other; trend = 3-month moving average of sales; month-over-month growth.

## Indexes to have

- `Sale (accountId, createdAt)` and `Sale (accountId, storeId, createdAt)`
- `Sale (accountId, number)` for search by receipt number
- `SaleItem (saleId)`

## Next reports (not built yet)

Weekly and Monthly will reuse the same rules with `from`/`to` ranges.
