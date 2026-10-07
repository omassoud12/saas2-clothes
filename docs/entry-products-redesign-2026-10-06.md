# Entry and Products redesign — 2026-10-06

STATUS: PASS

## Audit

Before this task, Inventory combined new-product definition, zero-stock saving,
initial receiving, existing-product receiving, a secondary legacy restock tool,
opening-cost support, receipt history, movement history and reconciliation.
Products provided the summary catalog, standalone details, catalog edits,
selling prices, images/status and one-piece stock correction controls.

The overlap was operational: existing stock work appeared in both areas, and
Products sent staff to Inventory for receiving. The canonical product-setup
and receipt contracts already existed; they did not need a second creation or
receiving implementation. The old responsibility description in ARCHITECTURE.md
was reported before implementation. The user's subsequent approval authorized
updating that frontend responsibility model. Database architecture is unchanged.

Existing routes remain:

- `/app/inventory`: Entry / Product Entry, including old `?new=1` bookmarks.
- `/app/products`: summary catalog.
- `/app/products/:productId`: product management. The optional `section` query
  selects Stock, Restock, Movement History, Count Check or Receipt History.
- Old `/app/inventory?productId=...` links redirect to the product's Restock
  section. WAREHOUSE continues to have no Restock capability.

Existing API contracts reused:

- `POST /api/inventory/product-setups`: canonical idempotent definition, with
  optional OWNER initial receipt.
- `POST /api/inventory/receipts`: existing-product purchased receiving.
- `GET /api/inventory/receipts/by-operation/:operationId`: read-only receipt
  recovery lookup where supported by the existing operation.
- `GET /api/inventory/receipts?page=...`: separate store-wide receipt history.
- `GET /api/inventory/movements` and `/api/inventory/reconciliation`: product-
  scoped, read-only audit sections.
- Existing product/variant catalog, image, status, bulk-price and opening-cost
  endpoints.
- `POST /api/products/:productId/variants/:variantId/stock-adjustment`: confirmed
  OWNER +1 / -1 physical corrections with the original durable operation UUID.

## New information architecture

### Entry

Entry immediately opens a new-product form. It owns details, existing category
selection/creation navigation, colors/sizes, OWNER selling prices, optional
image, review and save. OWNER may save with zero stock or receive an initial
delivery with authorized purchase costs. WAREHOUSE saves definitions with zero
stock and sends no purchase-cost, receipt or editable selling-price fields.

Entry has no existing-product editing, repricing, restocking, count correction,
movement-history management or deletion controls. An unresolved existing-product
receipt provides a handoff to Products, rather than an Entry restock action.
After creation, the next actions are View Product and Add Another Product.

### Products

Products starts with summary cards, existing search/category/status filters and
pagination. Its Add Product action opens canonical Entry. Cards communicate
image, category, variant count, active stock, inactive stock, price range and
status, and their semantic open button covers the card.

Product details use compact section navigation:

- Overview: existing identity, options, selling-price, image and status controls.
- Stock: current quantities/prices; OWNER current purchase-cost inspection and
  existing opening-cost support.
- Restock (OWNER): variant quantities, authorized Decimal cost, review and one
  receipt confirmation through the shared StockReceiptForm.
- Movement History: read-only product-scoped stock events, signed quantities,
  existing type/date/variant filters, context and actor where supplied.
- Count Check: system stock, OWNER confirmed one-piece corrections, existing
  retry recovery and separate read-only reconciliation.
- Receipt History: separate read-only purchased-delivery records; clearly
  identified as store-wide because the current API has no product filter.

Restock records purchases through StockReceipt/RESTOCK semantics. Count Check
uses ADJUSTMENT, creates no receipt and offers no arbitrary stock overwrite.
WAREHOUSE can inspect permitted operational data, but sees no purchase costs,
receiving controls or correction controls.

## Implemented

- Sidebar shows Products followed by Entry with an intake icon.
- One canonical creation form and shared receipt form/recovery orchestration.
- Durable receipt payloads/keys, browser locks, cross-tab synchronization,
  uncertain-response recovery, and photo-only retry remain intact.
- Creation and restock success states provide useful next actions. Errors use
  existing safe messages and preserved recovery data, rather than raw exceptions.
- Catalog and receipt drafts survive detail-section changes. Cancelling browser
  Back preserves the draft without a second discard prompt.
- Mobile Entry is one column; mobile receiving groups colors with size/quantity
  inputs. Desktop retains the contained keyboard-friendly quantity matrix.
- Wrapped section buttons, approximately 44px controls, semantic regions,
  labels, focus states, native confirmation dialogs, existing filter focus trap,
  sign/text semantics and hidden inactive panels preserve accessibility.
- At 768px stock inspection stacks into suitable columns; desktop Entry has a
  readable centered working area. Receipt actions stay in normal flow to avoid
  overlapping cost controls. Long option labels wrap safely.
- Products retains summary-only initial loading. Entry fetches categories, not
  an existing-product list. Audit sections mount/load on demand; visits reuse
  existing cache/dedupe behavior. Safe GETs use AbortController. Mutations retain
  their original explicit recovery and are not blindly cancelled/deduplicated.
- Confirmed receiving/corrections refresh authoritative stock and audit data.

## Business logic and safety

- Backend behavior changed: NO.
- Database/schema changed: NO.
- Permission semantics changed: NO.
- Tenant isolation changed: NO.
- Financial/cost, stock accounting, idempotency, historical sale costs,
  unknown-cost semantics and Account currency contracts changed: NO.

All browser mutations in these tests terminate in an offline fixture. The
fixture disables env loading, substitutes authentication and intercepts API
requests; external service requests are blocked. It performs no real database,
Supabase Auth or R2 writes. No production secrets are included in this report.

## Tests

| Check | Result |
| --- | --- |
| `npm.cmd test --workspace client` | PASS, 287 tests |
| `node --test scripts/products-ui.test.mjs` | PASS, 81 regression cases |
| `node --test scripts/entry-products-ui.test.mjs` | PASS, 17 acceptance cases |
| `npm.cmd run lint --workspace client` | PASS |
| `npm.cmd run build --workspace client` | PASS |
| `git diff --check` | PASS |

Browser coverage includes 390/768/1280/1440 layouts, populated OWNER/WAREHOUSE
audit records, lazy requests, readonly histories, search/pagination, allowed
edits, zero-stock and initial receiving, invalid inputs, exact Decimal costs,
receipt/count request semantics, replay after reload, two-tab recovery, image
retry, section drafts, browser Back, legacy receiving links, focus and overflow.
Screenshots were also visually inspected. Playwright uses the existing external
QA installation; no application dependency was added.

One concurrent verification round experienced an approximately nine-minute
execution stall and timed out its first case in each browser suite. Both cases
passed isolated reruns; clean complete suite reruns also passed. This was not
treated as an application failure or concealed by changing test assertions.

Backend tests were not rerun for this redesign because it edits no backend
files. Existing unrelated backend/auth/performance edits were preserved.

## Files changed for this task

1. `ARCHITECTURE.md` — authorized frontend responsibility documentation.
2. `frontend/src/App.jsx` — cancelled Back event propagation fix.
3. `frontend/src/app/AppSidebar.jsx` — Entry icon.
4. `frontend/src/app/app-navigation.js` — Entry label/order.
5. `frontend/src/app/app-flow.test.js` — Entry navigation coverage.
6. `frontend/src/pages/app/InventoryPage.jsx` — focused Entry and old-link redirect.
7. `frontend/src/pages/app/ProductsPage.jsx` — detail sections and integrated stock workflows.
8. `frontend/src/features/products/ProductStockSections.jsx` — Stock/Count Check panels.
9. `frontend/src/features/products/OpeningCostForm.jsx` — reused opening-cost form.
10. `frontend/src/features/inventory/ProductRestock.jsx` — existing-product receiving workspace.
11. `frontend/src/features/inventory/useReceiptRecovery.js` — shared receipt recovery.
12. `frontend/src/features/inventory/InventoryAuditSections.jsx` — product-scoped audit UI.
13. `frontend/src/features/inventory/ReceiptHistory.jsx` — separate store-wide history copy.
14. `frontend/src/features/inventory/ReceiptPresentation.jsx` — review/recovery presentation.
15. `frontend/src/features/inventory/StockReceiptForm.jsx` — role/safe-error/review presentation.
16. `frontend/src/features/inventory/VariantQuantityMatrix.jsx` — mobile quantity entry.
17. `frontend/src/features/products/CatalogConfirmation.jsx` — physical correction confirmation.
18. `frontend/src/features/products/ProductComponents.jsx` — card interaction/summary and option copy.
19. `frontend/src/features/products/ProductCreateForm.jsx` — Entry sections and prevalidation.
20. `frontend/src/features/products/product-workspace.css` — scoped responsive styles.
21. `scripts/products-ui-fixture.mjs` — shared offline browser fixture.
22. `scripts/products-ui.test.mjs` — preserved/adapted existing regression cases.
23. `scripts/entry-products-ui.test.mjs` — focused redesign acceptance tests.
24. `docs/entry-products-redesign-2026-10-06.md` — this completion report.

This list describes this task's edits, not every pre-existing uncommitted change
in the shared workspace. In files containing prior work, those edits remain.

## Unchanged

Prisma schema, migration files, database data, database topology, Railway,
Supabase infrastructure, R2 infrastructure and
`planing/SaaS2_Clothes_Implementation_Summary.pdf` were untouched. No migration,
deployment or commit was performed.

## Remaining limitations and assumptions

- Receipt History remains store-wide. Adding product-scoped receipts would need
  a separately authorized backend/API change; the UI does not imply that the
  current endpoint filters them.
- Browser integration checks use synthetic API/auth/image responses. Live
  Supabase/R2 receiving was not exercised because production writes were outside
  the authorized scope.
- The existing `/app/inventory` URL is intentionally retained for compatibility;
  Entry is its visible responsibility and title.
- The existing supported catalog/status/category/search contracts and role
  capabilities were reused without adding unsupported filter or stock behavior.
