# Performance Fix Phase 1 — Inventory loading

Date: 2026-10-04. This report covers only Inventory lazy loading and safe
read-request deduplication/abort behavior. It does not begin Performance Fix
Phase 2.

## 1. Previous request behavior

`InventoryPage` started the Product list and Category list effects on every
mount. `ReceiptHistory`, `InventoryHistory`, and `InventoryReconciliation` were
all mounted inside hidden containers, so each component also started its GET on
mount. The initial visible Stock & receiving screen therefore caused five
business-data reads: Products, Categories, receipts, movements, and
reconciliation. React StrictMode ran the setup/cleanup/setup cycle again; the
old cleanups ignored late state updates but did not cancel their network work.

The request owners were:

| Dataset | Previous initiator |
| --- | --- |
| Products | `InventoryPage` Product-list `useEffect` |
| Categories | `InventoryPage` mount-only `useEffect` |
| Receipt history | `ReceiptHistory` mount/page effect |
| Movement history | `InventoryHistory` filter/version effect |
| Reconciliation | `InventoryReconciliation` filter/version effect |
| `productId` detail | `InventoryPage` deep-link effect |

`AppRouteGuard` already protected its profile request with a promise ref and
React StrictMode remains enabled in `main.jsx`.

## 2. New request behavior

The normal Inventory entry loads the Product list only. Receipt history,
Movement history, Stock check, and Categories make no request until the user
opens the corresponding workflow. A `productId` deep link loads one Product
detail read and defers the collection read until the user returns to Inventory.

## 3. Initial-mount before/after request count

| Shape | Before | After |
| --- | ---: | ---: |
| Production-shaped business reads | 5 | 1 |
| Development StrictMode-shaped business reads | 10 | 1 backend request in the controlled StrictMode browser fixture |

The after request is `GET /api/products?page=1&limit=12&isActive=all`. The
controlled fixture injects the authenticated profile, so this count deliberately
measures Inventory business reads and excludes the real application's guard
request.

## 4. Lazy-loading behavior by Inventory tab

- Stock & receiving loads Products on normal entry.
- Receipt history mounts on first activation and loads its selected page.
- Movement history mounts on first activation and preserves filters/pages in
  memory while another tab is active.
- Stock check mounts on first activation and remains read-only.
- Switching away and back reuses settled state for the same request key.
- Explicit refresh and filter/page changes create a new request.
- A parent mutation version marks already visited hidden views stale; the
  currently active view refreshes immediately and a hidden view refreshes when
  next activated.

## 5. Category loading behavior

Categories start in an explicit idle state and load only when New Product is
opened, including the `?new=1` entry. The form exposes its existing loading
state, a failed read exposes a Retry action, and one successful result is reused
for later New Product openings during the same page lifetime. Category business
rules and mutation APIs are unchanged.

## 6. GET deduplication design

The existing API client now keeps a narrow in-flight registry for GET only. A
key contains the final URL/query and normalized relevant headers. Registries
are partitioned by `fetchImpl` and access token, so reads from different session
contexts cannot share work. Equivalent concurrent callers share response-body
transport while retaining their own result mapping. Entries are removed as soon
as the request settles; there is no response cache, cross-session cache, or
failed-promise retention.

POST, PATCH, PUT, DELETE, receipt submission, and recovery retries bypass this
registry. Unit coverage proves two simultaneous POST calls remain two calls.

## 7. AbortController design

Products, Categories, receipt history, movement history, reconciliation, their
read pagination, and Product detail accept an `AbortSignal`. Effect cleanup
detaches its subscriber and stale generations cannot update state. An aborted
subscriber receives the internal `REQUEST_ABORTED` outcome, which the feature
flows preserve and UI effects ignore.

Shared GET work has subscriber-aware cancellation: one cancelled caller cannot
cancel a request still needed by another caller. When the last subscriber
leaves, a short 25 ms grace period lets React StrictMode's replacement effect
attach; otherwise the underlying fetch is aborted. The grace period applies to
in-flight work only and is not a data cache. Generic mutation requests do not
receive this signal.

## 8. StrictMode result

StrictMode was not disabled. The full offline browser fixture now mounts the
application under `React.StrictMode`. Initial Inventory produced one Product
backend request and zero hidden-tab or Category requests. No abort outcome was
rendered as an error, no loop occurred, and the full browser suite passed.

## 9. Mutation invalidation behavior

Save Product Only, Save & Receive, Receive stock, opening-cost changes, legacy
Restock, terminal recovery refreshes, and successful recovery keep the existing
parent version invalidation. The visible Product stock list remains
authoritative. Visited audit/history tabs use that version as a stale marker and
reload when visible; unvisited tabs still make no request. Receipt mutation
payloads, idempotency keys, frozen recovery records, and retry behavior were not
changed.

## 10. `productId` deep-link result

`/app/inventory?productId=...` still opens Receive stock with the selected
Product. Under StrictMode its equivalent Product detail reads share one backend
request. The Product collection, Categories, receipts, movements, and
reconciliation remain unloaded until required. Returning to Inventory releases
the deferred Product collection load.

## 11. Files changed

- `frontend/src/lib/api-client.js`
- `frontend/src/auth/owner-flow.js`
- `frontend/src/features/categories/category-flow.js`
- `frontend/src/features/products/product-flow.js`
- `frontend/src/features/inventory/stock-receipt-flow.js`
- `frontend/src/features/inventory/inventory-audit-flow.js`
- `frontend/src/features/inventory/ReceiptHistory.jsx`
- `frontend/src/features/inventory/InventoryAuditSections.jsx`
- `frontend/src/pages/app/InventoryPage.jsx`
- `frontend/src/lib/api-client.test.js`
- `scripts/products-ui.test.mjs`
- `docs/performance-fix-phase-1-inventory-loading-2026-10-04.md`

The pre-existing untracked `docs/performance-audit-2026-10-04.md` was read as
the required baseline and was not rewritten by this phase.

## 12. Tests added/updated

API-client tests cover same-session equivalent GET sharing, session isolation,
settled-entry removal, independent subscriber abort, last-subscriber transport
abort, and mutation non-deduplication/non-abort. Browser coverage verifies the
initial request set, first tab activation, load-once switching, explicit receipt
refresh, first Category load/reuse, StrictMode request count, and `productId`
deep-link behavior. The full browser fixture now exercises all existing flows
under StrictMode.

## 13. Frontend unit result

266 tests passed in 42 suites; 0 failed, skipped, or cancelled. The focused
Product/Category/Inventory/API-client run passed 73 tests in 9 suites.

## 14. Browser result

81 tests passed; 0 failed, skipped, or cancelled in the final full StrictMode
run. Focused Phase 1 browser tests also passed after the final deep-link change.

## 15. ESLint result

`npm.cmd run lint --workspace client`: passed.

## 16. Vite build result

`npm.cmd run build --workspace client`: passed; 128 modules transformed.

## 17. `git diff --check` result

Passed with only the repository's existing LF/CRLF conversion warnings.

## 18. Before/after timing and request evidence

The final full offline StrictMode fixture recorded Stock & receiving usable in
1,290 ms and exactly one initial Inventory business GET. The controlled baseline
was five production-shaped or ten StrictMode-shaped business reads. Hidden-tab
and Category request counts were all zero on initial entry. No browser
blocked/queue timing was captured. This localhost fixture is deterministic
regression evidence, not a production latency or capacity claim.

## 19. Remaining performance bottlenecks

This phase deliberately leaves authenticated-session strategy, backend query
shape, Product payload size, Prisma/PostgreSQL pooling, deployment regions,
indexes, and receipt transaction round trips unchanged. Inventory still returns
complete option arrays for products on the current page. Receipt transaction
latency and remote infrastructure behavior remain separate phases.

## 20. `git diff --stat`

Before adding this untracked report, tracked Phase 1 source/test changes were 11
files with 387 insertions and 87 deletions. The final command
output is recorded again after validation; untracked Markdown files are not
included by Git's ordinary `diff --stat`.

## 21. `git status`

The 11 frontend/test files listed above are modified. This report and the
pre-existing performance audit are untracked. No backend, Prisma, schema, or
migration file is modified.

## 22. Confirmation

- Performance Fix Phase 1 only.
- No Auth redesign.
- No database/query optimization.
- No Prisma, schema, or migration change.
- No database execution or mutation.
- No commit, push, or deployment.
- `planing/SaaS2_Clothes_Implementation_Summary.pdf` was not opened or changed.
