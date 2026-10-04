# SaaS2 frontend UX writing audit — 2026-09-29

Scope: current frontend JSX/JS, user-visible error maps, CSS generated text, `frontend/index.html`, and the public landing page. This is a source-based copy audit, not a live user study. Recommendations below are **not implemented**. Product and Inventory behavior described here is the current local implementation; deployment is unverified.

## 1. Executive UX writing verdict

The operational UI is mostly direct and useful, especially the new receiving review and explicit retry language. The main weakness is that old “restock/variant” vocabulary and technical finance language remain alongside the newer product definition and batch-receiving flow. There is no confirmed P0 copy defect. Three P1 clusters need attention before wider rollout: stock corrections described as adding stock, save-only recovery described as receiving, and dashboard/landing guidance pointing to the old creation path.

## 2. Current tone of voice

Generally calm and professional. It shifts to developer language in Reports (“authoritative report contract”), Inventory errors (“response was invalid”), and onboarding/status placeholders. Labels also shift between title case and sentence case.

## 3. Recommended tone of voice

Clear, direct, calm, operational English. Name the object and result; give one next step when action is needed. Explain accounting terms once without changing their meaning. Avoid playful language and internal implementation details.

## 4. Terminology consistency problems

“Variant,” “option,” and “color / size” refer to the same sellable unit. “Restock” still names the legacy one-option purchase flow, while “Receive stock” names the new batch flow. “Add stock” in Products means a count correction, not a purchase. “Unit cost,” “purchase unit cost,” and “purchase cost per piece” vary. “Login” and “Sign in,” “Apply” and “Apply filters,” “pieces” and “units,” and capitalization of Product/Sale/Restock vary. [Inventory](../frontend/src/pages/app/InventoryPage.jsx), [Products](../frontend/src/pages/app/ProductsPage.jsx), [movement labels](../frontend/src/features/inventory/inventory-audit-flow.js), [landing](../frontend/src/pages/LandingPage.jsx).

## 5. P0 copy issues

None confirmed by source review. The risky stock-action ambiguity is P1 because the visible `+` control has correction context, although its accessible name lacks it. No unsafe accounting claim should be introduced through a text-only fix.

## 6. P1 copy issues

1. **MICROCOPY / ACCESSIBILITY:** Products `+` / `−` use “Add stock” / “Remove stock” accessible names while creating **ADJUSTMENT** movements. Change to “Correct count: add one piece” / “Correct count: remove one piece”; retain a nearby visible “Count correction” heading or helper, including on touch devices where title hover is unavailable. [Products](../frontend/src/pages/app/ProductsPage.jsx).
2. **SYSTEM FEEDBACK:** A save-only product operation can show “Retry same receiving operation,” and rejection says “No receipt was saved” even when no receipt was intended. Branch copy on save-only vs receiving; preserve the same operation identity in either path. [receipt presentation](../frontend/src/features/inventory/ReceiptPresentation.jsx), [receipt form](../frontend/src/features/inventory/StockReceiptForm.jsx), [Inventory](../frontend/src/pages/app/InventoryPage.jsx).
3. **EMPTY STATE / MARKETING:** Dashboard’s no-products action opens Products, though Inventory owns creation; landing workflow still says “Add categories, products, and variants” / “Record restocks.” Route and language should identify Inventory for new definitions and batch receiving. [Dashboard](../frontend/src/pages/app/DashboardPage.jsx), [landing](../frontend/src/pages/LandingPage.jsx).

## 7. P2 copy issues

Reports exposes “authoritative totals/contract,” date-conversion explanations and repeated unexplained “COGS.” Movement filters use “Variant” and SKU rather than color/size. Products catalog and messages use “variant” alongside “option.” Errors such as “response was invalid” explain implementation rather than recovery. Inventory legacy Restock and normal Receive stock are not clearly separated. [Reports](../frontend/src/pages/app/ReportsPage.jsx), [audit sections](../frontend/src/features/inventory/InventoryAuditSections.jsx), [product flow](../frontend/src/features/products/product-flow.js).

## 8. P3 polish issues

“Recent Sales,” “No Sales yet,” “Active Products,” “Saving Restock...” and “Confirm Restock” have inconsistent capitalization. Generic “Apply,” “Add,” “More,” and “Refresh images” require context; “Back / edit quantities” is awkward. `1 pieces`, `0 pieces received`, and mixed “units/pieces” need contextual pluralization. Date display uses locale defaults, so punctuation and ordering vary. These are polish unless they cause a wrong action.

## 9. Navigation copy audit

Dashboard, Products, Categories, Inventory, Sales / POS, Returns, Exchanges, Expenses, Reports are understandable. “Inventory” now handles both product creation and receiving, which is discoverable only through its page heading and Products shortcut. Keep the nav label, but reinforce “New product” and “Receive stock” in page actions. Returns/Exchanges are route pages that send the user to sale history; their descriptions should explicitly say so. [app navigation](../frontend/src/app/AppLayout.jsx), [Returns](../frontend/src/pages/app/ReturnsPage.jsx), [Exchanges](../frontend/src/pages/app/ExchangesPage.jsx).

## 10. Page title/subtitle audit

Inventory and Products headings are clear. Inventory’s default “Find a product, receive stock, and review inventory history” omits its new creation responsibility. Reports’ “backend-calculated” description and “authoritative” language are developer-facing. Dashboard’s zero-product guidance is outdated. Auth password setup says “Invitation sessions are verified,” which is internal language. Keep titles short and use subtitles for one user action. [Inventory](../frontend/src/pages/app/InventoryPage.jsx), [Reports](../frontend/src/pages/app/ReportsPage.jsx), [Set password](../frontend/src/pages/SetPasswordPage.jsx).

## 11. Button / CTA audit

Strong: “Save product only,” “Review receipt,” “Confirm receiving,” “Retry photo only,” “Void sale.” Improve “Confirm product only” → “Create product with zero stock”; “Back / edit quantities” → “Edit quantities”; generic “Apply” in Expenses → “Apply dates”; result-card “Add” in Sales/Exchanges → “Add to cart” where space permits; “Refresh images” → “Refresh products” if it reloads the catalog. Keep Review and Confirm distinct. [receipt form](../frontend/src/features/inventory/StockReceiptForm.jsx), [Expenses](../frontend/src/pages/app/ExpensesPage.jsx), [Sales](../frontend/src/pages/app/SalesPage.jsx).

## 12. Form label audit

Product name, category, color, size, selling price, and purchase cost are recognizable. Prefer “Purchase cost per piece (USD)” consistently over “Purchase unit cost” / “Unit cost.” Use “Color / size” in Inventory filters instead of “Variant”; show color and size in choices before SKU. Quantity matrix inputs have per-cell accessible names, but the generic “Receiving now” could be “Quantity to receive: Black / M.” Currency is already visible in key cost/price forms; retain this.

## 13. Placeholder audit

Examples such as “e.g. Linen shirt,” “e.g. Black,” and “e.g. 38” support visible labels. “0” in quantity cells is acceptable only because the matrix heading and accessible labels provide purpose; blank and zero behavior is explained below. “Start typing to find an item” and “Search inventory” are supplementary, not replacements for labels. “Add an operational note” sounds internal; “Why is this item being returned? (optional)” is clearer. [Product form](../frontend/src/features/products/ProductCreateForm.jsx), [matrix](../frontend/src/features/inventory/VariantQuantityMatrix.jsx), [sale lifecycle](../frontend/src/features/sales/SaleLifecyclePanel.jsx).

## 14. Helper text audit

“Blank or zero adds nothing” prevents a costly misunderstanding. “One cost for all received pieces” belongs beside cost. Product option helper “Save this option, then use + to add one piece” obscures that `+` is count correction and purchasing belongs in Inventory. Restock’s “up to four decimals” is accurate but better in validation guidance than repeated prose. Remove only redundant explanations after maintaining clear action context.

## 15. Error message audit

Good: duplicate color/size and invalid quantity errors name the fix. Weak: “Something went wrong. Please try again,” “response was invalid,” “This key belongs to different details,” and raw caught `error.message` in receipt submission. Prefer object-specific errors and safe retry guidance; avoid key/response terminology. Preserve the distinction between a **confirmed rejection** (correct and submit anew) and an **unknown result** (retry original operation). [product flow](../frontend/src/features/products/product-flow.js), [receipt flow](../frontend/src/features/inventory/stock-receipt-flow.js), [receipt form](../frontend/src/features/inventory/StockReceiptForm.jsx).

## 16. Success message audit

“Product saved,” “Stock received successfully,” “Sale voided and stock restored,” and “Selected option prices updated together” state outcomes. “Stock saved” after a count correction should say “Count corrected” and include signed change. Legacy “Restock completed” should say “Single-option purchase received” if the UI retains that path. Avoid implying photo upload succeeded when only the product/receipt succeeded; the current photo-only retry correctly separates those outcomes.

## 17. Pending / recovery message audit

“Awaiting confirmation” correctly marks unknown outcomes, not failure. Recovery should use “Retry the original product save” for save-only and “Retry the original receiving request” for receipt; do not use a single receiving label. “Another tab is confirming this receipt” also needs save-only branching. Operation IDs belong behind the existing disclosure, not in primary guidance. Do not rename retry to “Try again” because the same idempotency key matters. [receipt presentation](../frontend/src/features/inventory/ReceiptPresentation.jsx), [receipt form](../frontend/src/features/inventory/StockReceiptForm.jsx).

## 18. Empty state audit

Inventory “No products yet” includes a next action. Products has an Add product shortcut. Dashboard “No active Products” sends users to Products instead of Inventory; this is the most important empty-state fix. Reports “Choose report dates” gives a task but “Submit the date controls” is unnatural; “Choose a date range, then select View report” is clearer if the actual CTA matches. Expenses no-results state should point to changing dates or clearing filters.

## 19. Loading state audit

Most messages name their object: “Loading products,” “Loading movement history,” “Calculating financial report.” “Working,” “Saving,” and “Confirming original operation” are mixed but action-specific wording is preferable. Use ellipsis consistently (currently three dots and Unicode ellipsis both occur). “Loading recent Sales” should be “Loading recent sales.” Keep loading text near the affected section, not as a global success/error.

## 20. Confirmation dialog audit

Product/option deactivation and image removal use named actions. Sale void confirmation explains complete reversal and stock restoration. Receiving review shows quantities and exact purchase total before confirmation, which is strong. Save-only review must say no stock/cost is recorded. The label “Confirm product only” is the weak spot; name the actual result. [catalog confirmation](../frontend/src/features/products/CatalogConfirmation.jsx), [sale lifecycle](../frontend/src/features/sales/SaleLifecyclePanel.jsx), [receipt review](../frontend/src/features/inventory/ReceiptPresentation.jsx).

## 21. Destructive-action copy audit

“Deactivate” accurately differs from delete; historical records remain. “Remove image” removes association, but cleanup can fail, so partial-outcome copy should stay explicit and avoid “image deleted.” “Void sale” accurately names the financial reversal; keep stock-restoration consequence in the confirmation. “Clear cart” and “Discard” need object-specific consequence when the surrounding dialog does not already supply it.

## 22. Products terminology audit

Use “Color / size option” in headings and explanations; use “option” in compact counts; reserve “variant” for SKU-oriented technical detail if necessary. “Sellable” should mean active, in stock, and priced, independently of pending historical cost. “Cost pending” should link to Inventory without implying selling is blocked. Product count-correction controls must explicitly say “count correction,” not “Add stock.” [Products](../frontend/src/pages/app/ProductsPage.jsx), [product components](../frontend/src/features/products/ProductComponents.jsx).

## 23. Inventory terminology audit

Define three distinct actions: **Create product** = definition only, zero stock; **Receive stock** = purchased quantities plus shared purchase cost; **Correct count** = +/- one piece, recorded as adjustment. Legacy one-option Restock still creates a purchase movement and must be labeled as “Receive one option” or “Single-option purchase” if exposed, not conflated with a count correction. “Receipt history” and “Movement history” are useful separate views; a receipt is a purchased batch, a movement is each stock change. [Inventory](../frontend/src/pages/app/InventoryPage.jsx), [legacy dialog](../frontend/src/features/inventory/RestockDialog.jsx).

## 24. Sales terminology audit

“Complete sale,” “Create return,” “Create exchange,” and “Void sale” are clear and distinct. “Expected refund” is a preview, not a promise; retain this qualifier. Exchange difference should label who pays/receives where business rules support it; a signed amount alone can be ambiguous. Variant cards show SKU before color/size and use “Add”; reverse the visual/copy priority for clothing staff. “Stock conflict” errors should name refresh/review of the affected item. [Sales](../frontend/src/pages/app/SalesPage.jsx), [sale lifecycle](../frontend/src/features/sales/SaleLifecyclePanel.jsx).

## 25. Finance terminology audit

Use “Cost of goods sold (COGS)” on first mention per page, then COGS. Keep gross revenue, net revenue, expenses, and net profit distinct. “Authoritative” and “report contract” describe implementation, not financial meaning. “Stock valuation is not available in this report” is enough if value is genuinely unavailable; do not claim a valuation. Date range language should reflect business dates without timezone jargon. [Dashboard](../frontend/src/pages/app/DashboardPage.jsx), [Reports](../frontend/src/pages/app/ReportsPage.jsx), [Expenses](../frontend/src/pages/app/ExpensesPage.jsx).

## 26. Role-specific copy issues

Warehouse can define zero-stock products but cannot enter purchase cost/receive; its create/review copy mostly reflects this. Owner-only cost data should remain absent for Warehouse, including recovery summaries. The generic Product option helper telling Warehouse “An owner can set ... and add stock” is correct but should direct them to the owner rather than an unavailable control. Super-admin and account-status screens expose raw `REJECTED`/`SUSPENDED` values in some summaries; use user-readable labels. [Inventory](../frontend/src/pages/app/InventoryPage.jsx), [Product components](../frontend/src/features/products/ProductComponents.jsx), [Account status](../frontend/src/pages/AccountStatusPage.jsx).

## 27. Accessibility text audit

Product catalog’s “View product: [name]” is clear. Matrix inputs include color and size, and loading spinners have labels. Products +/- accessible names omit count-correction semantics and the exact option; recommend “Correct Black / M count: add one piece.” Repeated “More” disclosures have specific aria labels in Products. Image placeholders distinguish absent/unavailable photos. Beware screen-reader duplication when button `aria-describedby` repeats all catalog summary text. [Products](../frontend/src/pages/app/ProductsPage.jsx), [matrix](../frontend/src/features/inventory/VariantQuantityMatrix.jsx).

## 28. Marketing/landing copy audit

The hero’s “one connected system” is restrained. Feature claims about owner controls and sales reports broadly match implemented paths, but workflow statements about creating through Products and routine “restocks” are stale. The mock preview is explicitly illustrative; keep that qualifier near invented numbers. Align CTA capitalization “Create Account”/“Login” with app sentence case “Create account”/“Sign in.” Do not add unsupported speed, automation, or profitability claims. [landing](../frontend/src/pages/LandingPage.jsx), [HTML metadata](../frontend/index.html).

## 29. Placeholder/Lorem/TODO findings

No visible Lorem ipsum found in the reviewed frontend source. Confirmed obsolete placeholder copy exists in [AuthenticatedStatusPage](../frontend/src/pages/AuthenticatedStatusPage.jsx): “Account approval tools can be added here next” and “The business dashboard can be connected here next.” The current router appears to use the dedicated app/dashboard and account-status pages; verify reachability before assigning user impact, but remove this stale copy in a later pass. Example values in form placeholders are intentional, not forgotten content.

## 30. Duplicated copy findings

“Loading categories,” “Add a category first,” session expiration, retry/refresh, cost-unavailable, and stock-recovery guidance recur across page and flow layers. Standardize the few domain-critical messages in their owning feature; do not centralize generic “Cancel” or “Try again” solely for reuse. Text duplication is secondary to meaning/context consistency.

## 31. Copy ownership findings

Page JSX owns headings, empty states, and workflow instructions; feature components own form labels and dialogs; flow modules own validation/API error maps; shared UI owns generic states. This is workable. Place receiving terminology and recovery variants inside the Inventory feature, product option terminology in Products, and neutral global auth language in auth helpers. Avoid a broad i18n architecture during copy fixes.

## 32. Future Arabic localization risks

Concatenated messages embed English order and plural fragments (`option${n === 1 ? '' : 's'}`, “Started [date],” sale/return IDs and price fragments). JSX builds sentences across elements; date/currency formatting relies on browser locale. A later localization pass will need message-level templates and explicit locale-aware formatters. No Arabic/i18n implementation is proposed now.

## 33. Top 20 highest-value copy changes

| # | Current | Recommended | Why |
|---:|---|---|---|
| 1 | “Add stock” (Products `+`) | “Correct count: add one piece” | Distinguishes adjustment from purchase. |
| 2 | “Remove stock” (Products `−`) | “Correct count: remove one piece” | States accounting intent. |
| 3 | “Retry same receiving operation” for save-only | “Retry the original product save” | No receipt was involved. |
| 4 | “No receipt was saved” for save-only rejection | “Product was not created. Review the details.” | Accurate outcome. |
| 5 | Dashboard “Open Products” in zero-product state | “Create product in Inventory” | Correct destination/action. |
| 6 | Landing “Record restocks” | “Receive purchased stock” | Names main flow. |
| 7 | Landing “Add categories, products, and variants” | “Set up categories; define products and sizes in Inventory” | Matches ownership. |
| 8 | “Confirm product only” | “Create product with zero stock” | Names result. |
| 9 | “Back / edit quantities” | “Edit quantities” | Short and specific. |
| 10 | “Stock saved” after +/- | “Count corrected: Black / M +1 piece” | Specific result. |
| 11 | “Restock variant” | “Receive one color / size” | Separates legacy single-option purchase. |
| 12 | “Variant” in Inventory filter | “Color / size” | Staff can identify product option. |
| 13 | “All variants” with SKU-only choices | “All colors / sizes” and labeled choices | Reduces SKU recall. |
| 14 | “Stock reconciliation response was invalid” | “Stock check could not load. Refresh and try again.” | Actionable, nontechnical. |
| 15 | “This key belongs to different details” | “This request differs from the original. Review the pending operation.” | Hides implementation term. |
| 16 | “All authoritative totals are zero” | “No financial activity for this period.” | Removes internal assurance. |
| 17 | “Stock valuation is not part of the current authoritative report contract” | “Stock valuation is not available in this report.” | Clear limit. |
| 18 | “COGS” first mention | “Cost of goods sold (COGS)” | Explains abbreviation. |
| 19 | “Login” landing CTA | “Sign in” | Matches auth form. |
| 20 | “Account approval tools can be added here next” | Remove after reachability check | Obsolete placeholder. |

## 34. Recommended terminology dictionary

| Internal / inconsistent | Preferred user-facing term | Notes |
|---|---|---|
| Product | Product | General model. |
| ProductVariant / variant | Color / size option; “option” in counts | SKU can remain in details. |
| StockReceipt | Stock receipt / received delivery | A purchased batch. |
| RESTOCK (batch) | Receive stock | Normal purchase workflow. |
| Legacy Restock (one option) | Receive one color / size | If exposed. |
| ADJUSTMENT | Count correction | +/- one piece in Products. |
| InventoryMovement | Stock movement | History record. |
| currentStock | Current stock | Show pieces when numeric. |
| unitCost | Purchase cost per piece | Currency beside field. |
| sellingPrice | Selling price | Currency beside field. |
| Void | Void sale | Full sale reversal. |
| COGS | Cost of goods sold (COGS) | Expand first use. |
| Login | Sign in | Auth action. |

## 35. Recommended capitalization/punctuation rules

Use sentence case for headings, buttons, badges, and nav descriptions; preserve proper nouns, SKU, POS, and currencies. Use a single ellipsis style for progress labels. One sentence per helper/error where possible; end full sentences with periods, not button labels. Use “color / size” consistently in UI, preferably “color and size” in prose. Use singular/plural for product, option, piece, sale; format currency with the account currency and cost precision that the value actually supports.

## 36. Recommended error-writing rules

State object + failure + next action. Differentiate rejected, unavailable, and unknown-result states. Avoid code, keys, response schemas, stack traces, or raw exception messages. Keep server financial/auth meaning intact. For unknown receipt/stock results, instruct retry of the **original** operation, never creation of a fresh one.

## 37. Recommended success-message rules

Say what persisted, with a meaningful quantity or product if helpful. Split partial success (product saved, photo failed) from full success. Do not promise a changed stock amount until backend confirmation. Use “already processed; not applied again” for replay.

## 38. Recommended CTA-writing rules

Verb + object + outcome when needed. Review is pre-submit; Confirm commits. Prefer “Receive stock,” “Save product,” “Apply filters,” “Retry original request.” Keep short controls (`+`/`−`) only with visible context and complete accessible labels. Destructive labels name the object.

## 39. Pages/features requiring the most rewriting

1. Inventory recovery and legacy Restock terminology.
2. Products count-correction controls and option language.
3. Dashboard empty stock state.
4. Reports financial explanations.
5. Landing workflow and CTA consistency.
6. Inventory movement filters and error maps.

Auth and Sales need smaller focused edits; their core action labels are comparatively strong.

## 40. Safe implementation order for a later copy refactor

1. Resolve business-action terminology with owner/product stakeholder: receive vs count correction vs legacy one-option purchase.
2. Fix P1 action names and save-only/receipt recovery branching, then associated screen-reader labels.
3. Align Dashboard/landing destinations and workflow descriptions.
4. Simplify Reports and error maps without changing financial claims.
5. Normalize option labels, plurals, case, ellipses, dates, and mobile-length text.
6. Verify role-specific screens and screen-reader output, then run existing frontend/browser checks.

## 41. Git status

The working tree already contained uncommitted backend/Prisma, frontend, test, and Inventory report changes from the earlier authorized implementation. This audit adds only `docs/ux-writing-audit-2026-09-29.md`; it did not alter application source. The prior Inventory UI refactor was verified immediately before this audit: frontend unit 250/250, browser 73/73, ESLint, Vite build, and `git diff --check` passed. No live API, staging database, or production copy review was performed.

## 42. Confirmation

- Audit only for this phase; recommendations are not applied to UI.
- No frontend application source changes during this audit.
- No backend, database, or Prisma changes during this audit.
- No commit or deployment.
- `planing/SaaS2_Clothes_Implementation_Summary.pdf` untouched.
