# Inventory — responsibilities, behavior and structure audit

Date: 2026-09-29. Audit only. Current files after feature colocation.

Evidence: Inventory page/components/flows, related product cost helper, backend inventory/restock routes and service review, current frontend styles, and 18 focused frontend tests. Findings identified through source review unless explicitly called a test result. No new browser reproduction, screenshot/contrast review, live mutation, load measurement or database concurrency test. No application changes were made.

## Verdict

Inventory has a useful and mostly coherent purpose: inspect physical stock per sellable variant, receive purchased stock, initialize missing current purchase cost, trace movements and identify ledger discrepancies. Its file division is reasonable after feature colocation. The main weaknesses are lost Restock recovery after remount, coupling between independent section filters and catalog pagination, and dense identity/layout presentation. It does not need a new architecture or a rewritten stock engine.

## What is inside, what each part does, and why

| Part | Current behavior | Purpose |
| --- | --- | --- |
| Header: Stock control / Inventory | Describes variant stock and Restock | Explain that stock belongs to color/size options, not a single model-wide quantity. |
| Product search | Explicit submit, search by name/SKU/barcode; Reset clears search and returns to page 1 | Locate the stock unit before changing it. |
| Current stock list | Paginated products, all statuses; product image/name/category/status, every variant's SKU/color/size/status/current stock | Operational view of physical stock, including inactive records. |
| Refresh stock | Reloads the catalog page | Retrieve current server quantities after other operations. |
| Last purchase cost | OWNER-only display; four-decimal currency formatting; null shown unavailable | Show the current reference purchase cost, not an average cost or a complete financial valuation. |
| Set cost | OWNER, active product/variant, unknown current cost; requires positive cost, up to four decimals | Define current purchase cost without receiving another piece. Historical sale costs and quantity remain unchanged. |
| Restock dialog | OWNER, active product/variant; quantity 1–1,000,000, positive unit purchase cost up to four decimals, optional note up to 500 characters | Receive actual new stock and record its inventory movement. |
| Movement history | Separate product/variant/type/time filters; newest-first cursor pagination; signed quantities, performer and timestamp; OWNER-only cost/note | Explain how the quantity changed and who performed each movement. |
| Stock reconciliation | Separate product/variant/status filters; stored quantity versus sum of ledger movements, difference and match/mismatch | Detect inconsistency without silently repairing data. |

Example: Black/M has 1 opening piece and no cost. **Set cost $8** leaves quantity 1. Receiving 10 additional pieces at $9 uses **Restock 10 / $9**, resulting in 11 pieces and a new RESTOCK movement. A sale decreases stock through the sales endpoint and appears in history. Reconciliation compares stored stock with the complete recorded quantity ledger; it is not a warehouse physical-count form.

The page does not currently provide direct quantity editing, quick +/- controls, a dedicated damage entry action, automatic mismatch repair, low-stock alerts or a total inventory-value report. DAMAGE/ADJUSTMENT appearing as history filters does not mean this page can create those movements. Products' quick-stock controls are a separate workflow.

## How it is divided

```text
frontend/src/
  pages/app/InventoryPage.jsx             route composition + catalog loading
                                          local OpeningCostForm
  features/inventory/
    RestockDialog.jsx                    restock draft, modal and submission UI
    restock-flow.js                      permissions, validation, API, retry identity
    restock-flow.test.js                 focused contract/workflow tests
    InventoryAuditSections.jsx           InventoryHistory + InventoryReconciliation
                                          shared local ProductVariantFilters
    inventory-audit-flow.js              audit API, visibility, labels and pagination
    inventory-audit-flow.test.js         history/reconciliation contract tests
  features/products/product-flow.js       product reads + missing-cost API helper
  lib/supabase.js, api-client.js, money.js  shared auth client/transport/formatting
  index.css                              current inventory/restock/audit styles
```

InventoryPage is about 96 lines and composes independent sections. It is not currently a large mixed controller like ProductsPage. RestockDialog is about 99 lines and keeps its workflow instance local. InventoryAuditSections is about 141 lines with two related sections; keeping them together is reasonable for now. OpeningCostForm is about 25 lines and used only here; extraction is useful if cost initialization gains more coordination, not to meet a line threshold.

Domain flows contain no React hooks. UI invokes flows; flows invoke authenticated transport; backend owns stock changes. Importing product reads/cost helpers from the Products feature is a legitimate domain dependency. Shared UI does not need to absorb inventory rules.

## Network and ownership

| Action | Backend request |
| --- | --- |
| Load current inventory | Product list GET with search/page and `isActive=all` |
| Set missing current cost | PUT `/api/products/:productId/variants/:variantId/opening-cost` |
| Restock | POST `/api/products/:productId/variants/:variantId/restocks`, including original Idempotency-Key |
| History | GET `/api/inventory/movements` with approved filters/cursor |
| Reconciliation | GET `/api/inventory/reconciliation` with approved filters/cursor |

Backend routes protect restock and cost initialization with OWNER authorization. Inventory reads require authenticated tenant access; movement output omits unitCost/note for WAREHOUSE. The inspected service scopes queries and ownership checks by the resolved account. Restock locks product then variant, validates active state/overflow, updates quantity/current cost and creates the movement in a transaction. These are source-reviewed safeguards, not a fresh live concurrency/security certification.

Costs use decimal strings in the frontend and Decimal on the backend. The page formats cost and never computes historical profit. Unknown purchase cost and permission to sell are separate concepts; entering cost now must not rewrite previous sales.

## Findings, in priority order

### 1. P1 — Uncertain Restock recovery is lost on reload/navigation

The workflow retains its frozen payload/key only inside the mounted dialog. Close/Escape are disabled when uncertain, which protects ordinary closing, but there is no durable recovery storage or navigation/unload guard here. Reload or app navigation discards that instance. If the server committed but the response was lost, a later intended retry can use a new key and become a second Restock.

Evidence: `RestockDialog.jsx` workflow useState/uncertain handling; `restock-flow.js` local `attempt` and key creation. This is a conditional source-established recovery risk, not a newly browser-reproduced duplicate. Same-dialog original-key replay passes tests.

Recommendation: preserve unresolved Restock intent with tenant/user/product/variant context and an explicit recovery action, or enforce a clearly defined recovery protocol across navigation. Reuse the original frozen request before offering a new operation. Do not copy the quick-stock protocol blindly; Restock has quantity/cost/note semantics.

### 2. P2 — Refresh/search/pagination reset audit work

InventoryHistory and InventoryReconciliation keys include catalog `version`, page and search. Refresh stock, a successful Set cost/Restock, search or catalog pagination remounts both sections. Their selected filters, loaded cursor pages and errors reset. Refresh stock also triggers two audit reloads even when the user only needs the catalog refreshed.

Evidence: `InventoryPage.jsx` keyed audit-section rendering and `refresh`/`changeFilters` handlers.

Recommendation: keep audit instances stable; refresh their results through explicit resource signals while preserving filters. Define whether each refresh applies to stock, history, reconciliation or all three. A single operation can refresh relevant data without discarding the user's investigation.

### 3. P2 — Audit product choices are limited to the catalog page

ProductVariantFilters receives only `state.products` from the current paginated/search-filtered catalog. History/reconciliation initially request all tenant results, but the selectable product list contains only the visible catalog page. The scope mismatch makes other products difficult to target without changing the top search/page, which then resets audit filters.

Evidence: `InventoryPage.jsx` products props; `InventoryAuditSections.jsx` ProductVariantFilters.

Recommendation: give audit filters an independent searchable product/variant selector with bounded results, or explicitly design a selected-product investigation view. Do not fetch every product and every option indefinitely just to populate a dropdown.

### 4. P2 — Unsaved cost input can disappear

OpeningCostForm owns its draft locally and does not use shared dirty-state protection. Catalog refresh/search/page changes replace its rendered parent subtree, losing the input; app navigation/reload also has no guard for this form. Its Cancel hides the form while preserving local cost/error, which is a separate behavior that should be intentional.

Recommendation: warn or preserve meaningful unsaved cost changes, and specify Cancel/reset behavior. Keep mutation-pending safety separate from draft-dirty checks.

### 5. P2 — Header copy does not describe all stock-change sources

“Stock changes are recorded through Restock, not direct edits” is understandable locally, but stock also changes through sales, returns, voids, exchanges, opening stock and Products quick adjustments. Set cost changes cost without quantity. The history already reflects these distinctions.

Suggested copy: **“Review stock by color and size. Receive new stock with Restock, set missing purchase costs, and trace changes in movement history.”** Follow with “Stock quantities are read-only here.”

### 6. P2 — Current grid does not accommodate all optional actions cleanly

The desktop `.inventory-variant` grid defines four columns. A pending-cost OWNER row can render five children: identity, stock, cost, Set cost and Restock. The extra child must create another grid row; opening the inline cost form adds more content. Mobile uses one column and can become tall. SKU is the strongest identity even though the user normally recognizes color/size.

Evidence: `InventoryPage.jsx` conditional children; `index.css` inventory grid rules around lines 697 and 754. These are source/layout observations, not newly rendered screenshot measurements.

Recommendation: one identity area led by color/size with SKU secondary, one quantity/cost area, one explicit actions area. Keep optional cost form expansion inside a defined row. Put Stock / History / Reconciliation into clear sections or tabs if actual usage supports it; avoid hiding discrepancy warnings without a visible indicator.

### 7. P3 — Image failure states lag behind Products

Inventory renders raw imageUrl or No image, with no image onError fallback and no distinction for an attached photo whose signing is unavailable. It can label an unavailable photo as absent or show a broken image after URL expiry.

Recommendation: share a focused image-state component once attachment/availability semantics are defined; preserve alt text and private-key boundaries.

### 8. P3 — Request lifetime and validation consistency need hardening

Initial effects use active/epoch guards, but handler-launched Load more does not invalidate its generation on unmount; completion may still execute redirects/state setters. This is a source-identified lifetime concern, not a reproduced cross-page corruption. Audit response checks validate selected fields but render nested product/performer fields not fully checked. Missing currency shows a warning while cost entry still remains available.

Recommendation: test late pagination responses, malformed nested shapes, and missing-currency cost entry. Adopt a small lifetime contract and field validation for rendered data. Decide whether cost submission should be blocked until its authoritative currency is available.

## What is good and should remain

- Stock per variant, not a product-wide quantity.
- Read-only inspection separated from deliberate Restock and Set cost actions.
- OWNER cost/restock UX and backend role protection; WAREHOUSE-safe movement projection.
- Exact cost representation, meaningful validation limits and safe API errors.
- Original-key same-dialog retry and workflow double-submit guard.
- Signed history quantities, cursor loading, local-time filter explanation.
- Reconciliation labels shown results and never repairs automatically.
- Focus trapping/scroll restoration in the Restock dialog, with deliberate uncertain-state closing restrictions.
- Small page composer and feature-local React-free flows; no new router/state library needed.

## Recommended ownership and improvement order

1. Protect unresolved Restock recovery across reload/navigation.
2. Decouple audit filters/lifecycle from catalog pagination; preserve investigations on refresh.
3. Protect unsaved cost drafts and clarify operation/currency behavior.
4. Make variant identity/actions compact and update header wording.
5. Improve image states, request-lifetime coverage and later CSS ownership.

Keep InventoryPage as a route composer. Inventory feature owns receiving, current-cost initialization UI and ledger inspection; Products supplies shared catalog access; backend remains the only stock/accounting authority. No broad file decomposition is necessary yet. A future `OpeningCostForm.jsx` or separate history/reconciliation files should follow independent complexity or reuse, not folder symmetry.

## Validation and unchanged scope

Ran `node --test frontend/src/features/inventory/restock-flow.test.js frontend/src/features/inventory/inventory-audit-flow.test.js`: **18 tests passed, 3 suites, 0 failed**. They cover validation, role visibility, safe payload/filter construction, same-workflow retry, double-submit guard, rate-limit errors and reconciliation presentation. They do not cover the new React remount/draft/layout findings described above.

No source, styling, backend, schema, migration, business data or protected PDF changed. Only this audit report was added. No deployment or commit was performed. Existing behavior was audited, not fixed.
