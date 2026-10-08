# Product Entry UI polish — 2026-10-07

STATUS: PASS

## Audit

- Legacy form styles constrained the working card and color selector, leaving uneven widths and unused space.
- An empty size-options container reserved unnecessary layout space. Section spacing, helper copy and selling-price placement lacked a consistent rhythm.
- Workflow progress sat outside the first form card, with weak visual distinction between stages.
- The top form divider and nested option cards added visual noise.
- View products and form actions needed clearer hierarchy. An inherited mobile rule hid the New product eyebrow.
- Tablet product-detail fields used two columns where the requested guided workflow benefits from one.

Read AGENTS.md, ARCHITECTURE.md, the relevant schema/models and existing Entry, receiving, form, style and test implementations before editing. The current JS/JSX frontend and canonical Entry responsibility were preserved. Existing Products polish changes in the working tree were retained.

## Implemented

### Header and working area

- New product remains a small uppercase eyebrow, including mobile. Product Entry is a strong 30px desktop / 28px mobile title.
- Short role-appropriate subtitle: OWNER can add first stock or save with zero stock; WAREHOUSE remains zero-stock only.
- Compact ghost View Products navigation retains the existing dirty-state guard.
- Centered working area with a 1040px maximum width. The existing definition wrapper becomes one white workflow card; its inner form card has no duplicate border/padding.
- Neutral cream page, white surfaces, restrained 12px radius and no decorative sidebar or large shadows.

### Stepper

- Compact numbered stages, green current state, completed checkmarks, quieter future stages and desktop connector lines.
- Accessible ordered list, `aria-current="step"`, and explicit step number/current/completed/upcoming labels.
- Mobile uses compact readable columns without horizontal overflow.
- OWNER remains Product → Quantities & Cost → Review; WAREHOUSE retains its existing two-step definition/review flow. Stage logic did not change.

### Fields and variants

- Removed the noisy top form divider.
- Equal Product name / Category columns on desktop; one column at 900px and below. Inputs and selects consistently use 44px height, labelled controls and visible focus.
- Strong 18px section legends with consistent field labels and 16–24px group spacing.
- Full-width Color selector, followed by a clear `+ Add Custom Color` native disclosure. Existing custom-color creation, case-insensitive deduplication and custom sizes remain unchanged.
- Compact empty helper: “Select a color to configure its sizes.” An empty size-options area is removed from layout rather than reserving a blank grid track.
- Selected color sizes flow directly below the selector; unnecessary nested card borders are replaced with restrained group dividers.
- Short stock helper: “Start with zero stock, or add received quantities in the next step.”
- Selling price remains a clearly titled OWNER-only section, with a bounded input width for readability. WAREHOUSE has no editable price or cost controls.
- Optional photo, codes/barcodes, generated SKU values and image behavior are retained.

### Actions, validation and receiving presentation

- Cancel leads the action area; Continue → is the strongest action. Mobile actions fill the card width.
- Kept a normal-flow footer after auditing sticky behavior. This avoids covering variable-height size/code/photo controls and avoids additional scroll containers or browser safe-area overlap.
- Existing category loading/review/busy restrictions still govern submission. Existing validation messages are displayed near their corresponding details, variants or price section and remain announced as alerts.
- Unknown/general errors and recovery guidance remain visible; safe error mapping is unchanged.
- Initial receiving and review use the same card/step styling. The old amber nested review box becomes a flat neutral review section.
- Continue still only defines the local draft. Save Product Only still reviews/saves a zero-stock definition; receiving still requires the existing quantities/cost review and explicit confirmation.

### Responsive, accessibility and performance

- 1440 and 1280: centered useful width, balanced desktop fields and separated Cancel/Continue actions.
- 768: full-width stacked product-detail fields and readable workflow progress.
- 390: single-column fields, compact stepper, full-width actions and no clipped controls/page overflow.
- Keyboard-operable native buttons/disclosures, associated labels, selected size `aria-pressed` states, visible focus and 44px operational targets.
- Steps include numbers/checkmarks and accessible state descriptions; color alone is not the state indicator.
- Existing category loading, GET cancellation, route lazy loading, mutation recovery and dirty-state behavior remain. Entering/editing the form adds no catalog/history requests or new fetch effect.

## Validation

| Check | Result |
| --- | --- |
| Frontend unit suite | PASS — 289 tests |
| Products UI regressions | PASS — 81 tests |
| Entry/Products acceptance | PASS — 17 tests |
| New Entry polish checks | PASS — 9 tests |
| Existing Products polish checks | PASS — 12 tests |
| Frontend lint | PASS |
| Frontend build | PASS |
| Diff whitespace check | PASS |
| Protected-file SHA-256 comparison | PASS — 148 files unchanged |

Commands: `npm.cmd test --workspace client`; `node --test scripts/products-ui.test.mjs scripts/entry-products-ui.test.mjs`; `node --test scripts/entry-products-ui.test.mjs scripts/entry-polish-ui.test.mjs scripts/products-polish-ui.test.mjs`; `npm.cmd run lint --workspace client`; `npm.cmd run build --workspace client`; `git diff --check`.

The final Entry/acceptance rerun followed the final scoped layout changes. Existing business assertions were retained. Presentation-specific selectors changed from Colors to Color, and the asserted tablet column breakpoint changed to the requested 900px stacking behavior.

Visual QA covered initial/selected forms at 390, 768, 1280 and 1440px, and mobile receiving review. Screenshots are temporary offline QA artifacts under `%TEMP%/saas2-products-qa/screenshots/entry-polish-*.png`.

All browser tests use synthetic local API/auth fixtures and block external services. Fixture mutations exercise creation/recovery contracts without contacting a real database.

## Files changed for this task

- `frontend/src/pages/app/InventoryPage.jsx`
- `frontend/src/features/products/ProductCreateForm.jsx`
- `frontend/src/features/inventory/ReceiptPresentation.jsx`
- `frontend/src/features/inventory/entry-polish.css` — new, Entry-scoped stylesheet
- `scripts/entry-products-ui.test.mjs` — label selector update
- `scripts/products-ui.test.mjs` — label selector and tablet-layout expectation updates
- `scripts/entry-polish-ui.test.mjs` — new focused checks
- `docs/entry-ui-polish-2026-10-07.md` — this report

## Business logic and unchanged scope

- Backend changed: NO.
- API contracts changed: NO.
- Product creation semantics changed: NO. ProductCreateForm's code before the presentation section, including creation/validation/option handlers, was compared with the original and is unchanged.
- OWNER/WAREHOUSE permissions changed: NO.
- Save Product Only, initial receiving, StockReceipt, inventory movements, financial rules and idempotency/recovery changed: NO.
- StockReceiptForm, VariantQuantityMatrix and the existing flow/recovery modules remain unchanged from this task's start.
- Prisma/schema/migrations/database, Railway, Supabase infrastructure and R2 infrastructure changed: NO.
- AGENTS.md, ARCHITECTURE.md and `planing/SaaS2_Clothes_Implementation_Summary.pdf` changed: NO; protected hashes match the task-start baseline.
- Existing Products page and Products polish stylesheet changed by this task: NO.
- Secrets exposed: NO. Deployment performed: NO. Commit created: NO.

## Remaining limitations and assumptions

No remaining layout issue was found at the tested widths. Very long color/size lists still require normal page scrolling; the footer intentionally remains in normal flow.

Live API/Supabase/R2 behavior was not tested; verification was local and offline. The existing JS/JSX implementation, Account currency and OWNER/WAREHOUSE creation capabilities follow ARCHITECTURE.md.
