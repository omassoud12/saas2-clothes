# Photo and name Sales / POS interface

## Scope and result

Sales / POS now opens with a photo grid and product names, without codes or prices on the catalog cards. The final name-only label follows the user's subsequent request to replace the displayed code with the product name. Selecting a card opens product details, color/size selection, quantity, price and exact total, with an explicit **Sell now** action. Products management and Entry retain their existing responsibilities and previous uncommitted UI work.

This is a local frontend change. No API contract, backend, schema, migration, authentication configuration, infrastructure or deployment changes were made.

## User flow

- Search by the existing name/SKU/barcode API filter, or select a category.
- Open a product by mouse, touch or keyboard. The desktop dialog contains the photo and options side by side; mobile uses a full-screen dialog with a scrollable body and a persistent total/action footer.
- A single color is preselected; a product with one option is ready immediately. Otherwise select the actual color/size before selling. Sold-out options are disabled, inactive variants are excluded, and duplicate size labels display their SKU for disambiguation.
- Quantity controls and direct numeric input honor known stock, quantities already in the local cart and the existing 1,000,000-unit limit.
- Prices appear in details. OWNER retains the existing sale-only price override; WAREHOUSE sees and submits the catalog price and cannot edit it. Missing purchase cost does not block a sale or get replaced with an invented cost.
- **Sell now** submits one normal Sale request through the existing sale workflow. With a cart already in progress, the product dialog instead offers **Add to cart**, avoiding an accidental separate receipt. Cart and Sales history are opened only when needed.
- The cart remains local until checkout. Adding an existing option merges its quantity; its existing sale price is restored in the details, with a note explaining that a changed price applies to the combined quantity.
- Success closes details, refreshes authoritative stock/history and leaves the search/category/page state intact. Refetch keeps the existing photo grid mounted; a sticky status message makes success visible when selling from lower catalog rows.

## Safety and accessibility

- Reuses `addVariantToCart`, `setCartQuantity`, `setCartPrice`, `calculateCart`, `checkoutOperation`, `submitSale` and `settleCheckout`. Monetary preview remains decimal-string/BigInt based; only integer quantity input uses Number.
- An immediate in-flight guard prevents repeated clicks from starting another checkout. An uncertain or malformed result freezes the selection and operation; **Retry same sale** reuses the same UUID and payload. Cart checkout has the same frozen retry behavior.
- A definite stock/price conflict refreshes available catalog data and requires a valid reviewed selection. A product disappearing from refreshed results disables the details sale action.
- Uses native modal dialogs with an inert background, explicit Tab/Shift+Tab containment, labelled headings, Escape handling, focus restoration and body scroll locking. Dismissal and editing are blocked while checkout is pending or uncertain.
- Stock and sold-out states use text; selection uses `aria-pressed`; totals announce changes; touch controls are at least 44px. Motion respects reduced-motion preferences.
- Product photos use the existing signed image URL, preserve aspect ratio, reserve square space and fall back to a neutral clothing placeholder on failure. No new image dependency or storage flow was added.
- Every real Sale still goes through authenticated, tenant-scoped backend authorization and the existing transaction. The frontend sends only the existing item payload; it supplies no tenant, seller, costs or profit fields.

## Files changed in this task

- `frontend/src/pages/app/SalesPage.jsx`
- `frontend/src/features/sales/SalesCatalog.jsx` (new)
- `frontend/src/features/sales/SaleDialog.jsx` (new)
- `frontend/src/features/sales/ProductSaleDialog.jsx` (new)
- `frontend/src/features/sales/sales-catalog.css` (new, Sales-scoped)
- `scripts/sales-catalog-ui.test.mjs` (new)
- This report.

## Verification

- After the name-only follow-up, the four existing responsive catalog/detail checks were updated and rerun: **4 passed** at 390/768/1280/1440px. Frontend lint, build and diff checks passed again. Only `SalesCatalog.jsx`, its scoped CSS, the label expectations in the existing browser tests and this report changed for that follow-up; sale behavior is unchanged.
- Frontend unit suite: **289 passed**.
- New offline Sales browser suite: **18 passed**. Covers 390/768/1280/1440px, a 320×568px screen, photo geometry, no catalog prices, keyboard focus, invalid/sold-out choices, OWNER/WAREHOUSE pricing, exact totals, explicit checkout payloads, double-click protection, identical uncertain retries, malformed responses, stock conflicts, optional multi-item cart, cart retry, history access, search preservation, empty/error states and retained-grid refresh with visible success.
- Existing Entry and Products polish browser suites: **21 passed** (9 Entry + 12 Products).
- Frontend lint: passed without warnings.
- Frontend production build: passed.
- Diff whitespace check: passed.
- Compared the existing protected-file hash baseline: **148 files unchanged**, including backend, Prisma, project instructions, architecture, protected PDF and the protected prior UI/business-flow files.
- Screenshots inspected for desktop/mobile catalog and product details. Test artifacts are under the operating-system temporary `saas2-products-qa/screenshots` folder (`sales-catalog-*` and `sales-details-*`).

Browser checks run against a local Vite fixture that intercepts authentication/API calls and blocks external services. Sale requests change only in-memory fixture records. No live Sale, database data, schema, Railway settings, deployment or commit was created by verification.

## Assumptions and limits

- The requested simplified interface applies to **Sales / POS**; existing-product management stays in Products.
- Each catalog card shows the existing Product name. SKU/barcode search and the selected option's SKU within details remain available. No identifier, product data or database field was changed.
- UI language follows the existing English interface. No translation system or payment/tender feature was introduced.
- Browser verification is local and offline, not a live production sale or a full cross-browser accessibility certification. Retry state remains in memory, consistent with the existing sale workflow; the browser should stay open until an uncertain sale is confirmed.

## Mobile dialog correction

The user's narrow-screen screenshot prompted a focused follow-up to the product details dialog. The previous layout inherited a 2rem top margin and gap from the global form style, used a large body photo, placed the two actions side by side, and used 15px inputs. Those choices made the mobile workflow crowded, especially with limited visible height.

- Mobile now shows a small photo beside the product name and a reachable close button. The large photo remains in the desktop body.
- Reset the quick-sale form margin/gap, constrain grid tracks and dialog width explicitly, and keep only the dialog body vertically scrollable. The modal uses the visible layout viewport width even below the app shell's existing 320px minimum; the rest of the app shell was not changed.
- Quantity and price occupy separate full-width rows, with 48px controls and 16px input text.
- **Sell now** is the first full-width action. **Add to cart** follows on a separate secondary row; total and actions remain outside the scrolling content.
- At heights below 500px, the header hides secondary category/eyebrow copy and limits the visible title to two lines, leaving room to scroll the focused input above the footer. The accessible product name is still complete.
- Sale validation, decimal totals, permissions, stock checks, API payloads and frozen retry behavior are unchanged.

Files for this correction: `ProductSaleDialog.jsx`, `sales-catalog.css`, existing `sales-catalog-ui.test.mjs`, and this report. Final verification: **23 offline Sales browser tests passed**, including five new checks at 240/280/320/360/390px with long product/category/SKU text, blank price, 568px and 380px heights, fully visible focused inputs, vertical-only scrolling and separate full-width actions. Lint, frontend build and whitespace checks passed. The protected 148-file baseline still matches, including backend, Prisma, architecture and the protected PDF. Screenshots inspected: `sales-mobile-fixed-*`, `sales-mobile-short-*` and the regular desktop/mobile details views in the existing temporary QA folder.

Reduced viewport height was simulated in local Chrome; this is not a physical-device virtual-keyboard or cross-browser certification. No live database writes, deployments, Railway changes or commits were performed.

## Compact mobile catalog filters

The subsequent catalog screenshot requested less scrolling. On mobile, Search and Category now share a single row in equal, constrained columns. The filter panel uses 10px padding, tighter labels and 44px controls with 16px text. The page heading uses smaller spacing/title text and hides its redundant explanatory sentence on mobile; Sales history and Cart remain together. The search placeholder is shortened to `Search…`, while name/SKU/barcode matching remains unchanged. Product cards now begin around 315–320px from the top in the 320–390px local browser fixtures, instead of the previous roughly 465px layout.

Files for this follow-up: `sales-catalog.css`, the placeholder in `SalesPage.jsx`, responsive expectations in `sales-catalog-ui.test.mjs`, and this report. The existing responsive checks now include 320/360/390/768/1280/1440px, asserting side-by-side non-overlapping mobile fields, retained touch target sizes, a filter panel below 90px and earlier catalog visibility. Final verification: **6 responsive checks passed**, plus lint, frontend build and whitespace checks. Screenshots were inspected at 320px and 390px. No sale, dialog, authorization, API or database behavior was changed.
