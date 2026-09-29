# Products UI/UX refactor review

The current working-tree Products behavior was the baseline. This refactor changes presentation, layout and accessibility, not API contracts or business rules.

## Design and interaction review

1. **Problems found:** oversized catalog images/headings; split catalog/detail columns with limited scanning space; scattered toolbar controls; a long create form; visible identifier clutter; mixed field heights, border radii and shadows. Mobile inherited an off-screen sidebar shadow.
2. **Header:** compact 28px/700 desktop title, 24px mobile title, brief supporting copy and one Add product CTA. Existing WAREHOUSE creation access is preserved: ARCHITECTURE.md explicitly authorizes it. The brief's phrase “no unauthorized create action” does not override those permissions.
3. **Search and filters:** a single desktop toolbar, larger search allocation, narrower category/status selectors. Tablet uses two rows. Mobile shows a full-width search and Filters/Search controls; category/status remain inside the existing accessible sheet. Search submission and filter application semantics are unchanged.
4. **Desktop catalog:** structured, full-width rows with product identity, category, variant count, stock, exact formatted selling price, status and View/Edit. Rows are approximately 72px for ordinary content, with natural growth for longer names/prices. Thumbnails are 48px.
5. **Mobile catalog:** dedicated compact cards with 52px thumbnails, category, price/status, variant/stock counts and visible View/Edit. No compressed desktop table or horizontal scrolling.
6. **Tablet:** at 768px the sidebar collapses and the catalog retains an appropriately sized row layout. At 1024px the open sidebar leaves less room, so catalog rows intentionally use two lines. Fields remain comfortable rather than being forced into narrow table cells.
7. **Create/edit forms:** create form capped at 1000px. Name/category share a desktop row; price and optional photo form a second row; color selection and per-color sizes have distinct areas. All form fields stack below 701px. Edit forms retain existing inputs and data handling. DOM order matches visual pricing/photo order.
8. **Control sizing:** desktop inputs/selects 42px; mobile 46px. Buttons generally 42px desktop and at least 44px mobile; pagination 40px desktop/44px mobile; size selectors 40px desktop/44px mobile. Inputs use 12px horizontal padding and existing 8px radius token. File inputs size naturally with a compact native chooser.
9. **Variants:** clear color/size identity, read-only stock, authorized price/cost values, lighter actions. SKU/barcode remain available behind a disclosure. Create-form size identifiers are grouped under an optional disclosure. Variant editing focuses the color field and stacks on mobile.
10. **Images:** preview 112px desktop/96px mobile; detail hero 104px/88px. Existing choose, preview, upload, replace and remove behaviors retained. No new image requests, transformation or storage behavior.
11. **Palette/tokens:** Products uses existing primary, surface, border, text, success and danger variables. Primary remains green; danger is reserved for destructive actions. No new global palette or UI library.
12. **Typography/spacing:** 28/24px page titles, 18px sections, 14px body, 13px labels, 12px metadata. Main spacing uses 8/12/16/20/24/32px. Products content padding is 32px horizontal desktop, 24px tablet and 16px mobile.
13. **Empty states:** “No products yet” is distinct from “No matching products.” Existing authorized creation CTA and filter/search handling are preserved.
14. **Accessibility:** explicit labels, product-row accessible descriptions, visible selected state, form error association, edit focus, detail focus/scroll after loading and return-to-catalog focus. Existing mobile sheet retains focus trap, restoration, Escape and scroll locking; resizing to desktop closes it. Native confirmation dialog retains focus management/Escape and now also locks background scrolling. No additional modal system.

## Responsive visual review

All five viewports were rendered in headless Chrome with the actual AppLayout and Products components, synthetic data, mocked Supabase session reads and intercepted API responses. External application network calls were blocked. Screenshots were visually reviewed in addition to DOM overflow and sizing assertions.

15. **390x844:** no horizontal overflow; 24px title; full-width search; compact filter sheet; readable 200px-class product cards; 46px single-column fields; stacked variants; confirmation fits viewport. Hidden sidebar shadow fixed only on Products.
16. **768x1024:** toolbar uses two rows; product rows fit; create form's two columns remain approximately 300px each; size buttons wrap naturally; image upload is compact.
17. **1366x768:** one-row toolbar, approximately 72px catalog rows, clear column alignment; focused detail/edit workflow and bounded create form.
18. **1440x900:** page is bounded rather than stretched; create form is capped at 1000px, with product fields, image and colors/sizes grouped intentionally. The 1024x768 intermediate width was also reviewed and tested with the visible sidebar.

## Files and validation

19. **Files changed by this refactor:**
   - `frontend/src/pages/app/ProductsPage.jsx`
   - `frontend/src/pages/app/products.css` (new, Products-scoped styling)
   - `frontend/src/app/ProductCreateForm.jsx` (markup/classes only relative to incoming working baseline)
   - `frontend/src/app/CatalogConfirmation.jsx` (background scroll locking)
   - `scripts/products-ui.test.mjs` (new offline browser verification)
   - `docs/products-ui-review.md` (this report)

   Pre-existing, uncommitted Products work also includes `frontend/package.json`, `frontend/src/index.css`, `frontend/src/app/product-flow.js`, `frontend/src/app/product-setup-flow.js` and its tests. Those business-flow files and global styling were not changed by this refactor. The two existing JSX components were themselves untracked before this task.
20. **Focused tests:** 38 passing Product/setup/Restock tests. Browser suite: 10 passing scenarios covering all five viewports, overflow/field sizes, initial request count, search, pagination, empty states, filter focus/Escape, OWNER edit/deactivation, WAREHOUSE privacy/payloads, create and optional image preview/remove/upload/replace/delete.
21. **Complete frontend tests:** 226 passed, 42 suites. Together with the separate browser suite: 236 tests. Focused tests are a subset of the 226, not additional to them.
22. **Other checks:** ESLint, production build, secret/private-key scan and `git diff --check` passed. No project dependency changes were introduced. Playwright was installed in a temporary QA directory only; the browser suite uses the existing Chrome installation.
23. **Backend/database:** backend, Prisma schema, migrations, database and RLS/grants untouched. No live business API, auth account or database request was used for testing.
24. **Protected PDF:** not opened, edited, moved, deleted, reverted or staged during this task.
25. **Commit:** pending scope clarification. A refactor-only commit would reference existing untracked components/workflows from earlier requested Products changes. Those pre-existing changes were not silently included in a UI-only commit.
26. **Blockers/limits:** implementation and validation are complete. Commit scope is the only pending item. Validation uses synthetic data and a desktop Chromium engine at the requested viewport sizes; it is not a claim of testing on physical iOS/Android devices or live production data.

## Reproducing the browser suite

Install Playwright into a temporary QA directory, not the application package. The runner defaults to `%TEMP%/saas2-products-qa/node_modules/playwright/index.mjs` and the existing Windows Chrome path. Override with `QA_PLAYWRIGHT_MODULE` and `QA_CHROME_PATH` if needed.

Run from the repository root:

```text
node --test scripts/products-ui.test.mjs
```

Screenshots are written to `%TEMP%/saas2-products-qa/screenshots`. The fixture disables Vite environment-file loading and replaces the Supabase module; all API calls are handled in memory.

## Compact creation follow-up

The latest request supersedes the earlier creation-form spacing: labels are now 12px, inputs 40px, and name/category share a row on mobile. Repeated headings/help text were removed; optional photo controls are collapsed. Changes: ProductCreateForm.jsx, products.css, scripts/products-ui.test.mjs, and this report. No API or stock behavior changed.

Validation: all 10 offline browser tests, lint, build, and diff whitespace checks passed. The browser suite now verifies the entire basic form (one color with sizes, optional sections closed) fits without page scrolling at all five tested viewports, including 390x844. The mobile screenshot was visually reviewed. Additional colors, expanded optional controls, validation messages, or smaller screens can naturally require scrolling; content is never clipped.

## Opening stock and deferred cost follow-up

OWNER initial creation now sends `openingStock: true` for every selected color/size. The backend creates the variant with one piece and an unknown-cost ADJUSTMENT ledger entry in one transaction, using the authenticated actor/account. Existing variants and WAREHOUSE creation keep their previous stock behavior. No migration is required.

Inventory offers Set cost for the pending piece. A new OWNER-only PUT opening-cost endpoint initializes its positive Decimal cost without adding stock or rewriting movement history. Product/Variant locks protect concurrent Restock/Sale operations. Identical cost retries are harmless; attempts to overwrite established cost conflict. The existing Sale service rejects null cost. The opening ledger retains its historically unknown cost; inventory valuation uses the established variant cost.

Files: backend products controller/routes/schemas/service/types/tests; frontend ProductCreateForm.jsx, product-flow.js, InventoryPage.jsx; offline browser runner; ARCHITECTURE.md; this report.

Checks: backend 407 tests passed, frontend 226 tests passed, all 12 browser scenarios passed (the two new scenarios were rerun after resolving an ambiguous test selector), frontend lint/build, backend typecheck, and diff whitespace. Dedicated tests cover rollback on ledger failure, tenant/role isolation, cost validation, unchanged quantities and movement history, and repeat cost requests. No live database test or deployment was performed. Assumption: each selected OWNER-created variant represents one physical piece; WAREHOUSE remains unable to add stock.

## Product edit window follow-up

Edit product now opens a native modal window above the catalog, containing the product form, color/size list, and photo controls. The catalog is inert while the editor is open. Close, Cancel, successful product save, or Escape return to details; focus returns to Edit product. The window scrolls internally and keeps its Close control visible. Nested variant confirmations and Restock remain usable; Escape on a nested confirmation does not dismiss the editor. Files: ProductsPage.jsx, products.css, browser test runner, and this report. Validation: 12 offline browser scenarios passed, with focused mobile/editor checks rerun after integrating Restock; lint/build and whitespace checks passed. Sale-with-pending-cost behavior still awaits the accounting decision from the preceding question.

## Standalone product page follow-up (current behavior)

This supersedes the edit-window behavior above. Both catalog View and Edit open the same `/app/products/:productId` page, containing product information, photo controls, colors/sizes, stock, and editing actions. The catalog/filter controls are not mounted there, and its product-list API request is skipped. Back to products and browser history return to the catalog. Direct URLs/reload load the selected product; Products remains selected in the sidebar. A product edit form opens within this dedicated page, with no editor overlay.

Files: ProductsPage.jsx, products.css, AppLayout.jsx, app-navigation.js, app-flow.test.js, scripts/products-ui.test.mjs, and this report. Checks: 227 frontend tests passed; all 13 offline browser scenarios passed, including direct reload, shared View/Edit destination, browser Back, no detail-page list requests, and five responsive viewports; lint/build and whitespace checks passed. Assumption: all color/size information is visible on the standalone page, replacing the earlier edit-only visibility request. Backend financial behavior is unchanged by this follow-up.

## Catalog action simplification

Each catalog row now has one View product button. Edit is available inside the standalone product page. Changes: ProductsPage.jsx, existing browser checks, this report. Focused browser checks cover a single catalog action, opening/reloading the dedicated page, and editing/canceling there.

## Compact color and size cards (current layout)

Variants are grouped into one card per color. Each compact row shows size, stock, price, Add stock and Edit; More expands purchase cost, SKU/barcode and deactivation controls. Color cards sit side by side when space allows; mobile rows keep explicit labels and wrap their actions. Product identity/photo/actions also share a compact desktop overview. Files: ProductsPage.jsx, products.css, browser runner, this report. Assumption: grouping by color best expresses the requested shared-card layout. Sixteen variants across two colors now occupy two cards with a combined grid height at most 520px at 1366px, versus separate full-width cards. Existing variant IDs and mutation operations remain intact. Browser screenshots were visually reviewed; lint/build and whitespace validation passed.

## One-click Add stock

The product page Add stock button now adds exactly one piece directly and updates the row from the confirmed backend response, with no form. OWNER authorization is unchanged. A dedicated tenant-scoped quick-stock endpoint locks Product then Variant and atomically increments quantity and inserts a movement. It reuses positive current cost for RESTOCK; pending cost remains null in an ADJUSTMENT. Movement UUIDs make repeats harmless, and uncertain frontend retries reuse the same UUID. Set cost now supports all reconciled pending opening/quick-add pieces without increasing stock. No migration is needed. Inventory's explicit Restock form remains available.

Files: backend product controller/routes/service/types/tests; frontend product-flow.js, ProductsPage.jsx, InventoryPage.jsx; architecture, browser runner, this report. Validation: 409 backend tests, 227 frontend tests, all 15 browser scenarios, backend typecheck, frontend lint/build and whitespace checks passed. New checks cover one-piece addition/replay, known and pending cost, deferred cost with multiple pieces, rollback, role/tenant isolation, and a lost-response retry followed by a new click. No live database/deployment validation was performed. Assumption: known-cost quick additions use the current recorded unit cost.

## Horizontal size cards

Replaced long size rows with small cards arranged across the width inside each color section. Each card keeps size, labeled stock/price, Add stock, Edit and expandable More controls together. Desktop fits five cards across at the tested 1366px viewport; narrow screens wrap cards without horizontal overflow. Files: ProductsPage.jsx, products.css, browser runner, this report. All 15 browser checks, lint/build and whitespace checks passed. Desktop screenshot was visually reviewed. Assumption: the requested horizontal layout means size cards next to one another rather than stretching every size row across the page.

## Product save performance

Confirmed code bottleneck: initial setup previously performed one product creation plus one sequential request per variant, each with authentication/tenant checks. The form now uses one POST /api/products/setup and the backend bulk-inserts variants/movements in a transaction. Eight variants require one catalog-save request rather than nine; image upload remains a separate final step. Product editing no longer loads all variants for its preliminary category check. Quick stock uses its locked variant read directly instead of immediately querying the same row again.

Files: backend products schemas/controller/routes/service/types/tests; frontend ProductCreateForm.jsx, product-flow.js, product-setup-flow.js/test; browser runner; architecture; this report. Tests cover batch transaction/ledger rollback, foreign category and WAREHOUSE field restrictions, one request for all options, image-only retry, and stock retries. Backend 411 and frontend 228 tests passed, browser scenarios and lint/build/whitespace validation passed. No real server latency benchmark was performed: request/query reductions are verified, but network/auth/database timing and hosting location may still affect speed. Backend and frontend need matching versions for the new setup endpoint.

## Quick stock database latency follow-up

Live read-only localhost probes: /api/health returned 200 in about 0.002s; first /api/ready returned 503 at its 2s database-probe timeout, then a warm probe returned 200 in about 0.326s. This demonstrates database-connection/query latency, but does not measure authenticated Add stock or identify the exact contribution from Supabase authentication.

Optimized quick stock from five sequential database statements inside its transaction to two: Product/Variant locks and replay read together, then atomic stock update plus ledger insertion in one CTE. Replay needs one statement. Parameter binding, tenant isolation, role checks, lock order, ledger invariants and rollback remain. Added response Server-Timing for separate auth and stock durations. No schema, migration, pool or auth-policy change. Files: product service/controller/routes/tests; architecture; this report. Backend 412 tests passed; focused product checks and backend typecheck/whitespace checks passed after timing diagnostics. No authenticated stock mutation was made against the real database; actual improved button latency remains unbenchmarked.


Stock correction: + adds one piece, ? removes one, disabled at zero. OWNER authorization, tenant scoping, row locks and atomic inventory history remain enforced. Optional delta preserves empty-body API compatibility. Backend coverage includes safe replay, opposite-direction key rejection, zero limit and deferred cost initialization after correction.


Product overview spacing: replaced the two equal-width columns with a content-sized, wrapping header. Photo, name, category, option count, status and actions sit together. Mobile actions wrap below the identity; the edit form still expands to usable width. No API or business behavior changed.
