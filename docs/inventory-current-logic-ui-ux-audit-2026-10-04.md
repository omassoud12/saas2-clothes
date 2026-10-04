# Inventory current logic, UI and UX audit — 2026-10-04

Scope: the current Inventory page after Inventory hardening Phases 1–3. This
review covers product definition, purchased-stock receiving, recovery, opening
cost, legacy Restock, receipt history, movement history, stock reconciliation,
authorization, responsive layout, accessibility, interface copy and workflow
clarity. It is an audit only. No application code, schema, migration or business
data was changed.

Evidence: current frontend/backend source, Prisma schema and ordered migrations,
the Phase 2 disposable PostgreSQL report, 250 frontend unit tests, 440 backend
tests, the full 73-case offline browser suite, and screenshot inspection at 390,
430, 768, 1280, 1366 and 1440 pixels. Browser API calls use intercepted fixtures.
The real-database evidence comes from the completed Phase 2 local PostgreSQL
18.4 run; this audit did not reconnect to or mutate a database.

## Executive verdict

There is no remaining confirmed P0 in the reviewed Inventory path. The former
RESTOCK database-contract conflict was fixed, and receipt creation, stock/cost
updates, linked movements, rollback, replay and concurrency were demonstrated
on disposable PostgreSQL. The current UI is also materially better than the old
single long page: the four views are separated, product rows are compact, the
receiving matrix contains its own horizontal scrolling, and review/confirmation
states make the financial effect understandable before submission.

The complete page is not yet release-ready for unattended recovery and durable
purchasing history. The highest remaining risk is the frontend receipt outcome
classifier: some confirmed terminal or authentication outcomes preserve a
pending operation forever, globally disabling new receiving, while an
idempotency conflict is offered the same retry that will keep conflicting.
Receipt history also renders current catalog/user names instead of immutable
receipt-time identity. These are P1 issues even though normal successful
receiving is correct.

## What the page contains and why

| View or action | Purpose | Writes inventory? |
| --- | --- | --- |
| Stock & receiving | Search products, inspect current option stock/cost and start operational actions | Read-only until an action is chosen |
| New product | Define product, category, color/size options, price and optional photo | Save-only creates zero stock; OWNER may combine definition with a receipt |
| Receive stock | Enter purchased quantities for several options at one shared purchase cost | Atomically increments stock, sets latest cost, creates receipt/items and one RESTOCK movement per item |
| Set cost | Resolve eligible legacy/opening stock whose cost is still pending | Changes current cost only; no stock or historical sale rewrite |
| Legacy Restock | Secondary compatibility flow for one purchased option | Adds stock, updates latest cost and writes RESTOCK |
| Receipt history | Review purchased batches | Read-only |
| Movement history | Review each signed stock movement | Read-only |
| Stock check | Compare stored stock with movement totals | Read-only; never repairs automatically |

OWNER can define products, receive, view costs, set eligible opening cost and use
legacy Restock. WAREHOUSE can define zero-stock products and view permitted
inventory/receipt data, but cannot receive or read cost fields. Backend guards,
not only hidden controls, enforce these boundaries.

## Findings, ordered by priority

### 1. P1 — Receipt recovery has incomplete terminal/auth outcome handling

`submitReceipt` marks transport/5xx as uncertain and a selected list of domain
errors as rejected. It does not normalize 401/session expiry or inactive-account
403 results into the redirect states used by the rest of Inventory. It also does
not classify confirmed `PRODUCT_NOT_FOUND` or `VARIANT_NOT_FOUND` as terminal
rejections. `RECEIPT_IDEMPOTENCY_CONFLICT` is retained but still receives the
same retry action, even though the frozen payload/key will conflict again.

Any pending record disables New product and Receive stock across the page. The
result can therefore be a permanent blocked Inventory UI after a confirmed 404,
an expired session, an account-state response, or a key conflict. Existing tests
explicitly verify that auth and conflict retain recovery, but they do not provide
a route out of those states.

Evidence: `frontend/src/features/inventory/stock-receipt-flow.js:45-52`;
`frontend/src/pages/app/InventoryPage.jsx:85-105,126-145`;
`frontend/src/features/inventory/stock-receipt-flow.test.js:42-47`.

Recommendation: implement one explicit outcome table: committed/replayed;
confirmed correctable rejection; authentication pause with preserved operation
and redirect; inactive-account pause; idempotency conflict requiring operation
review rather than retry; confirmed terminal not-found with safe release; and
genuinely uncertain transport/server result with exact-operation retry. Test
every row at flow and browser level.

### 2. P1 — Receipt history identity changes when catalog or user names change

Receipt quantity and cost are stored, but history reads current Product name,
current SKU/color/size and current User name through live relations. Editing any
of those values changes the visible description of an old receipt. The amount
remains correct, but the historical identity of what and who was recorded does
not.

Evidence: `backend/src/receipts/receipt.service.ts:10-16`; StockReceipt and
StockReceiptItem in `backend/prisma/schema.prisma`.

Recommendation: if receipt history is purchasing/audit evidence, store immutable
receipt-time product, option and actor display snapshots. If it is intentionally
only an operational view, document that limit prominently and do not present it
as immutable evidence.

### 3. P1 — Exactly-once recovery is limited to the same browser storage

The browser freezes the request and UUID before sending and Web Locks coordinate
tabs. Reload recovery in the same browser is verified and safe. If storage is
cleared/corrupted, is unavailable, or the user changes device after the server
commits but before the response arrives, the operation key is lost. The server
lookup endpoint requires that key, so a newly submitted delivery can duplicate
the original business event.

Evidence: `frontend/src/app/operation-recovery.js`;
`frontend/src/features/inventory/stock-receipt-recovery.js`;
`backend/src/receipts/receipt.service.ts:104-109`.

Recommendation: retain the current same-browser protection, state its boundary,
and add a server-assisted reconciliation path before claiming device/crash-safe
exactly-once UX. Never silently discard an uncertain operation.

### 4. P2 — Set cost is offered for zero-stock definitions the backend rejects

The UI shows Set cost for every active, cost-null option with stock greater than
or equal to zero. That includes a newly saved zero-stock option with no movement.
The backend accepts cost only when the movement ledger exactly matches current
stock and contains only the approved pending-cost movement history. With no
movements, Prisma's aggregate sum is null rather than numeric zero, so the action
ends in `OPENING_COST_UNAVAILABLE`.

Evidence: `frontend/src/features/inventory/InventoryProductPicker.jsx:19`;
`backend/src/products/product.service.ts:434-453`.

Recommendation: return an authoritative `canSetOpeningCost` state/reason from
the backend and render the action from that contract. Do not infer accounting
eligibility from stock and null cost alone.

### 5. P2 — Receipt rows are not append-only evidence at database level

InventoryMovement is protected by append-only database triggers. StockReceipt
and StockReceiptItem have strong tenant/product/option foreign keys and no
normal update API, but no trigger prevents UPDATE/DELETE. The database also does
not independently require a receipt item's quantity/cost to equal its linked
movement's quantity/cost. Current service code creates matching rows atomically;
the gap matters for future code or privileged maintenance.

Evidence: `backend/prisma/migrations/20260929190000_stock_receipts/migration.sql`;
the movement history triggers in the ordered earlier migrations.

Recommendation: once receipt history's evidence role is decided, add reviewed
immutability and link invariants and exercise the final SQL on PostgreSQL.

### 6. P2 — Receipt history can shift under inserts and is hard to search

Receipt history uses page-number offset pagination. A new receipt inserted while
the user moves between pages can shift rows, producing duplicates or omissions.
The page also has no product/date search, so an older delivery must be found by
paging through UUID-labeled records.

Evidence: `backend/src/receipts/receipt.service.ts:100-102`;
`frontend/src/features/inventory/ReceiptHistory.jsx`.

Recommendation: use stable `(createdAt,id)` cursor pagination, then add bounded
product/date filters without exposing cost to WAREHOUSE.

### 7. P2 — Movement and stock-check filters only know the current product page

The two audit views receive their Product choices from the currently loaded,
paginated Stock & receiving result. An off-page Product cannot be selected in
those filters. The option selector also displays only SKU, although operators
usually recognize color/size first.

Evidence: `frontend/src/pages/app/InventoryPage.jsx:149-151`;
`frontend/src/features/inventory/InventoryAuditSections.jsx:21-24,70`.

Recommendation: provide a bounded tenant-scoped filter search independent of
the current catalog page. Label choices as `Color / size — SKU`.

### 8. P2 — Inventory payload size is bounded by Products, not options

Inventory loads complete option arrays for every Product on the current page.
Product pagination therefore does not bound the response or render work for a
single Product that accumulates many options after creation. The receiving form
is bounded to 200 submitted options, but that is not a permanent Product-size
limit.

Evidence: `frontend/src/pages/app/InventoryPage.jsx:108-115`;
`backend/src/products/product.service.ts:173-189`.

Recommendation: measure production-like payloads. If needed, load compact
Product summaries first and fetch the selected Product's options for receiving
and details. The current evidence does not justify a speed claim or an immediate
large refactor.

### 9. P2 — Save-only recovery uses receiving language

The recovery heading distinguishes a zero-stock Product save, but its region
label and action still say “receiving.” Form failures say “No receipt was saved”
and “Another tab is confirming this receipt” even when the operation intended
only to create a Product. The key-conflict error also exposes implementation
language instead of a concrete recovery choice.

Evidence: `frontend/src/features/inventory/ReceiptPresentation.jsx:34`;
`frontend/src/features/inventory/StockReceiptForm.jsx:47-59`.

Recommendation: branch copy by operation kind: “Retry the original product
save,” “Product was not created,” and “Another tab is confirming this product
save.” Keep the exact-operation meaning of retry.

### 10. P3 — Mobile view tabs need a clearer overflow cue

At 390px the tab row scrolls horizontally and prevents page overflow, but
Movement history is partially clipped and Stock check begins off-screen. Touch
and keyboard scrolling work; discoverability is the issue.

Evidence: `.inventory-views` in
`frontend/src/features/inventory/receiving.css:19-21`; current 390px screenshot.

Recommendation: add a small visual overflow cue or compact mobile labels while
retaining 44px targets and horizontal scrolling.

### 11. P3 — A few loading/error strings expose implementation language

Examples include “Receipt history response was invalid” and “This key belongs
to different details.” They describe transport/idempotency internals rather than
the affected task and next step.

Evidence: `frontend/src/features/inventory/stock-receipt-flow.js:39-51`.

Recommendation: use object + outcome + action, while preserving the critical
difference between a confirmed rejection and an unknown result.

## Logic that is working well

- Account and actor come from authenticated context; receipt bodies cannot choose
  another tenant or performer.
- OWNER-only cost/receiving rules and WAREHOUSE cost omission are backend-enforced.
- Receiving locks Product then sorted options, updates stock/cost, creates the
  receipt, items and movements in one transaction, and rolls everything back on
  failure.
- Each receipt-linked RESTOCK movement satisfies the existing movement-level
  idempotency contract with a deterministic child UUID and fingerprint.
- Same key/same payload replays without another stock effect; changed payload
  conflicts.
- Sale cost snapshots remain historical; later receiving never rewrites them.
- Products `+ / −` is a one-piece ADJUSTMENT correction, separate from purchased
  receiving.
- Stock reconciliation is read-only and movement pagination is cursor-based.
- Phase 2 real PostgreSQL checks passed receipt rollback, tenant FKs, limits,
  replay, same/different-key concurrency, Sale/correction races, deactivation
  races, 24/100/200-option receipts and bounded lock timeout with zero observed
  deadlocks.

## UI, interface and UX assessment

The visual hierarchy is coherent. The page uses one clear green primary action,
neutral secondary actions, amber pending/review states, green success and red
errors. Input boundaries are visible, keyboard focus uses a strong 3px outline,
and normal controls are at least 42px high.

The product picker is compact and keeps option-level operational tools collapsed.
It clearly distinguishes Receive stock, Legacy Restock and count correction.
The receiving matrix uses a sticky color/size column and a contained horizontal
scroll region, so dense options do not widen the whole page. Quantity inputs,
shared cost, live total, review and final confirmation form a clear sequence.
The review screen exposes the exact quantity and purchase total before the write.

Mobile layouts passed the covered no-horizontal-page-overflow checks. The matrix
itself intentionally scrolls, includes a swipe hint, and remains keyboard
scrollable. Long Product/color names wrap. Dirty-state guards protect product
definition, quantities and opening cost during navigation/refresh. Success,
partial photo failure, empty, loading and error states all provide a next action.

The main UX weaknesses are recovery dead ends, Set cost eligibility, history
findability and the mobile tab cue. Density, palette and responsive structure no
longer require a broad redesign.

## Validation

- Frontend unit tests: 250 passed, 42 suites.
- Backend tests: 440 passed, 77 suites.
- Offline browser suite: 73 passed, including receiving, reload recovery,
  save-only creation, photo-only retry, responsive picker/matrix/review/success,
  dirty-state guards, view/filter preservation and stock correction coverage.
- Frontend ESLint: passed.
- Vite production build: passed.
- Prior Phase 2 PostgreSQL validation: 23/23 database checks passed on a disposable
  local PostgreSQL 18.4 instance; 200-option receiving completed in about 791ms
  on that machine. This is not a production latency guarantee.

## Recommended order

1. Complete the receipt outcome/recovery table and its browser flows.
2. Decide whether receipt history is formal evidence; if yes, add identity
   snapshots and database immutability/link invariants.
3. Return authoritative opening-cost eligibility and remove the dead-end action.
4. Move receipt history to a cursor and add product/date filtering.
5. Decouple movement/reconciliation filter search from the current product page.
6. Measure large catalog payloads before changing fetch architecture.
7. Polish save-only recovery copy and mobile tab discoverability.

## Limits and change boundary

The browser suite is offline and uses intercepted API fixtures. The real database
checks were completed in Phase 2 on a disposable local instance, not current
production infrastructure. No live authenticated mutation, remote database,
load test, commit or deployment was performed during this audit.

The working tree already contains the earlier Inventory implementation and
hardening changes. This audit adds only this report. No frontend/backend source,
Prisma schema/migration, business data or protected PDF was changed.
