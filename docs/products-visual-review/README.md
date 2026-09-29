# Products visual improvements — 2026-09-29

Visual-only changes. Existing imperative operations, API calls, roles, data
models, migration files and accounting behavior were preserved. No commit or
deployment. The earlier functional re-audit findings are outside this task.

1. **Compact matrix:** each color is one white working section with size rows,
   stock count/controls, price, readable readiness and local More disclosure.
   Removed nested pale panels and tile borders. Variant edit fields now appear
   in the affected row; adding an option keeps the existing section form.
   Desktop controls remain 40px high; mobile stock controls remain 44px.
   Mobile wraps the row into compact columns; pending information gets extra
   space when needed rather than overlapping price/actions.
2. **Action grouping:** photo disclosure moved into the identity/Edit header.
   Bulk-price trigger moved beside Colors & sizes and Add color / size. Product
   deactivation has a quiet red outline; confirmation dialog is unchanged.
3. **Catalog:** desktop table retained. Tablet identity/category and stock/price
   are grouped; mobile View product is an explicit action in the card, without
   a separate full-width footer.
4. **Filters:** one Apply filters submit uses the same existing form handler.
   Clear is quiet. The same submit remains available on mobile, inside the sheet
   while open; search Enter still submits. Filter focus/Escape behavior passes.
5. **States:** amber Cost pending: Inventory link, green Sellable/Active states,
   neutral other operational states. Purchase-cost absence does not change
   sellability. All state names remain visible; no color-only meaning.
6. **Focus/boundaries:** Products-scoped solid primary focus rings and darker
   functional borders (#879384). Decorative borders remain pale. Shared index.css
   was intentionally not changed, so other modules keep their existing styling.
7. **Typography:** creation labels, notes, removal actions and status text are
   now 13px; working detail text stays readable. Density comes from row layout.
8. **Swatches:** shared fixed preset-name-to-hex component, shown beside chosen
   creation colors and detail color headings. Unknown/custom and Multicolor use
   a neutral outline fallback; user text never becomes CSS. Native select options
   remain text-only because embedded styled swatches are not consistently rendered
   by native selects; replacing the selector would change its interaction beyond
   this visual task. Names remain visible everywhere.

## Validation

- Frontend unit tests: 234 passed, 42 suites.
- Responsive/offline browser suite: 33 passed, including 390, 768, 1024, 1366
  and 1440px checks, image controls, editing, filters, roles and stock actions.
- ESLint and frontend production build passed; scoped whitespace diff passed.
- Existing responsive selectors were updated for Apply filters and the explicit
  Inventory link. Geometry expectations now assert matrix rows, with the dense
  page below 1300px. Operational assertions remain.
- Pre-render operation code in both JSX pages matches HEAD after excluding the
  new swatch import. No backend changes or live authenticated mutations.
- Dense fixture at 1366px: before 1422px, after 1134px, 288px / 20.3% shorter.
  The initial audit's approximately 1470px was an earlier fixture measurement.
  Arbitrarily many options are not promised to fit one screen.
- Screenshots visually reviewed for desktop/tablet/mobile catalog/create/details,
  dense rows and pending-cost state. Fixtures are not production data.

## Files changed

- frontend/src/pages/app/ProductsPage.jsx
- frontend/src/app/ProductCreateForm.jsx
- frontend/src/app/ColorSwatch.jsx (new presentation component)
- frontend/src/pages/app/products.css
- scripts/products-ui.test.mjs (layout selectors/geometry only)
- This report and before/after PNGs below.

The previous two audit reports remain untouched. The protected PDF was neither
read nor modified. No business correctness changes were attempted.

## Before / after screenshots

| Width | Catalog | Create | Details |
| --- | --- | --- | --- |
| 1366 | [Before](before/catalog-1366.png) / [After](after/catalog-1366.png) | [Before](before/create-1366.png) / [After](after/create-1366.png) | [Before](before/detail-1366.png) / [After](after/detail-1366.png) |
| 1024 | [Before](before/catalog-1024.png) / [After](after/catalog-1024.png) | [Before](before/create-1024.png) / [After](after/create-1024.png) | [Before](before/detail-1024.png) / [After](after/detail-1024.png) |
| 768 | [Before](before/catalog-768.png) / [After](after/catalog-768.png) | [Before](before/create-768.png) / [After](after/create-768.png) | [Before](before/detail-768.png) / [After](after/detail-768.png) |
| 390 | [Before](before/catalog-390.png) / [After](after/catalog-390.png) | [Before](before/create-390.png) / [After](after/create-390.png) | [Before](before/detail-390.png) / [After](after/detail-390.png) |

Dense desktop: [Before](before/dense-1366.png) / [After](after/dense-1366.png).
Pending cost: [Mobile](after/cost-pending-390.png) / [Desktop](after/cost-pending-1366.png).
