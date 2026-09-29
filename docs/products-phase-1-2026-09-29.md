# Products phased task — Phase 1

Scope: same-page draft protection and explicit waiting controls only. Prior
visual changes remain intact; no new Phase 2–5 work was started. No commit,
deployment, migration, production mutation, dependency addition or protected
PDF access.

## 1. What changed

### 1a. Draft protection

- Opening product/variant status confirmation keeps every draft intact. Cancel
  leaves the forms as they were; failed mutations retain drafts and the dialog.
- Successful confirmation clears only the related draft: product form for
  product status, matching variant form for that variant's status. Unrelated
  product/variant drafts remain intact.
- Product Cancel no longer clears variantEdit. Variant Cancel remains independent.
- Reopening bulk pricing preserves price, selected targets and review state.
- Bulk Cancel guards its own meaningful draft only; an untouched price form does
  not warn about another form. Selection-only changes are meaningful too and
  remain protected by internal-navigation/Back dirty guards.

### 1b. Pending stock

- Bulk-price submit and photo upload/file controls are disabled during any stock
  request, with aria-disabled and aria-describedby pointing to visible role=status
  feedback: "Waiting for stock update to finish."
- Controls become usable after the stock request settles. No hidden queue or
  automatic save was introduced. Other variants' stock controls remain usable.
- Existing routes, API calls and accessible control names remain unchanged.

## 2. Files touched in this phase

- frontend/src/pages/app/ProductsPage.jsx
- scripts/products-ui.test.mjs
- This phase report and [isolated Phase 1 patch](products-phase-1.patch).

The patch contains only Phase 1 changes relative to the already-present visual
work; reverse-apply validation passed. Existing uncommitted visual files, swatch
component, screenshots and earlier audit reports were preserved, not folded into
this phase's behavior patch. No CSS or backend code changed during this phase.

## 3. Tests added

Ten browser regression tests cover:

1. Product deactivation cancellation preserves a dirty product form.
2. Clean product cancellation preserves a dirty variant without prompting.
3. Bulk reopen preserves price, target selection and review state.
4. Variant deactivation cancellation preserves its draft.
5. A deterministically delayed stock request disables price/photo saves, exposes
   accessible wait messages, leaves another variant usable and queues no save.
6. Clean bulk cancellation does not warn about unrelated dirty product edits.
7. Clean variant cancellation preserves dirty product edits without prompting.
8. Failed product deactivation retains drafts; successful retry clears only its own.
9. Failed variant deactivation retains drafts; successful retry clears only its own.
10. Selection-only bulk changes prompt before discard and survive cancellation.

The four originally reported draft cases and stock-wait test failed before the
fix and passed after. Clean bulk and selection-only cases also failed against
the isolated pre-Phase-1 source and passed after. Remaining tests exercise failure,
success and unaffected-direction behavior. No existing selector/layout assertion
was changed in this phase; the earlier visual-phase selector updates were retained.

## 4. Validation

- Frontend unit tests: 234 passed, 42 suites.
- Backend tests: 424 passed, 76 suites, including test TypeScript compilation.
- Frontend ESLint and production build passed.
- Final combined browser suite: 43 passed (33 existing checks and 10 new Phase 1
  cases), zero failures.
- Browser fixtures cover 390 / 768 / 1024 / 1366 / 1440px. Network calls use
  intercepted offline fixtures; no real business mutation was performed.
- Scoped whitespace diff and isolated patch validation passed.

## 5. Intentionally deferred

Shared stock recovery, image fault isolation, normalized color grouping, further
visual work and scaling measurement are deferred to Phases 2–5 as requested.
This phase does not claim to solve those findings. Work stops here awaiting
the user's explicit approval to begin Phase 2.
