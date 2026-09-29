# Products Phase 4 ? layout, color and typography

Date: 2026-09-29. Visual presentation only. Phase 3 was already complete; the user explicitly authorized proceeding to Phase 4 without another approval question.

## Changes and retained requirements

1. Retained one compact size matrix per color and local SKU/edit expansion. The dense 2-color/16-size desktop screenshot remains 1,134px tall, below the original approximately 1,470px target. No extra reduction is claimed for this phase.
2. Retained identity/Edit/Photo together, quiet destructive actions, and common pricing beside Colors & sizes. Wrapped the existing price-target list in a native disclosure showing the selected count, with a bounded scrollable list when expanded. Selection handlers and review/confirmation behavior are unchanged.
3. Retained the desktop catalog table and compact tablet/mobile cards with an explicit View product action. Existing filters still have one Apply filters submit and quiet Clear.
4. Retained amber Cost pending: Inventory, green Active/Sellable, white working surfaces and readable state names. On mobile, readiness now occupies its own line below Price/More, including when cost is already known, preventing competing placement in the same grid cell.
5. Retained Products-scoped solid focus rings and stronger input boundaries; no shared global stylesheet was changed. Raised remaining notes, file-picker text, SKU detail text and stock-recovery text to 13px. Fixed malformed decorative photo/preview glyphs using HTML entities.
6. Retained safe preset color swatches with names and a neutral custom fallback. No user-provided value is interpreted as a CSS color.

## Files touched

- frontend/src/pages/app/ProductsPage.jsx: disclosure markup and display entities only.
- frontend/src/pages/app/products.css: scoped visual refinements only.
- scripts/products-ui.test.mjs: open the new disclosure before the two existing checkbox interactions; their draft/selection assertions remain unchanged. Added one mobile presentation test.
- docs/products-phase-4.patch: isolated phase diff; excludes prior visual/behavior changes.
- docs/products-phase-4-review/: 26 before/after screenshots and linked index.

## Validation

- Frontend unit suite: 240 passed, 42 suites.
- Offline browser suite: 51 passed, 0 failed, including 390/768/1024/1366/1440 responsive, keyboard/filter/confirmation, image, stock retry/cross-tab, draft protection and Phase 3 behavior coverage.
- New mobile test verifies separate readiness/More placement, collapsed price targets, deliberate expansion, selected-count updates and no horizontal overflow.
- Controlled pre-phase-4 markup/CSS probe failed the compact-selector assertion (checkboxes were immediately visible); restored final presentation passed. The isolated CSS-only probe passed: it is not evidence of a previously reproduced overlap bug.
- Frontend ESLint and production build passed. Isolated patch reverse-check and git diff --check passed.
- Before/after catalog/create/details screenshots are provided at 1366, 1024, 768 and 390. Desktop and mobile details were inspected visually.
- Backend tests/typecheck were not repeated: no backend or behavior changes occurred in Phase 4; Phase 3 had 428 passing backend tests and a passing typecheck.

## Limits

Screenshots and browser checks use offline fixtures and blocked external API/auth network. Baseline already contained most requested visual improvements, so this phase intentionally completes remaining details instead of redoing them. No business logic, API call, role/tenant rule, model, cost/accounting, transaction or stock-recovery handler changed. No dependency, migration, production data mutation, commit, deployment or protected PDF access occurred.

Stopped after Phase 4 per the phased brief. Phase 5 is report-only scaling work and has not started.
