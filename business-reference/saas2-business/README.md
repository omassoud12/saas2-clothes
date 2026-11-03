# SaaS2 Business (Daily)

A separate React + Vite + Recharts module for the owner's Business area. Mobile first, same theme as the SaaS2 site and POS. **Daily**, **Weekly**, **Monthly** and **Yearly** are built.

## Run

```bash
cp .env.example .env     # VITE_USE_MOCK=true works with no backend
npm install
npm run dev
```

Set `VITE_USE_MOCK=false` to call the real backend. In development, Vite forwards `/api` to `http://localhost:3000` (see `vite.config.js`).

## Mobile first

Built and checked at 320px wide first; bigger screens only add space and, from 900px, two columns.

- One header for every tab: title + **store picker**, then the tabs. One sticky **period bar** (‹ Today ›, ‹ This week ›, ‹ November 2026 ›, ‹ 2026 ›) from `components/business/nav/`.
- The same cards on every tab (`components/business/shared/`): live badge, hero, target, day-by-day bars, payments, employees, products, discounts & returns.
- Rows that would squeeze on a phone stack instead: comparisons put the bar under the name and value, the hero puts gross profit on its own row, stock health is a list.
- `styles/business.css` is one mobile-first file: base = phone, `min-width: 400 / 600 / 900px` only add.

## What the Daily page shows

1. **Live badge**: "Live · so far today, up to 19:31" for today, "Full day" for past days.
2. **Sales and Gross profit** side by side: sales in USD with ≈ LBP and the rate (89,500), change vs yesterday **by this time**; gross profit with "% gross margin" (before rent and other costs). Owner only for profit.
3. **Where the money went**: one stacked bar, cost + gross profit = sales.
4. **Compared by this time**: today vs yesterday and vs last Monday (same weekday), both cut at the same hour, with "↓ $447 vs last Monday" style text.
5. **Average ticket** big, invoices, pieces sold and pieces per invoice smaller; **For closing the drawer**: Cash and Whish totals.
6. **Sales by hour**: small bar chart, busiest hour highlighted.
7. **Sales by employee**, **Top products today** (with pieces).
8. **Discounts and returns** today.
9. **Invoices**: search by receipt #, Cash/Whish chips (Whish in amber), voided marked, "Load more".

## What the Weekly page shows

Same layout and order as Daily: totals → sales → payments → employees → products, then "Not selling".

1. **Live badge**: "Live · this week so far, up to Mon 19:43", or "Full week".
2. **Hero** (same component as Daily): sales with ≈ LBP and rate, change vs last week **same days up to the same time**, gross profit with margin %, average ticket, pieces.
3. **Weekly target**: progress bar ($1,596 / $17,000) with a line for where you should be by tonight.
4. **Day by day**: bars split cost + gross profit, dashed line = last week, dashed outline = expected for days still to come; "Best day / Slowest" line; round axis ($0 · $1k · $2k · $3k).
5. **How customers paid** (Cash blue, Whish amber everywhere), **Sales by employee** (store, invoices, average ticket, profit), **Top products this week** (grouped by product, same card as Monthly).
6. **Not selling**: dead stock with money tied up, to discount (current week only).

## What the Monthly page shows

Same layout and order as Daily and Weekly. Every number is the sum of the same day function, so 1 Nov is the same in Daily, Weekly, Monthly and Yearly (`npm run check` proves it on the mock).

1. **Live badge** and **hero** (shared): sales, ≈ LBP, change vs last month **same weekdays**, gross profit + margin, average ticket, pieces.
2. **Monthly target**: progress with a pace line, "On pace for ~$49k this month" and last month's full total for reference (useful on day 2).
3. **Net profit**: sales − cost of goods = gross profit − rent, salaries, electricity, generator, other = net profit (owner).
4. **Sales by day**: daily bars (cost + gross profit), dashed outline for expected days to come, Best day / Slowest after 5 days.
5. **Week by week**: W1, W2… with sales and sales per day.
6. **Compared with**: horizontal bars + "↓ $298 (−10%)" vs last month and last year on the same weekdays.
7. **Every day of the month**: calendar heat grid (Mon…Sun columns, W1… rows), scale from $0 to the best day, best/today/closed marked, tap a day to open it in Daily.
8. **How customers paid**, **Sales by employee**, **What sells the most** (grouped by product, Revenue / Pieces / Profit toggle, tap for variants like "Black · Size 56", top 10 + See all).
9. **Discounts & returns** this month, **Stock health**: stock value, dead stock (nothing sold in 30 days), sell-through %.

## What the Yearly page shows (owner only)

1. **Year cards**: total sales (USD, LBP, invoices, vs last year), stock bought, rent, salaries & other costs, net profit.
2. **Money in vs money out**: sales vs (stock bought + rent + other costs) per month, with a breakdown tooltip.
3. **Growth**: monthly sales bars with a 3-month trend line on the same $ scale; tooltip shows month-over-month growth.
4. **Every month**: 12 tiles colored by sales, best month outlined; tap one to open it in Monthly.

Filters (view, day, week, month, year, store, method, search) live in the URL, so a view can be refreshed or shared.

## Code map

| Folder | What it does |
|---|---|
| `src/api/client.js` | fetch wrapper: base URL, auth token, abort, one error shape |
| `src/api/business.js` | endpoint functions; switches to the mock with `VITE_USE_MOCK` |
| `src/api/mock/` | mock backend returning the exact shapes of `docs/API.md` |
| `src/domain/types.js` | JSDoc types for DTOs and filters |
| `src/domain/mappers.js` | backend DTO → view model (one place to adapt if the API changes) |
| `src/hooks/` | `useAsync` (abortable loading), `useFilters` (URL-synced filters) |
| `src/lib/` | money (decimal strings, LBP rounding) and Beirut-day date helpers |
| `src/components/business/` | page sections and loading/error/empty states |
| `docs/API.md` | the backend contract (tenant, roles, timezone, money, pagination) |
| `server-example/` | Express + Prisma + Zod sketch of the endpoints, to adapt to your schema |

## Connecting auth

Call `setTokenProvider` from `src/api/client.js` once at startup, for example with Supabase:

```js
setTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token);
```
