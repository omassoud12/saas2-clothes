# Complete frontend architecture audit — SaaS2

Date: 2026-09-29. Audit only. Scope: the current `frontend/`, its import graph, configuration and external frontend test harness. Read against `AGENTS.md` and `ARCHITECTURE.md`. Paths below are relative to `frontend/src/` unless specified otherwise.

Evidence: source inspection, literal relative-import/dynamic-import graph, source searches, current frontend unit tests and ESLint. Earlier Products browser reproductions are attributed to `docs/products-final-audit-2026-09-29.md`; they were not rerun for this audit. No live account mutations, fresh browser suite, production load measurements or security certification. Recommendations are proposals, not implemented changes.

## 1. Executive architecture verdict

**The foundation is sound; a targeted structural refactor is justified, a frontend rewrite is not.** Network transport is centralized, domain flows are React-free and testable through injected dependencies, business pages are lazy-loaded, money previews use exact arithmetic, and the backend remains authoritative for tenant access and finance.

The main maintenance costs are concrete: Products coordinates too many independent workflows; shared authenticated transport lives in an owner-specific module; feature components and domain flows are scattered between `app/` and `pages/app/`; and one global stylesheet owns nearly every feature. Resolve known interaction defects before moving files. Introduce feature ownership gradually, starting with Products and Sales. Keep the present React/Vite/JSX stack and manual router.

## 2. Current frontend tree

```text
frontend/
  package.json, vite.config.js, eslint.config.js, index.html
  .env.example                     # configuration contract; no secret values included
  src/
    main.jsx, App.jsx, index.css
    app/
      routes.js, app-navigation.js, app-flow.js
      AppLayout.jsx, AppRouteGuard.jsx, AppHeader.jsx, AppSidebar.jsx
      CatalogConfirmation.jsx, ColorSwatch.jsx, ProductCreateForm.jsx
      RestockDialog.jsx, dirty-state.js
      category-flow.js, dashboard-flow.js, finance-flow.js
      inventory-audit-flow.js, product-flow.js, product-options.js
      product-setup-flow.js, restock-flow.js, stock-recovery.js
      sale-flow.js, sale-lifecycle-flow.js, landing-flow.js
      12 *.test.js                  # includes product-hardening.test.js
    auth/
      auth-flow.js, owner-flow.js, admin-flow.js
      3 matching *.test.js
    components/
      AppErrorBoundary.jsx
      auth/AuthLayout.jsx
      ui/index.jsx
    lib/
      api-client.js, supabase.js, money.js
      api-client.test.js, money.test.js
    pages/
      LandingPage.jsx, LoginPage.jsx, SignupPage.jsx
      AuthCallbackPage.jsx, SignupCallbackPage.jsx, SetPasswordPage.jsx
      OwnerOnboardingPage.jsx, AdminPage.jsx, AccountStatusPage.jsx
      PendingApprovalPage.jsx, InactiveAccountPage.jsx
      AuthenticatedStatusPage.jsx
      app/
        CategoriesPage.jsx, DashboardPage.jsx, ProductsPage.jsx, products.css
        InventoryPage.jsx, InventoryAuditSections.jsx
        SalesPage.jsx, SaleLifecyclePanel.jsx, ReturnsPage.jsx, ExchangesPage.jsx
        ExpensesPage.jsx, ReportsPage.jsx
```

Workspace dependency resolution is governed by the root `package-lock.json`, not a separate frontend lockfile. Installed dependencies and generated output are not architecture source. `scripts/products-ui.test.mjs` is an external browser harness relevant to this frontend.

## 3. Current architecture model

Hybrid, predominantly organized by type. `pages/`, `components/`, `lib/` and `auth/` provide recognizable layers, while kebab-case domain flows inside `app/` supply feature boundaries. `app/` has become both application infrastructure and a feature warehouse. This works at the current scale but makes ownership and imports harder to follow as Products and Sales grow.

## 4. Folder-by-folder audit

| Location / files | Classification and current responsibility | Verdict |
| --- | --- | --- |
| `main.jsx` | BOOTSTRAP: React root, StrictMode, global CSS/error boundary | Keep small. |
| `App.jsx` | ROUTING: pathname, history, auth/public route selection | Coherent; navigation/dirty interception needs one owner. |
| `app/routes.js`, `app-navigation.js` | ROUTING/CONFIGURATION: paths, matching, navigation and role visibility | Correct infrastructure location. |
| `app/app-flow.js` | AUTH/APP FLOW: business profile authorization, shell identity, logout | Coherent application boundary; some state classification duplicates auth. |
| `app/AppLayout.jsx`, `AppRouteGuard.jsx`, `AppHeader.jsx`, `AppSidebar.jsx` | SHELL/COMPONENT: protected loading, lazy pages, navigation, mobile drawer | Correct location; isolate drawer behavior only if shared. |
| `app/dirty-state.js` | HOOK/STATE: unsaved changes and navigation confirmation | Shared infrastructure; name hides its hook export. |
| `app/ProductCreateForm.jsx`, `CatalogConfirmation.jsx`, `ColorSwatch.jsx` | FEATURE COMPONENTS: setup form, catalog confirmation, preset color rendering | Products ownership, not app-wide infrastructure. |
| `app/RestockDialog.jsx` | FEATURE COMPONENT/WORKFLOW: restock draft and submission | Inventory ownership; shared by feature callers. |
| `app/product-flow.js`, `product-setup-flow.js`, `product-options.js`, `stock-recovery.js` | DOMAIN/API/VALIDATION/STATE: product requests, atomic setup workflow, option ordering/readiness, durable stock-operation metadata | Coherent individually; feature ownership should become explicit. |
| `app/category-flow.js`, `restock-flow.js`, `inventory-audit-flow.js` | DOMAIN/API/VALIDATION: categories, restock workflow, history/reconciliation | Keep each domain cohesive. |
| `app/sale-flow.js`, `sale-lifecycle-flow.js` | DOMAIN/API/EXACT PREVIEW: checkout/cart and returns/void/exchange | Good separate responsibilities; keep backend financial authority. |
| `app/finance-flow.js`, `dashboard-flow.js` | DOMAIN/API: expenses/reports; dashboard aggregation/loading | Dashboard is a cross-feature composition, not a financial calculator. |
| `app/landing-flow.js` | ROUTE CONTRACT/UTILITY: landing CTA paths | Small and coherent; no need to split. |
| `auth/auth-flow.js` | AUTH: recovery/invitation sessions, password setup, callback interpretation | Keep callback/security invariants together. |
| `auth/owner-flow.js` | AUTH/API/VALIDATION/PRESENTATION: generic session requests, profile state, signup, onboarding, status copy | Strongest shared-layer naming/boundary problem. |
| `auth/admin-flow.js` | AUTH/DOMAIN/API: platform account review | Legitimate separate privileged frontend area. |
| `components/AppErrorBoundary.jsx` | GLOBAL COMPONENT: render failure fallback | Appropriate; does not replace async error handling. |
| `components/auth/AuthLayout.jsx` | AUTH UI: layout, password field, messages/loading/actions | Related small exports can remain together. |
| `components/ui/index.jsx` | UI PRIMITIVES: button/input/select/card/badge/header/states/table/modal | Domain-free, appropriate shared layer; several exports unused. |
| `lib/api-client.js`, `supabase.js`, `money.js` | API CLIENT, AUTH CLIENT, FORMATTER/EXACT ARITHMETIC | Good shared location except product-specific catalog summary in money. |
| `pages/` public/auth/admin/status files | PAGE: route-entry orchestration and local view | Mostly coherent; one unreferenced legacy page. |
| `pages/app/*Page.jsx` | PAGE: business route orchestration | Products/Sales need focused feature boundaries; small routes need no wrappers. |
| `pages/app/InventoryAuditSections.jsx`, `SaleLifecyclePanel.jsx` | FEATURE COMPONENTS, not route pages | Misplaced; move with inventory/sales ownership. |
| `index.css`, `pages/app/products.css` | STYLE: shared/all-feature cascade; product-specific overrides | Ownership fragmented; preserve cascade during extraction. |
| All 17 `*.test.js` | TEST: adjacent pure-flow/API/contract fixtures | Useful colocation; package script manually enumerates them. |
| Frontend package/Vite/ESLint/HTML config | CONFIGURATION: scripts, bundling, lint, document entry | Adequate; `latest` declarations deserve intentional version maintenance. |

## 5. Top 15 most important files and responsibilities

| File | Primary role | Maintenance implication |
| --- | --- | --- |
| `App.jsx` | Browser history and root routing | Preserve URL/back/dirty semantics. |
| `app/AppLayout.jsx` | Lazy business routes, shell, drawer/logout | Keep route components keyed by product identity. |
| `app/AppRouteGuard.jsx` | Load and authorize application profile | `/api/auth/me` remains authoritative. |
| `auth/owner-flow.js` | Session, authenticated API, signup/onboarding/status | Extract shared dependencies first. |
| `auth/auth-flow.js` | Secure auth callback/password flows | Avoid scattering URL/session rules. |
| `lib/api-client.js` | Request construction and safe error envelope | Common foundation, preserve injection. |
| `lib/supabase.js` | Browser SDK configuration/client creation | Public configuration only; callback dependencies should be leaf modules. |
| `pages/app/ProductsPage.jsx` | Catalog/detail and many mutations | Highest orchestration complexity. |
| `app/product-flow.js` | Product API, validation, role visibility | React-free feature boundary worth retaining. |
| `app/stock-recovery.js` | Durable original UUID and cross-tab locks | Preserve safety semantics, not a generic request cache. |
| `pages/app/SalesPage.jsx` | POS catalog/cart/checkout/history | Separate catalogue loading from checkout intent. |
| `pages/app/SaleLifecyclePanel.jsx` | Return/exchange/void panel | Focused views and mutation coordination need separation. |
| `app/sale-lifecycle-flow.js` | Lifecycle API/eligibility/exact previews | Preserve immutable sale snapshot semantics. |
| `app/finance-flow.js` | Expenses/reports, dates and response validation | Backend report totals, no inferred profit. |
| `index.css` | Tokens, base and many feature styles | Largest cross-feature change surface. |

## 6. Files with too many responsibilities

Approximate source lines describe navigation cost, not a failure threshold.

| File / size | Current responsibilities | Keep or split, and why |
| --- | --- | --- |
| `ProductsPage.jsx` ~445 | Catalog, filters, details, product/variant drafts, bulk prices, stock recovery/mutations, images, confirmation, dirty state | Split controller responsibilities and focused views. Drafts and server refreshes currently interact across unrelated handlers. |
| `owner-flow.js` ~549 | Session reads, shared authenticated transport, signup, onboarding validation, profile classification/destination, status copy | Split shared auth/API primitives from owner lifecycle. All domains currently depend on owner-named infrastructure. |
| `SaleLifecyclePanel.jsx` ~285 | Detail/return history, three operation modes, replacement search/cart, focus/close/discard, mutation identity | Extract cohesive panel state and focused mode views; maintain one operation owner. |
| `SalesPage.jsx` ~216 | Product search/category load, cart, checkout retry, sale history, drawers/panel | Target catalogue loading and checkout coordination, not every JSX fragment. |
| `CategoriesPage.jsx` ~351 | Load/create/edit/delete, guards, messages, forms | Medium complexity; local forms can stay until reused. Length reflects explicit UI, not an urgent rewrite. |
| `AdminPage.jsx` ~374 | Auth gate, account list, approval/rejection, per-account guards | Domain cohesive. Optional review-list/rejection UI extraction; keep privileged workflow together. |
| `index.css` ~1153 | Tokens/base plus landing/auth/shell/products/POS/lifecycle/inventory/finance/dashboard | Split by actual owners after fixing cascade dependencies. |
| `product-flow.js` ~266, `category-flow.js` ~297, `sale-lifecycle-flow.js` ~264 | Requests, pure validators/eligibility, frontend-safe messages per domain | Not automatically oversized: related operations are intentionally tested together. |
| `DashboardPage.jsx` ~119, `ReportsPage.jsx` ~109, `ExpensesPage.jsx` ~119, `InventoryPage.jsx` ~96 | Route orchestration with focused local subcomponents | Keep mostly intact. Extract only stable reusable responsibility. |

## 7. Misplaced files

Confirmed boundary mismatches: `InventoryAuditSections.jsx` and `SaleLifecyclePanel.jsx` are components under route pages; ProductCreateForm/CatalogConfirmation/ColorSwatch/RestockDialog are feature components under application infrastructure; domain flows share that infrastructure folder. Product catalog summary logic inside generic `lib/money.js` also crosses ownership. These are maintainability findings, not runtime import failures.

## 8. Naming problems

- Files: PascalCase JSX and kebab-case JS are already coherent. Preserve them. `owner-flow.js` under-describes its shared auth/API scope. `dirty-state.js` hides `useDirtyState`; separate hook and navigation helper only with clear ownership.
- Components: local `ProductForm` edits basic identity only; `ProductIdentityForm` is clearer after extraction. `VariantForm`, `ProductCatalogCard`, `SaleLifecyclePanel` and `ColorSwatch` describe their UI adequately. Do not rename every Card to Row merely for terminology.
- Functions: `quickAddStock` accepts negative delta too; `adjustVariantStock` better describes both directions. `applyVariantPrice` targets multiple selected IDs; `applyVariantPrices` clearer. `load`/`get`/`list` differences are mild, not a mass-renaming reason. Local `run`, `refresh` and `change` are acceptable in small scopes, less readable in a multi-workflow controller.
- States: Products `busy` is an action string, not a boolean; prefer `pendingAction`. `priceReview` is a boolean review phase; `isPriceReviewOpen` or a small editing/review phase makes intent clearer. Keep `productDirty`, `variantDirty`, `filtersOpen`, `pendingStock`, `recoveryError` recognizable. Ref locks are distinct from rendered pending state and must not be discarded as duplicates.
- Constants: UPPER_SNAKE_CASE limits/route maps are consistent. Lowercase immutable `clothingSizes`/color collections are a minor inconsistency; do not rename solely for case.
- CSS: feature prefixes generally prevent collision. Cross-feature use of `product-panel`, `product-status` and related layout classes makes the name misleading when Inventory/Sales depend on them. Promote only genuinely shared surface/status styles to shared names.

PowerShell output can misdecode UTF-8 glyphs. This audit does not treat terminal mojibake as proof of broken browser copy.

## 9. Page/component separation review

Pages generally orchestrate flows instead of making raw requests. Local page-only components are valid, especially the small Dashboard/Reports views. Extract Product overview, catalog/filter view, variant editor/options view and photo editor because they have independent props and interaction responsibilities. Keep components controlled where possible. A feature component belongs with its feature, not in global UI just because it is extracted.

Reusable global UI: error boundary and domain-free controls/loading/error/layout primitives. Auth UI: AuthLayout/password/messages. Feature UI: product forms/confirmation/swatches, restock dialog, lifecycle panel, inventory history/reconciliation. Page-only views: dashboard metrics, report breakdown, expense list, POS cart/history until an actual second consumer needs them.

## 10. Domain-flow/service architecture review

| Module | React-specific? | Current mix / recommendation |
| --- | --- | --- |
| `category-flow` | No | API, name validation, edit/delete/list helpers and safe messages; cohesive. |
| `product-flow` | No | API, payload/image validation, duplicate checks, permissions/messages; retain domain module, optional API/payload separation later. |
| `product-setup-flow` | No | Setup validation and retryable workflow; distinct from general CRUD, keep. |
| `product-options` | No | Normalization, sorting, grouping and operational state; feature utility, keep. |
| `stock-recovery` | No | Browser storage/Web Locks operation protocol; feature infrastructure, not generic UI state. |
| `restock-flow` | No | Permission, draft validation, API and guarded workflow; coherent. |
| `inventory-audit-flow` | No | History/reconciliation API, labels, visibility and pagination helpers; coherent. |
| `sale-flow` | No | Cart rules/exact preview, checkout identity/guard and API/history; separate cart vs checkout only as complexity grows. |
| `sale-lifecycle-flow` | No | Return/void/exchange eligibility, preview and API; coherent shared lifecycle domain. |
| `finance-flow` | No | Expenses/reports API, date validation, safe report shapes and latest-request helper; generic request guard can become shared when deliberately reused. |
| `dashboard-flow` | No | Independent section loading and catalogue/sales summaries; composition module. |
| `landing-flow`, `app-flow` | No | Landing route contract; shell authorization/profile presentation, respectively. |
| `auth-flow`, `admin-flow` | No | Callback/password lifecycle; platform account-review lifecycle. Keep their related security rules together. |
| `owner-flow` | No | Shared session/transport mixed with owner onboarding and auth/status presentation; split responsibilities, not arbitrary chunks. |

Frontend-safe messages and display labels are presentation adapters, not React dependencies or backend accounting. Keeping them in a domain flow is reasonable. Avoid creating identical `api/`, `services/`, `utils/` wrappers that merely forward calls.

## 11. API/Supabase dependency review

Current path: page/container → domain flow → `authenticatedApiRequest` in owner-flow → injected session/transport → `lib/api-client.js` → backend. Auth flows separately invoke Supabase Auth. No direct privileged database access, `supabase.from`/RPC calls or page-level raw fetch were found in the inspected frontend. `fetchImpl` remains injectable; pages do not construct bearer headers.

All browser-client importers, classified:

| Importers | Purpose |
| --- | --- |
| `AppLayout`, `AppRouteGuard` | Logout and protected profile/session loading. |
| `ProductCreateForm`, `RestockDialog` | Inject authenticated SDK dependency into their workflows. |
| `AccountStatusPage`, `OwnerOnboardingPage`, `LoginPage`, `SignupPage` | Session/profile, owner bootstrap and account entry actions. |
| `AuthCallbackPage`, `SignupCallbackPage`, `SetPasswordPage` | Callback/recovery/invitation completion. |
| `AdminPage` | Platform review authentication/API injection. |
| `AuthenticatedStatusPage` | Legacy session/status view, no runtime importer found. |
| `CategoriesPage`, `DashboardPage`, `ExpensesPage`, `InventoryPage`, `ProductsPage`, `ReportsPage`, `SalesPage` | Domain flow dependency injection at route containers. |
| `InventoryAuditSections`, `SaleLifecyclePanel` | Injection inside independently loading feature containers. |

These 22 imports are not 22 uncontrolled database clients. UI leaf components should not import the singleton; containers currently do so reasonably. Feature hooks accepting a client/service dependency would improve testing of complex coordination. Do not add an abstraction merely to hide every singleton import.

`api-client` normalizes status/code and bounded safe messages, including Retry-After. Domain-specific adapters vary: finance preserves rate-limit detail, other flows lose some metadata or classify account failures differently. Centralize the shared auth/account envelope, retain domain error dictionaries. Response validation is uneven (some product/variant checks are minimal); add contract checks around fields the UI actually requires rather than duplicating every backend schema. Transport currently exposes no request `signal`; optional GET cancellation is useful, mutation cancellation must not imply rollback.

## 12. Hook/state/effect architecture review

The main existing custom hook is `useDirtyState`. Local state and refs are sufficient; no evidence warrants a global state library. Supabase owns token persistence/refresh; the route guard holds the application profile. Stock recovery intentionally persists tenant/user/product-scoped unresolved operation metadata with original UUIDs.

Good derived state: Products page count, groups, dirty flags and current product/variant; exact cart totals and report presentation. Do not store copies of these merely to memoize them. `selectedId` mirrors `productId`, but `AppLayout` keys page instances by product ID: a stale-route-prop bug is not established for Products. Separate catalog/detail entries could eventually remove that redundancy.

High-value hook candidates: `useVariantStockRecovery` for storage events, locks, pending state and finalization; `useProductDetails` for detail loading/mutation reconciliation; a small shared dialog focus/scroll hook once current differences are specified. Keep domain validation and UUID persistence protocol outside React.

Async patterns vary: active booleans in initial effects, request epochs in filters, latest-request guards in reports/dashboard, mutation refs in products/checkout. Initial cleanup is generally deliberate. Handler-launched Inventory pagination/Admin refresh and Sales/lifecycle requests do not consistently invalidate all work on unmount or mode changes. This is a source-identified lifetime risk, not a new reproduced race. Centralize only a small lifecycle/epoch contract and test late resolution before extracting hooks.

Sales/lifecycle drafts have local close/discard handling; Products uses shared dirty navigation state. Test internal route changes, browser Back and reload for all meaningful drafts; closing one panel is not the complete navigation contract. SaleLifecyclePanel's detail effect depends on saleId, but its mode/drafts are local and the Sales caller does not key it by saleId: verify a direct selection switch before asserting a reset guarantee.

Mutation locks are purposeful: Products coordinates ordinary mutations with stock in flight; per-variant stock locks allow separate resources. Rendering `busy` alone is not double-submit protection. Do not unlock concurrent edits until refresh/draft conflicts are resolved. A small action descriptor can improve naming without rewriting every page as a reducer.

## 13. Routing/auth architecture review

`routes.js` normalizes and names public/business paths; `app-navigation.js` matches business routes and role-visible navigation; `App.jsx` owns History API/popstate; `AppRouteGuard` loads the business profile; `AppLayout` renders lazy pages. This separation is workable. Literal redirect strings remain spread across flow/page code; route constants and one protected-failure navigator would reduce drift.

Auth authority is sound conceptually: SDK session proves identity and provides tokens, backend `/api/auth/me` determines application user, role and account state. Frontend role checks are UX only. SUPER_ADMIN is separate; inactive/pending accounts do not become business accounts through a UI flag. No frontend profile should become an accountId authority for backend requests.

Profile/session restoration is repeated in entry/status/admin/guard flows because route entry differs. Consolidate classification/session primitives, not all loading into a permanent global provider by default. The mounted business guard loads once and no `onAuthStateChange` subscription was found: SDK refresh does not automatically refresh displayed account/role state. Specify/test external sign-out and role/account refresh behavior; backend enforcement remains mandatory. Callback initialization imports callback helpers from broad auth modules into `lib/supabase`; leaf callback-URL helpers would reduce coupling without changing SDK setup.

App history and dirty-state helper both participate in navigation. Preserve one confirmation per attempted navigation, cancelled Back behavior and history restoration. React Router is not required by the evidence.

## 14. CSS/design-token architecture review

`index.css` is global/eager and contains tokens/base, landing/auth, shell, category/product, POS/lifecycle, inventory, finance and dashboard styles. `products.css` adds scoped Products rules and responsive overrides. The style hierarchy is functional but not scalable through indefinite append-only overrides. Other features use product-prefixed classes from global CSS, so simply moving every product rule to a lazy Products import would break them.

Keep CSS custom properties and ordinary stylesheets. Extract base/tokens/shared surfaces first, then feature CSS while preserving cascade order and screenshots. Color/spacing/radius/shadow tokens already exist; repeated literal feature colors and spacing can reuse them selectively. Breakpoints repeat across feature rules; document shared shell breakpoints and keep feature-specific wrapping thresholds where justified. Do not turn every number into a token or force one breakpoint onto every layout.

Existing green identity, amber pending state and red destructive actions should remain. Focus boundaries vary between stronger Products rules and generic global controls; consistency needs rendered keyboard/contrast checks. This architecture audit does not redesign colors or claim a new full accessibility assessment.

## 15. Testing architecture review

**Current checks:** `npm.cmd test` passed **240 tests / 42 suites**; `npm.cmd run lint` passed. PowerShell blocks `npm.ps1`; using the normal `.cmd` entry point required no policy change. Tests are 17 colocated files covering pure validation/domain flows, auth guards, API error normalization, exact money and operation workflows.

Strength: injected SDK/fetch doubles exercise frontend contracts without business mutations. Gap: green unit tests do not prove React draft synchronization, focus lifecycle, cross-tab display freshness or route transitions. The external Products harness supplies fixture-browser coverage but is outside the frontend package test command and relies on separate browser setup. Prior browser results are evidence from the preceding audit only, not newly executed here.

`npm test` explicitly lists files: new tests can be omitted accidentally. Prefer deliberate discovery/registration validation later. Hardening tests cover more than one module; name by the covered protocol rather than forcing one test per source file. ESLint's unused-variable rules are not an application-wide dead-export detector. No frontend typecheck command/TS configuration exists. Build was not run because this audit avoids generated artifact writes; the prior audit's build is not a current build check.

## 16. Confirmed dead/obsolete files or exports

- `pages/AuthenticatedStatusPage.jsx`: no route/import/runtime reference found in frontend or scripts; sole runtime source file unreachable from main in the inspected literal import graph. Candidate for removal only after checking intended external reuse/history.
- UI exports `Badge`, `EmptyState`, `Skeleton`, `TableContainer`, `Modal`: no current frontend/scripts consumers found. Dormant primitives, not broken imports or automatically obsolete features.
- Some exported flow helpers/constants are used internally or only by tests. They are testing seams, not confirmed dead code. Landing route-contract exports likewise have test consumers.

No blanket deletion list. Static analysis excludes computed imports/external integrations; no package was declared removable merely because a name appeared unused.

## 17. Confirmed duplicated logic

Repeated protected-failure redirect helpers appear in Products and inventory audit containers and analogous domain/page branches. Account/session classification appears in owner-flow and app-flow. Dialog focus trap, Escape, overflow and focus restoration patterns appear in shell/filter/POS/lifecycle implementations and the generic Modal. These need a shared behavioral contract, not blind textual replacement.

Sales and Products each render image fallback UI with different contexts. A small shared image component is worthwhile only after defining attachment/unavailable/loading semantics. Date/time display calls repeat across sales, inventory and admin; share event formatting if consistency is required. Product catalog-summary scaled-money parsing overlaps exact conversion helpers in money; extraction should reuse exact primitives. Domain-specific error messages and differing checkout/restock guards are not necessarily duplication.

## 18. Import/dependency-direction problems

No cycles were found in the literal local import graph, including literal lazy imports. This is a static graph finding, not proof against every runtime/package cycle.

Healthy dominant direction: pages → domain flows → auth/API primitives; flows do not import React pages. Exceptions in ownership: every domain reaches into owner-flow for generic transport; shared supabase initialization imports broad auth callback modules; generic money contains product summaries; Sales imports a non-route component from the pages folder; global CSS creates implicit cross-feature dependencies.

Recommended direction: application shell → feature entry; feature UI/hooks → its domain flow; domain flow → shared authenticated transport/exact utility. Shared `lib/`/UI must not depend on feature pages. Cross-feature Products catalogue use by POS/Inventory is legitimate through a domain API, not through ProductsPage or its state.

## 19. Products feature recommended boundary

Own catalogue/detail views, product and variant forms, option ordering/readiness/grouping, setup workflow, product API, images, selected-variant pricing and durable quick-stock UI coordination. Own draft reconciliation when any response updates the product. Keep stock movement/accounting authority on the backend and Inventory cost-entry responsibility outside this page.

Extract controlled UI first, then detail/stock coordination with explicit resource/draft contracts. Keep image operations separate from draft identity editing. Current known common-price/open-variant lost update and external stock freshness require behavioral tests before moving state around.

## 20. Sales feature recommended boundary

Own POS catalogue presentation, cart, frozen checkout intent/retry, history and sale lifecycle panel with return/void/exchange modes. ReturnsPage/ExchangesPage are small route entries for this domain, not reasons for duplicated operation engines. Reuse product catalogue access and exact money through module APIs. Do not import Product page components or recompute historical profit from current cost.

## 21. Inventory feature recommended boundary

Own inventory route, opening-cost form, restock dialog/workflow, history/reconciliation and filtering/pagination. Reuse product API/readiness contracts. Quick stock belongs to the Product interaction but creates authoritative inventory movements through backend endpoints; do not duplicate stock arithmetic in a second frontend service. Cost visibility is OWNER-only UX, backed by server projection.

## 22. Finance feature recommended boundary

Own expenses/reports, report/date input validation, incomplete-finance presentation and exact formatted totals. Keep event timestamp formatting separate from strict YYYY-MM-DD business dates. Current finance date parsing uses date-only rules; Inventory datetime filters explicitly use local timezone then ISO timestamps. Do not unify these into a helper that silently shifts report dates.

Dashboard composes catalogue, recent sales and finance summaries; it should consume feature flows rather than become the common API layer. UI pages perform presentation, not authoritative revenue/profit/cost accounting. Reviewed cart/refund/exchange preview logic uses string/BigInt helpers, not floating-point business arithmetic; Number-based quantities/date operations are not money arithmetic.

## 23. Auth/app-shell recommended boundary

Auth owns session helpers, callback validation, signup/login/password lifecycle, application-profile classification and platform review. App owns root/business routing, role-visible navigation, profile gating, shell and navigation dirty-state integration. Shared authenticated HTTP wraps SDK session access but does not know owner onboarding fields. SDK tokens and `/me` application profile remain separate sources with separate responsibilities, not competing authority.

## 24. Recommended target frontend directory tree

One incremental target, retaining route entry paths initially and avoiding empty per-feature framework folders:

```text
src/
  main.jsx, App.jsx
  app/
    routes.js, app-navigation.js, app-flow.js
    AppLayout.jsx, AppRouteGuard.jsx, AppHeader.jsx, AppSidebar.jsx
    dirty-state.js
  auth/
    session-flow.js, application-profile.js, callback-url.js
    auth-flow.js, owner-flow.js, admin-flow.js, *.test.js
  lib/
    api-client.js, authenticated-api.js, supabase.js, money.js, *.test.js
  components/
    AppErrorBoundary.jsx
    auth/AuthLayout.jsx
    ui/index.jsx
  features/
    products/
      ProductCreateForm.jsx, ProductOverview.jsx, ProductCatalog.jsx
      ProductIdentityForm.jsx, VariantForm.jsx, ProductOptions.jsx
      ProductPhotoEditor.jsx, CatalogConfirmation.jsx, ColorSwatch.jsx
      useProductDetails.js, useVariantStockRecovery.js
      product-flow.js, product-setup-flow.js, product-options.js
      product-catalog-summary.js, stock-recovery.js, products.css, *.test.js
    sales/
      SaleLifecyclePanel.jsx, SaleLifecycleViews.jsx
      sale-flow.js, sale-lifecycle-flow.js, sales.css, *.test.js
    inventory/
      RestockDialog.jsx, InventoryAuditSections.jsx
      restock-flow.js, inventory-audit-flow.js, inventory.css, *.test.js
    categories/category-flow.js, categories.css, *.test.js
    finance/finance-flow.js, finance.css, *.test.js
    dashboard/dashboard-flow.js, dashboard.css, *.test.js
  pages/
    current public/auth/admin/status route entries
    app/current business *Page.jsx route entries
  styles/
    tokens.css, base.css, shared-ui.css, auth.css, shell.css, landing.css
```

The tree is a destination, not a single migration. Pages can keep small local views; no additional wrapper is needed around a cohesive route. Create proposed hooks/modules only during a tested extraction. Optional shared dialog/date/async modules are excluded until their contracts and reuse justify them. Retaining page paths limits routing churn while feature ownership becomes clear.

## 25. Files that should be renamed

| Current → recommended | Reason / risk |
| --- | --- |
| Shared pieces of `auth/owner-flow.js` → `auth/session-flow.js`, `auth/application-profile.js`, `lib/authenticated-api.js` | Split-based naming, not a rename of the whole owner workflow. Medium risk. |
| Extracted local `ProductForm` → `ProductIdentityForm.jsx` | Describes actual basic edit responsibility. Low/medium. |
| Hook portion of `app/dirty-state.js` → `useDirtyState.js`, only if separated | Makes hook discoverable; preserve navigation helper ownership. Optional, medium if lifecycle changes. |

Function-only candidates: `quickAddStock` → `adjustVariantStock`; `applyVariantPrice` → `applyVariantPrices`. Low mechanical risk with all callers/tests updated. Keep kebab-case domain files and PascalCase components; no repository-wide naming conversion.

## 26. Files that should be moved

| Current → recommended | Why / risk |
| --- | --- |
| `app/{ProductCreateForm,CatalogConfirmation,ColorSwatch}.jsx` → `features/products/` | Feature UI ownership; low/medium. |
| `app/{product-flow,product-setup-flow,product-options,stock-recovery}.js` and associated tests → `features/products/` | Product domain and recovery protocol together; medium. |
| `pages/app/products.css` → `features/products/products.css` | Match feature owner after cascade review; medium. |
| `pages/app/SaleLifecyclePanel.jsx`, `app/sale*-flow.js` and tests → `features/sales/` | Component/domain ownership; medium. |
| `pages/app/InventoryAuditSections.jsx`, `app/RestockDialog.jsx`, restock/audit flows/tests → `features/inventory/` | Non-route components and inventory flows together; medium. |
| Category/finance/dashboard flows and tests → matching feature folders | Later ownership cleanup; low/medium; no functional urgency. |

Imports, lazy boundaries, test registration and stylesheet inclusion must move in the same independently validated stage. Do not move route files merely for symmetry.

## 27. Files that should be split

| Current → proposed pieces | Why / risk |
| --- | --- |
| `ProductsPage.jsx` → overview/catalog/identity/variant/options/photo views; detail coordinator and stock recovery hook | Independent workflow ownership and response/draft reconciliation; medium/high if moved together, medium in stages. |
| `owner-flow.js` → shared session, authenticated API, application profile, retained owner signup/onboarding | Remove owner coupling from every domain; medium/high because all auth entry paths depend on it. |
| `SaleLifecyclePanel.jsx` → panel coordinator + `SaleLifecycleViews.jsx` | Keep operation identity centralized; separate rendering/mode complexity; medium. |
| `money.js` → retained exact utilities + product-catalog-summary module | Remove feature semantics from shared money; low/medium. |
| `index.css` → tokens/base/shared UI/auth/shell/landing and feature-owned styles | Reduce implicit dependencies without changing visuals; medium/high. |

Do not create ten microfiles for each form label or API operation. Products hooks must expose semantic actions, not a bag of setters mirroring the original page.

## 28. Files that should NOT be split

Keep `App.jsx` small; current route complexity does not require a new router. Keep `api-client.js`, exact money primitives, `product-options.js`, stock recovery protocol, restock workflow and product setup workflow cohesive. Keep simple public/status routes and Returns/Exchanges entry pages intact. Dashboard/Reports/Expenses can retain their local focused views. Do not split category/admin/auth/lifecycle domain modules solely because they contain many exports or lines.

## 29. P0 findings

Using the requested taxonomy, P0 means a correctness/architecture bug, not necessarily a critical outage. **No new systemic tenant/auth/transport correctness defect was reproduced by this architecture audit.** Known Products interaction defects from the preceding final audit remain relevant prerequisites:

1. A variant draft opened before common pricing can save its old price and undo the applied update. This is a confirmed shared-state/reconciliation defect, previously browser-reproduced; fix before controller extraction.
2. Other-tab stock completion clears recovery metadata without refreshing the displayed quantity. This is a confirmed display freshness defect, not demonstrated duplicate stock mutation.

Unavailable-photo actions and deletion outcome issues also remain in the prior audit; they are not folder-architecture failures. No refactor should be sold as fixing those contracts automatically. Lifetime/session refresh concerns in this report remain test targets rather than newly reproduced P0s.

## 30. P1 findings

1. Products owns too many interacting workflows; define response/draft ownership and extract focused controllers/views.
2. Generic authenticated transport and profile/session primitives inside owner-flow make every feature depend on an owner-specific module; establish shared auth/API boundaries.
3. Async resource lifetime, protected-failure navigation and dialog behavior have multiple inconsistent implementations. Specify small shared contracts and protect them with interaction tests before consolidating.

These are maintainability recommendations based on actual responsibilities, not a preference for a different folder aesthetic.

## 31. P2 findings

Feature components under `pages/` and `app/`; global money containing product summaries; cross-feature product CSS classes and an oversized global cascade; ambiguous adjustment/action names; manual test-file registration; unused legacy status page/dormant UI exports; inconsistent domain retention of normalized error metadata. `latest` dependency declarations increase drift when the root lockfile is intentionally regenerated, although locked installs remain reproducible; no vulnerability finding is implied.

## 32. P3 optional improvements

Selective remaining feature colocation; shared event formatter after locale requirements; optional GET cancellation; profile refresh subscription if specified behavior requires it; splitting shared UI primitives if the barrel grows substantially; additional static import-boundary checks once target folders exist. Measure real catalogue/detail scale before introducing virtualization, pagination contracts or a fetching cache.

## 33. Things NOT worth changing now

Redux/Zustand, automatic React Router migration, React Query adoption, TypeScript frontend migration, CSS-in-JS/Tailwind, monorepo restructuring, a large design-system rewrite, universal reducers, a generic repository/service hierarchy, feature barrels everywhere or one file per tiny helper. Existing JSX is the documented frontend stack. Simple role checks, page-only subcomponents and deliberate operation locks remain valid. File moves will not by themselves explain or fix network latency.

## 34. Safe staged refactor roadmap

| Stage | Independent change and exit condition |
| --- | --- |
| A1 — correctness contracts | Fix price-draft overlap and external stock freshness; add regression coverage. Handle photo contracts separately within authorized scope. |
| A2 — Products views | Extract controlled overview/forms/options/photo/catalog UI without moving state or changing requests. Visual and interaction parity. |
| A3 — coordination | Extract stock recovery/detail coordination; standardize only demonstrated async/protected-failure/dialog reuse. Preserve UUID/lifetime/draft semantics. |
| A4 — shared auth/API | Move authenticated request/session/profile primitives behind stable exports; test all entry/callback/role cases. |
| A5 — ownership/naming | Move Products/Sales/Inventory domain/components/tests incrementally; update lazy imports and script registration; remove confirmed obsolete code separately. |
| A6 — CSS ownership | Separate shared surfaces/tokens first, then feature CSS; preserve cascade and responsive screenshots. |

Each stage should be independently reviewable and committable in a future approved implementation. This audit performs none of them.

## 35. Estimated risk of each stage

A1 medium: changes draft reconciliation and external update behavior. A2 low/medium: prop wiring/focus/DOM differences. A3 medium/high: asynchronous completion, locks and recovery storage. A4 medium/high: shared authentication touches nearly every feature. A5 medium: mechanical moves can break lazy routes/test registration. A6 medium/high: implicit cascade dependencies and responsive rules. A complete all-features migration at once is high risk and not recommended. Effort estimates would need a chosen scope; these are risk estimates, not promised schedules.

## 36. Tests that should protect each refactor stage

| Stage | Required protection |
| --- | --- |
| A1 | Color-only open variant draft + bulk price + save; intentional unsaved price conflict; two-tab committed update/freshness; attachment unavailable/removal if in scope. |
| A2 | Product create/detail/edit/photo/bulk selection; keyboard labels/focus; 390/768/1024/1366/1440 layout; no horizontal overflow. |
| A3 | Lost response same UUID, reload/remount, cross-tab same/different variants, metadata migration, unavailable storage/Web Locks, late completion; out-of-order GET/unmount; navigation dirty guards. |
| A4 | Session restoration, expired/missing token, OWNER/WAREHOUSE/SUPER_ADMIN, pending/inactive account, login/logout, signup/recovery/invitation callback handling, safe errors/rate limits. |
| A5 | Import graph, lint, unit discovery, all lazy route navigation/reload; POS cart/checkout and return/exchange/void identity; inventory/restock/report flows. |
| A6 | Previously covered responsive screenshots plus Sales/Inventory/Dashboard/auth rendering, keyboard focus, dialog scroll restoration and stylesheet chunk/load order. |

Keep exact money and strict business-date unit tests in every affected stage. Frontend tests cannot replace backend tenant/authorization/transaction tests if an implementation changes API behavior. This audit authorizes no API changes.

## 37. Final recommended architecture principles for SaaS2

Use one owner per workflow and one deliberate reconciliation contract per resource. Keep backend authority for tenants, permissions, inventory ledger and financial history. Keep exact money separate from business summaries; business dates separate from timestamps. Pages compose feature state/views; shared libraries and UI stay feature-independent. Preserve injected dependencies and explicit operation identity. Use hooks for coherent React coordination, not to hide complexity. Prefer staged evidence-backed improvements over comprehensive folder rearrangement.

## 38. Git status confirmation

At the initial snapshot, the workspace contained uncommitted Products implementation/tests and phase/audit reports. Their source contents were preserved. At the final check, `git status --short` listed only the report below; the earlier changes were no longer listed. Git state changed during the audit without a commit/staging/revert operation by this agent. The only new file created by this architecture audit is:

`docs/frontend-architecture-audit-2026-09-29.md`

All 203 baseline hashes (frontend source/configuration, backend source and Prisma files) matched at completion. Final unstaged and staged tracked diffs were empty. No commit, staging, revert or cleanup of the existing work was performed by this agent.

## 39. Confirmation that no source/backend/database/PDF changes were made

No frontend source/config/test, backend source, Prisma schema or migration was changed by this audit. No database operation, migration, deployment or generated build was run. The protected `planing/SaaS2_Clothes_Implementation_Summary.pdf` was not inspected or touched. Only this Markdown report was added. All refactor recommendations remain unimplemented pending the user's decision.
