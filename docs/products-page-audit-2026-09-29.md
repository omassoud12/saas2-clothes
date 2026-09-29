# Products page audit - 2026-09-29

Scope: catalog, filters, creation, dedicated details, product/variant editing,
quick stock, status changes, images, authorization and related sale readiness.
This is an audit only. No application code or business data was changed.

Evidence: source review, offline browser flows at 390, 768, 1024, 1366 and
1440 pixels, screenshot inspection, existing unit/service tests and three
additional temporary browser probes. Browser APIs and database service tests
use fixtures/doubles. Findings are not a production penetration test or a live
database concurrency/performance benchmark.

## Findings, ordered by priority

### 1. P1 - Pending-cost stock looks ready to sell

OWNER setup creates one piece per selected option with unknown purchase cost.
The details page shows Active and positive stock without a sale-readiness
explanation. Sale creation still rejects null cost with SALE_COST_UNAVAILABLE.
This conflicts with the user's requested ability to sell before entering cost.
The creation note mentions Inventory, but the saved detail page does not provide
a pending-cost state or next-step link.

Evidence: frontend/src/app/ProductCreateForm.jsx:72 and :113;
frontend/src/pages/app/ProductsPage.jsx:316;
backend/src/sales/sale.service.ts:397.

Recommendation: expose an OWNER-only pending-cost indicator and a direct
Inventory action. Resolve the sale-before-cost accounting behavior explicitly;
do not silently use zero cost or claim that UI changes enable that sale.

### 2. P1 - Stock retry protection is lost when leaving or reloading

Quick-stock UUIDs are stored only in a component useRef Map. A request can
commit on the server and lose its response. Retrying in the same mounted page
reuses the UUID correctly. Reloading or navigating away destroys that Map.
A subsequent click intended as a retry uses a new UUID and changes stock again.
The server idempotency mechanism works; client recovery is not persistent.

Reproduced: stock 4 -> committed but aborted response -> reload -> new + click
-> stock 6, with different UUIDs. This is a conditional recovery risk, not a
claim that ordinary clicks double-increment.

Evidence: frontend/src/pages/app/ProductsPage.jsx:101 and :210;
frontend/src/app/AppLayout.jsx:127.

Recommendation: retain unresolved operations with tenant/user/product/variant/
direction context across remounts and offer a clearly named recovery action.
Resolve outstanding operations before offering another ambiguous retry.

### 3. P2 - Common price is available on creation, absent on product edit

Creation sets one price for all selected options. Product Edit exposes only
name/category. Updating a model's price afterward requires editing every size
individually, increasing work and the chance of inconsistent prices.

Evidence: frontend/src/app/ProductCreateForm.jsx:91;
frontend/src/pages/app/ProductsPage.jsx:35 and :49. Confirmed in browser.

Recommendation: a single explicit apply-price-to-all action, including a preview
of affected options; preserve legitimate individual exceptions intentionally.

### 4. P2 - Duplicate color/size combinations are accepted

Duplicate checks compare SKU and barcode only. Two variants can have different
SKUs and both be Black / M. The detail cards then look identical while stock
and price belong to separate sellable records.

Evidence: frontend/src/app/product-flow.js:137;
backend/src/products/product.schemas.ts:161;
backend/prisma/schema.prisma:174-177. A direct duplicate-helper probe returned
ok:true for identical Black / M with different SKUs.

Recommendation: define normalized combination uniqueness and enforce it in both
UI and backend. Review existing duplicates before any database constraint.

### 5. P2 - Unsaved edits disappear without warning

Product/variant drafts are component state. Back to products and app navigation
can discard them without a dirty-form guard. Creation warns on browser unload
only after workflow.started, not during ordinary form entry; internal History
API navigation does not trigger beforeunload.

Evidence: frontend/src/pages/app/ProductsPage.jsx:312;
frontend/src/app/ProductCreateForm.jsx:29;
frontend/src/App.jsx:31. Reproduced editing a name, returning, and reopening.

Recommendation: preserve drafts or warn only when meaningful unsaved changes
would be lost. Include internal navigation, browser Back and reload.

### 6. P2 - Sale readiness also lacks a price check

OWNER creation accepts an empty price and sends null; zero is accepted by the
catalog validation as well. A saved product can therefore have stock but no
usable default sale price. The browser probe saved three options with null
sellingPrice successfully. This permissive catalog behavior may be intentional,
but it needs a clear incomplete-price state rather than implying readiness.

Evidence: frontend/src/app/ProductCreateForm.jsx:91;
frontend/src/app/product-flow.js:127-132.

Recommendation: either require a positive default price for this creation flow
or clearly mark missing/zero-price options and provide the next action.

### 7. P2 - Inactive options affect undifferentiated catalog totals

Catalog summaries include all variants, including inactive stock and prices.
An active option with stock 1 at $15 plus an inactive option with stock 9 at $99
produces stock 10 and a $15-$99 price range. Those figures are not labeled as
physical stock versus sellable stock. Color section totals have the same issue.

Evidence: frontend/src/lib/money.js:48;
frontend/src/pages/app/ProductsPage.jsx:325. Confirmed with a pure-function probe.

Recommendation: explicitly distinguish total physical stock from active/sellable
stock, and use active option prices for operational catalog price summaries.

### 8. P2 - Pending stock actions have weak feedback

Quick-stock sets one global busy value, disabling controls across the product.
The clicked + or - retains its symbol and does not show a local pending state.
This makes network delay look like an unresponsive button. Error mapping lacks
specific quick-stock messages such as INSUFFICIENT_STOCK and STOCK_LIMIT_REACHED.

Evidence: frontend/src/pages/app/ProductsPage.jsx:196, :215 and :330;
frontend/src/app/product-flow.js:6 and :36.

Recommendation: show progress on the affected option and a clear retry/correction
message. Keep serialized changes unless concurrency is deliberately designed.

### 9. P2 - Catalog pagination does not bound option payload size

The list returns complete variant arrays for each product. Products are paginated
but options are not; individual option creation can grow a product beyond the
initial setup's 200-option request limit. This can increase response size and
render work on larger stores. No production-size timing was measured here.

Evidence: backend/src/products/product.service.ts:44 and :143.

Recommendation: measure real payloads/query plans, then consider bounded catalog
summaries and fetching options only on the dedicated details route. Avoid
guessing that this alone explains the previously reported five-second writes.

### 10. P3 - Size order follows clicks, not clothing order

Options are appended when selected. Detail grouping does not sort them, and the
backend orders only by createdAt. Batched options share timestamps, so equal-time
ordering is not guaranteed. Browser probe selecting L, XS, M posted that order.

Evidence: frontend/src/app/ProductCreateForm.jsx:55;
frontend/src/pages/app/ProductsPage.jsx:278;
backend/src/products/product.service.ts:44.

Recommendation: standard XS, S, M, L, XL, XXL, 3XL, 4XL order with a stable rule
for custom sizes and a deterministic database tie-breaker where relevant.

### 11. P3 - Copy and spacing still contain old workflow assumptions

The add-option success message instructs users to choose Add stock and enter
quantity/purchase cost, but the actual control is now + / - without a form.
The collapsed photo editor occupies its own padded full-width panel. Sparse
color groups also retain large empty space to the right of their size cards.
Small Stock/Price labels (10px) and More (11px) are harder to scan, especially
when compared with the user's requested compact, clear layout.

Evidence: frontend/src/pages/app/ProductsPage.jsx:58, :243 and :338;
frontend/src/pages/app/products.css:245-267. Visually reviewed desktop/mobile.

Recommendation: update copy to describe the actual controls, use a compact photo
action near the existing image, and tune sparse groups without making dense
groups cramped. Do not promise a single-screen form for arbitrarily many colors.

## What passed

- Dedicated details navigation/reload and exclusion of catalog filters.
- Compact basic creation across all five tested viewports, without horizontal
  overflow in the covered fixtures.
- Keyboard/focus behavior of the mobile filters and confirmation dialogs.
- Existing image selection, upload/removal and retry flows in fixtures.
- OWNER/WAREHOUSE sensitive-field boundaries in covered route/service tests.
- Tenant-scoped product/variant operations in covered backend tests.
- Atomic stock movement and update, zero-stock protection, same-page safe replay,
  opposite-direction key conflict and pending-cost initialization after correction.
- Soft deactivation preserves historical records.

## Validation and limits

- Client unit tests: 228 passed, 42 suites.
- Product/restock/image backend tests: 50 passed, 14 suites; TypeScript test
  compilation passed.
- Existing offline browser tests: 16 passed.
- Three additional temporary audit browser probes passed, confirming the
  reload-retry, missing bulk-price/unsaved-edit, and ordering/null-price findings.
- Two direct helper probes confirmed combination duplicates and inactive totals.
- Temporary probe script was removed; only this report was added by the audit.
- No live authenticated mutations, R2 upload, production load test, real PostgreSQL
  race test, or network latency guarantee was performed.
- Assumption: latest screenshots/user feedback target the existing Products
  experience; audit does not authorize a broad architecture or accounting change.

Suggested order: resolve sale readiness and persistent stock recovery first;
then common pricing, combination validation and draft protection; then catalog
summaries/performance and compact visual/copy improvements.
