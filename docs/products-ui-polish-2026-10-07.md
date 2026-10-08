# Products UI polish — 2026-10-07

STATUS: PASS

Scope: local Products presentation, keyboard interaction and regression tests. Read AGENTS.md, ARCHITECTURE.md, the Prisma schema and the existing feature implementation before changing code. ARCHITECTURE.md's current JavaScript/JSX frontend and existing Products/Entry responsibilities were retained. No architecture change was made.

## Audit

- Catalog filters and detached refresh text outweighed the product list; action and image treatment needed clearer hierarchy.
- Generic detail text and repeated product title/status/actions diluted product context.
- Heavy navigation lacked tab semantics and compact mobile scrolling.
- Variants repeated Edit, More, status and inactive-zero information at equal visual weight.
- Count Check's flexible action sizing could clip the plus control. Repeated Active labels and wide rows distracted from physical counting.
- Restock's product heading, matrix, stepper and cost summary needed consistent visual treatment. Operational copy exposed unnecessary technical terminology.
- Loading used small text/spinners rather than the existing skeleton primitive.

## Implemented

### Product catalog

- Strong Products title, small uppercase eyebrow, secondary subtitle and one primary `+ Add Product` header action. Add Product continues to open canonical Entry.
- Compact labelled search/category/status controls; search gets priority. Apply/Clear retain the existing explicit filtering behavior and mobile filter sheet.
- Compact icon + Refresh action beside the product count.
- Aligned desktop columns; readable stock and selling prices; semantic Active/Inactive labels. Medium layouts use compact rows, mobile uses cards.
- Neutral 56px thumbnails with rounded corners, cover cropping and a shirt placeholder. Existing image loading/upload/removal contracts are unchanged.
- View Product has a bordered action and arrow. The existing whole-card semantic button remains operable.

### Product details

- Compact Products back action and persistent product name/category/variant count/status header across sections.
- Secondary Edit Product action opens Overview's existing edit form, including existing draft protection.
- Product deactivation/reactivation moved into an accessible overflow menu; confirmation and busy restrictions are preserved.
- Compact neutral tabs in the order Overview, Stock, Restock, Count Check, Movements, Receipts. Restock remains OWNER-only.
- Visible history labels changed; existing `section=movements`, `section=receipts` and other query semantics remain compatible.

### Overview and variants

- Product photo and catalog attributes replace duplicated title/status/action groups. Compact Add Photo/Change Photo retains the existing upload flow.
- Color headers show size count and available stock; inactive pieces appear only when meaningful.
- Size, labelled stock, selling price and a subtle textual readiness badge form one row. A single labelled menu exposes only the existing Edit Variant and activate/deactivate actions, with SKU context.
- Wide desktops can show multiple color groups in two columns; narrow screens keep stacked rows. The existing dense-layout height assertions still pass with 44px menus.
- Add Color / Size is secondary; Apply Price is quieter. Existing pricing forms and permission guards remain.

### Stock

- Denser aligned inspection rows, with a two-column responsive layout on smaller screens.
- System quantities, selling prices and OWNER current purchase cost remain separate. WAREHOUSE never renders purchase-cost controls. Unknown cost remains unknown, including existing opening-cost support.

### Restock

- Short operational copy: record purchased stock; use Count Check for physical corrections.
- Static product context shows variant count and current physical stock, with no editable-input styling. Physical stock includes all existing variants; it is not relabelled as sellable stock.
- Compact existing stepper with current/completed states.
- Desktop matrix has compact 64px quantity inputs and current stock; wide matrices retain contained keyboard scrolling. Mobile retains grouped two-column quantity fields.
- Delivery summary shows quantities, unit cost and total from the existing exact `buildReceipt`/money helpers. No new financial arithmetic or rounding rule was introduced.
- Review visibly says Confirm Restock. Entry's existing receiving copy and behavior remain unchanged.
- Submission, frozen payloads, operation UUIDs, uncertainty/replay, dirty forms and image recovery were not changed.

### Count Check

- Compact size/system-stock/action columns. Explicit 96px action group contains two 44px controls, with no shrinking.
- Plus/minus bounds tested against their row, panel and viewport at all required widths, plus an intentionally narrow 260px panel.
- Removed repeated Active labels; meaningful Inactive labels remain.
- Clear compare-and-correct copy with secondary movement-history guidance.
- Existing confirmation, OWNER gating, zero-stock minus disabling, one-piece ADJUSTMENT and recovery remain intact. No direct stock overwrite was introduced.

### History

- Movements remain a read-only audit view with signed quantities, existing event/date/variant/actor/context details, filtering and pagination.
- Receipts remain a separate store-wide delivery history. Copy explicitly says “Store-wide deliveries across all products.” No product-specific receipt filtering was fabricated.
- Neutral compact cards, filters and refresh actions align with the rest of Products. Mobile remains readable without page overflow.

### Design system and states

- Products-scoped cream page, white surfaces, green primary/selected/positive states, neutral structure and textual semantic badges. No global application redesign.
- Titles/labels/body typography and restrained borders/radii follow the existing retail identity.
- Primary, secondary, ghost and contextual dangerous actions have distinct visual weight.
- Existing Skeleton is reused for catalog/detail and history/reconciliation loading, with announced status and reserved space. Restock and physical count depend on the loaded product; their existing busy/recovery states remain.
- Existing empty/no-results, safe error messages and actionable recovery states remain.

## Responsive and visual QA

| Width | Result |
| --- | --- |
| 1440 | PASS — aligned catalog, desktop matrix, compact detail tabs and multi-color groups |
| 1280 | PASS — compact catalog rows, detail sections and contained receiving matrix |
| 768 | PASS — tablet header, readable rows and section navigation |
| 390 | PASS — mobile cards, scrolling tabs, grouped receiving and complete count controls |

Screenshots were generated by the offline suites and visually inspected across these widths, including catalog, Overview, Restock, Count Check and dense color groups. Existing acceptance screenshots cover all sections and receiving review. Temporary QA artifacts are under `%TEMP%/saas2-products-qa/screenshots`; they are not production images.

## Accessibility

- Semantic labelled buttons; icon-only menus have accessible names and expanded state.
- Menus support arrows, Home/End, Escape, Tab/Shift+Tab, repeated trigger activation and focus restoration. Existing confirmation focus behavior is covered by regressions.
- Tabs use tablist/tab/tabpanel semantics and roving selected tab stops. Arrow/Home/End moves focus; Enter/Space activates. Moving focus alone does not request history data.
- Active mobile tabs scroll into view without page-level overflow.
- Visible green focus outlines, labelled inputs, native disabled controls and 44px operational tap targets.
- Status always includes text. Reviewed color pairs have normal-text contrast ratios of 4.71:1–6.42:1. This is a targeted contrast/keyboard review, not a formal full-app accessibility certification.
- Skeleton animation and button transitions respect reduced motion.

## Performance

- Initial catalog remains summary-only; no inventory/history requests on initial detail display.
- Histories and reconciliation load only when their section opens. Existing loaded-state reuse, cache/dedupe and safe GET cancellation remain.
- Draft-bearing sections stay mounted after being visited.
- No mutation cancellation/deduplication changes, dependency additions or request-per-render effects were introduced.

## Tests

| Check | Result |
| --- | --- |
| `npm.cmd test --workspace client` | PASS — 289 tests |
| `node --test scripts/products-ui.test.mjs scripts/entry-products-ui.test.mjs` | PASS — 81 Products regressions + 17 acceptance tests |
| `node --test scripts/products-polish-ui.test.mjs` | PASS — 12 focused polish tests |
| `npm.cmd run lint --workspace client` | PASS |
| `npm.cmd run build --workspace client` | PASS |
| `git diff --check` | PASS |
| SHA-256 comparison of 128 protected files | PASS — no changes |

All browser API/auth requests use offline fixtures; external services are blocked. Fixture mutations verify contracts and recovery without contacting or modifying a database. Existing tests retained their business assertions. Only presentation-specific selectors, title sizes and matrix-fit expectations changed; dense-layout height limits were retained.

## Files changed

- `frontend/src/pages/app/ProductsPage.jsx`
- `frontend/src/features/products/ProductComponents.jsx`
- `frontend/src/features/products/ProductStockSections.jsx`
- `frontend/src/features/products/ProductActionsMenu.jsx` — new
- `frontend/src/features/products/ProductNavigation.jsx` — new
- `frontend/src/features/products/ProductLoading.jsx` — new
- `frontend/src/features/products/product-polish.css` — new
- `frontend/src/features/inventory/ProductRestock.jsx`
- `frontend/src/features/inventory/StockReceiptForm.jsx`
- `frontend/src/features/inventory/InventoryAuditSections.jsx`
- `frontend/src/features/inventory/ReceiptHistory.jsx`
- `scripts/products-ui.test.mjs`
- `scripts/entry-products-ui.test.mjs`
- `scripts/products-polish-ui.test.mjs` — new
- `docs/products-ui-polish-2026-10-07.md` — this report

## Business logic and protected scope

- Backend business logic/API contracts changed: NO.
- Database/data/schema/migrations changed or executed: NO.
- Tenant isolation or OWNER/WAREHOUSE permissions changed: NO.
- Stock accounting, financial semantics, receipt/restock/idempotency/recovery logic changed: NO.
- Sale/return/void/exchange behavior or historical costs changed: NO.
- Railway, Supabase infrastructure or R2 infrastructure modified: NO.
- Architecture or protected PDF modified: NO; their hashes match the task-start baseline.
- Secrets exposed, deployment performed or commit created: NO.

## Remaining limitations and assumptions

- Receipts remain store-wide because the current endpoint supports page-based pagination only.
- There is no existing low-stock threshold in product readiness. Amber styling is used for existing readiness warnings; no new quantity threshold or Low stock business state was invented.
- Live Supabase/API/R2 integrations were not exercised; verification is local and offline to respect the prohibition on database/infrastructure changes.
- The existing JS/JSX frontend, account currency, product/variant grouping and canonical Entry workflow were preserved as specified by ARCHITECTURE.md.
