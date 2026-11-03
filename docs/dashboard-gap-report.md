# Owner Dashboard: gap report (Phase 1)

What the Owner Dashboard task (phases 2–7) needs, compared with what the project already has on
`main` (after the Business reports merge). Status: **OK** (exists, reuse), **DIFFERENT NAME** (exists
under our naming), **PARTIAL** (exists, needs fields), **MISSING** (to build).

## A. Database

| Needed for | Expected | Ours | Status | Notes |
|---|---|---|---|---|
| Current cost of a variant | `Variant.unitCost` | `ProductVariant.lastPurchaseCost Decimal(18,4)` | DIFFERENT NAME | Already "the current cost basis copied into SaleItem.unitCostAtSale". Keep the name. |
| When the cost changed | `Variant.costUpdatedAt` | — | MISSING | Add, nullable. |
| Cost snapshot per sale line | `SaleItem.unitCost` | `SaleItem.unitCostAtSale Decimal(18,4)?` | DIFFERENT NAME | Set inside the create-sale transaction already. No backfill needed: null means unknown, and sale lines are immutable by design (DB trigger). |
| Cost history | `CostEntry` | — | MISSING | Add. |
| Employee ↔ account link | `Membership` | `User` (`accountId`, `role`, `isActive`) | DIFFERENT NAME | One Supabase auth user = one `User` row = one account (`User.email` is globally unique). Extend `User`, no new Membership table. |
| Roles | OWNER / MANAGER / CASHIER | `UserRole` = SUPER_ADMIN / OWNER / WAREHOUSE | PARTIAL | DB triggers accept only OWNER or WAREHOUSE as sellers / return processors. Every employee stays `WAREHOUSE` at the DB level; a new `employeeRole` (MANAGER / CASHIER / WAREHOUSE) is the preset. |
| Member status, forced password change | `status`, `mustChangePassword`, `deactivatedAt/ById` | `isActive` only | PARTIAL | Add a `MemberStatus` enum (INVITED / ACTIVE / DEACTIVATED) kept in step with `isActive`. |
| Stores per member | `MembershipStore` | — | MISSING | Add `UserStore`. |
| Permissions | pages + capabilities | role checks in code | MISSING | Validated string array on `User` + "custom" flag (false = role preset). |
| Invites | `Invite` | — | MISSING | Add; token stored as SHA-256 only. |
| Audit log | `AuditLog` | — | MISSING | Add. |
| Expense categories | RENT, ELECTRICITY, GENERATOR, SALARIES, INTERNET, OTHER | `ExpenseCategory` RENT, SALARIES, ELECTRICITY, GENERATOR, OTHER | PARTIAL | Add `INTERNET` (additive). |
| Recurring expenses | `RecurringExpense` | — | MISSING | Add. |
| Expense row | label, month, store, recurring link, original amount, soft delete | `Expense` (description, amount, currency, expenseDate, category) | PARTIAL | Add `storeId?`, `recurringExpenseId?`, `originalAmount?`, `originalCurrency?`, `note?`, `deletedAt?`. `description` is the label; the month is the month of `expenseDate` (recurring rows use the 1st). |
| Monthly target | `SalesTarget` | `SalesTarget` (WEEK/MONTH, storeId?, periodStart) | OK | Unique on (account, store, period, periodStart) with NULLS NOT DISTINCT already exists in SQL. |
| Stores | `Store` | `Store` (one default per account) | OK | Sales have no `storeId`: one store per account in practice. |
| Daily rollups | rollups | `DailySalesRollup`, `DailyProductRollup`, `DailyStaffRollup` | OK | Reused. |
| Index Sale(accountId, storeId, createdAt) | — | `Sale(accountId, status, createdAt)`, `Sale(accountId, createdAt)` | DIFFERENT NAME | No storeId on Sale; existing indexes cover the queries. |
| Index SaleItem(variantId) | — | `SaleItem(accountId, variantId, createdAt)`, `(variantId, productId, accountId)` | OK | |

## B. Backend

| Needed for | Expected | Ours | Status | Notes |
|---|---|---|---|---|
| Session → user, account, role | auth middleware | `createRequireAuth` + `createRequireTenant` (DB lookup on every request, no cache) | OK | Deactivation is therefore effective on the next request. Extend with status, permissions, stores. |
| Permission middleware | `requirePermission` | `requireRole` | MISSING | Add and put on every tenant route. |
| One source of truth for money | day totals | `business/day-totals.ts` (`rangeTotals`, `liveDay`, rollups) | OK | Dashboard and best sellers use it. |
| Dashboard summary / best sellers | `/api/dashboard/*` | `/api/reports/daily` (old, used by the Dashboard) | MISSING | New endpoints on day-totals. |
| Product cost entry | `/api/products/:id/cost-entries` | `PUT .../variants/:id/opening-cost`, restocks (`createRestock`) | PARTIAL | New endpoint; stock goes through the existing restock flow. |
| Missing cost list | `/api/products/missing-cost` | — | MISSING | |
| Employees | `/api/employees/*` | — | MISSING | |
| Supabase Admin on the server | service role client | `createSupabaseAdminClient` (scripts only; runtime env has no service key) | PARTIAL | Add optional `SUPABASE_SERVICE_ROLE_KEY` + `APP_URL` to the runtime env; employee mail actions answer 503 when not configured. |
| Email sending | mailer | Supabase Auth mails only (no SMTP / Resend in the code) | DIFFERENT NAME | Invites: `auth.admin.inviteUserByEmail`; resend / reset: `auth.resetPasswordForEmail`. |
| Expenses | list by month, edit, soft delete, recurring | `GET/POST /api/expenses` (cursor list, create) | PARTIAL | Extend. |
| Targets | `/api/targets` | `PUT /api/business/targets` | PARTIAL | Add `/api/targets` (month view + suggestion) on the same service. |
| Rate limits | per account on writes | `createRateLimit` (IP), `AccountRateLimiter` (business) | OK | Reuse `AccountRateLimiter`. |
| Audit | audit log | — | MISSING | |
| Validation / errors | our library | hand-written parsers + `HttpError(status, code, message)` → `{ error: { code, message } }` | OK | |

## C. Frontend

| Needed for | Expected | Ours | Status | Notes |
|---|---|---|---|---|
| Routing | router | History API router (`App.jsx`, `routes.js`, `AppLayout.jsx`) | OK | |
| Nav | permission-driven nav | `app-navigation.js` (role lists) | PARTIAL | Drive by `/api/me/permissions`. |
| API client | client | `authenticatedApiRequest` (`auth/owner-flow.js`), business `api/client.js` | OK | |
| Dashboard page | `/dashboard` | `DashboardPage.jsx` (old: daily report, recent sales, stock) | PARTIAL | Rebuilt as the Owner Dashboard. |
| Shared cards | HeroCard, TargetCard, ProductsCard, PeriodNav, StorePicker, lib/money, lib/colors | `features/business/components/business/shared/*`, `nav/*`, `lib/*` | OK | Reused. |
| Accept invite / forced password | pages | `SetPasswordPage.jsx` (recovery) | PARTIAL | New `/accept-invite`; forced change screen. |
| Expenses page | month view | `ExpensesPage.jsx` (list + add) | PARTIAL | Replaced by `/dashboard/expenses`; `/app/expenses` keeps working. |

## D. Risks

1. **One user, one account.** `User.email` is globally unique and `User.id` is the Supabase auth id, so the
   same email cannot be a member of two accounts. An invite to an email used by another account is
   refused with a clear error (changing this is an architecture change).
2. **DB triggers check roles** (`OWNER` or `WAREHOUSE` for sellers and return processors). New roles are
   therefore presets on top of `WAREHOUSE`, not new `UserRole` values.
3. **Owner-only checks inside services** (void, debt payment, restock cost, product cost fields) are many.
   They are mapped to permissions where the capability exists (EXPENSES, VOID_SALE, EDIT_PRODUCT_COST,
   SETTINGS); see the report for what still requires the OWNER.
4. **Supabase mail limits** (default SMTP is rate limited by Supabase). Invites are also limited to 20 / hour
   per account on our side.
5. **No `storeId` on sales**: "own store only" for a cashier cannot filter sales; with one store per account
   it has no effect today.
6. **Production**: nothing here is applied to production; all migrations run on the local database.
