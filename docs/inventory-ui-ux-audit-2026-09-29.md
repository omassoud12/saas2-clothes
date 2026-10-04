# Inventory — UI/UX audit

Date: 2026-09-29. Audit only: no application code, database or business data
changed. Existing implementation changes remain untouched.

Evidence: current InventoryPage, receiving form/matrix/history, audit sections,
creation form and their CSS. A temporary offline browser probe captured the list
and receipt review at 390, 768 and 1366px, plus a two-color/eight-size receipt at
390px. Visually inspected desktop/mobile lists and mobile review/dense receipt.
The probe passed execution; it deliberately measured overflow rather than
asserting its absence. APIs are fixtures, not live database requests. Temporary
probe removed; selected screenshots saved under `inventory-ui-review`.

## Overall assessment

The new receiving matrix matches the business task better than separate restocks.
The surrounding page still combines the older inventory presentation with the
new Products styles. Density, consistent hierarchy and separation of frequent
work from audit tools need improvement. More colors or decoration would not
solve the main problems.

## Findings, ordered by priority

### 1. P2 — Dense receiving causes page-level horizontal overflow on mobile

At a 390px viewport, the two-color/eight-size fixture produced a 497px document
width. The matrix's scroll width was 512px. The screenshot shows blank space
outside the main page, even though the matrix itself has overflow-x:auto.
Horizontal scrolling inside a wide table is reasonable; widening the entire
page disrupts navigation and scanning.

Recommendation: constrain the receiving panel and scroll container in the page
layout; keep only the table horizontally scrollable. Keep the color identifier
visible while scrolling and provide a short scroll hint. Verify 4 colors × 6–8
sizes, long custom names, keyboard scrolling and zoom.

Evidence: `VariantQuantityMatrix.jsx`; `receiving.css:1–5`; dense-390 screenshot.
The exact CSS ancestor responsible needs an implementation-level check; this
audit confirms the observed overflow, not an untested root-cause fix.

### 2. P2 — Receipt-mode heading squeezes description into a narrow column

Inventory's heading has four direct children: eyebrow, title, description and
New product button. Receipt mode adds products-page, whose mobile heading rule
keeps these children in a horizontal row. At 390px the description wraps almost
word by word, consuming substantial height before the actual receiving form.
The ordinary list uses a different mobile header arrangement.

Recommendation: group title/description into one identity block, put the action
beside it on desktop and below it on mobile. In an active receipt, prioritize
the selected product and a clear return action instead of another New product
action.

Evidence: `InventoryPage.jsx:113–119`; `products.css:148–151`; review-390.

### 3. P2 — Receive stock and Restock compete without explaining the difference

Each product has a full-width filled Receive stock button, while every option
also has a filled Restock button. The UI does not identify Restock as the older,
single-option workflow. Users can reasonably wonder which action to use for
the same delivery. On desktop, the null-cost option additionally shows Set cost;
its Restock button wraps to another row, making the layout inconsistent.

Recommendation: make Receive stock the clear normal purchase action. Put legacy
single-option restock and setting cost without quantity changes behind a named
secondary disclosure. Keep access to legacy tools, but explain their purpose.

Evidence: `InventoryPage.jsx:132–138`; list-1366 screenshot.

### 4. P2 — The starting list is much too tall for selecting a product

Every option is expanded into a bordered, padded card with repeated stock/cost
labels and actions. On mobile, the grid becomes one column. The three-product,
three-option fixture plus the history tools occupies about 5,357px of page height.
Even the desktop fixture is about 3,055px tall. These are fixture measurements,
not production averages.

Recommendation: start with compact product rows containing image/name/category,
available pieces, option count and Receive stock. Expand a selected product's
stock overview locally. The receipt matrix remains the place for entering a
delivery, rather than expanding every option on the starting screen.

Evidence: `index.css:696–701,754`; list screenshots at 390/1366px.

### 5. P2 — Receipt review does not have a distinct visual hierarchy

The review currently adds a muted paragraph with quantity/total and another
paragraph asking the user to review. Fields remain editable, and changing them
correctly resets confirmation, but there is no prominent review panel or
itemized summary distinguishing newly received pieces from current stock.
The total is visually comparable to ordinary explanatory text.

Recommendation: show a compact review block with product, affected color/size
quantities, common cost, total pieces and total purchase amount. Use an explicit
Confirm receiving action. Keep current stock and received quantity distinctly
labeled. A live total before review would help users catch quantity mistakes
earlier; it should remain an estimate until backend confirmation.

Evidence: `StockReceiptForm.jsx:42,65–69`; review-390 screenshot.

### 6. P2 — Styling changes when entering receiving

The list's product/section headings use Georgia and larger legacy spacing.
Receiving switches the entire Inventory section into products-page, changing
heading font, controls, panel padding and text sizing. It feels like entering a
different design system while remaining in Inventory.

Recommendation: define consistent Inventory typography and panel/control styles
for list, create, receiving and history. Retain the green brand palette; use
scope-specific layout rather than switching page-wide styling by mode.

Evidence: conditional class in `InventoryPage.jsx:113`; `index.css:643`;
`products.css:3–22`; list-1366 versus review-390.

### 7. P2 — Recovery banner does not identify the pending delivery

The banner says Receiving awaiting confirmation and explains safe retry, but
does not show the product name, quantities, total, operation timestamp or an
accessible review of the preserved request. After reload, users lack the context
needed to confidently retry. This is a source-review finding; the new audit
probe did not simulate a lost response.

Recommendation: show bounded, role-appropriate pending-operation details and
a local Retry same operation progress state. Retain the existing safe replay
behavior; do not offer an unsafe “start again” for an uncertain operation.

Evidence: `InventoryPage.jsx:116`; persisted receiving request structure.

### 8. P2 — Error and save-only messages can look like successful receiving

The general feedback area always uses success-message styling. Failed product
preselection and a rejected original receiving request can populate that same
area. Save product only also invokes the generic “Receiving operation confirmed”
success copy. Green therefore does not consistently mean what the text implies.
These states were identified from source, not visually exercised by this probe.

Recommendation: carry message kind with the text. Use green for successful saves,
amber for pending/rejected operations needing review and red for errors. Say
“Product saved with zero stock” for save-only. Continue using text/icons so
status does not depend on color alone.

Evidence: `InventoryPage.jsx:73,86–98,121`; `StockReceiptForm.jsx:23–29`.

### 9. P2 — Receiving, movement history and reconciliation all stay expanded

After the long stock list, three separate sections show history, repeated filter
forms and pagination/refresh actions, including when empty. Routine receiving
and occasional reconciliation have equal structural prominence. Users must
scroll through unrelated work to reach another tool.

Recommendation: separate Stock & receiving, Receiving history, Movement history
and Stock check using clear tabs or disclosures. Preserve current filters while
switching views. Show empty-history pagination only when useful. Receipt history
would benefit from product/date filtering for finding an earlier delivery.

Evidence: end of `InventoryPage.jsx`; ReceiptHistory and InventoryAuditSections;
list-1366 screenshot.

### 10. P3 — Option identity is led by SKU rather than color/size

The bold text is ITEM-…; Navy / S appears below in smaller muted text. Stock and
purchase cost labels are also small (legacy .7rem). This puts internal codes
ahead of the identifiers staff use when counting garments. Receipt-matrix colors
are text-only despite creation already offering swatches.

Recommendation: make color/size the primary identity and SKU secondary or
disclosed. Use consistent working text around 13–14px and reduce repeated
containers to gain density. Reuse named-color swatches while retaining names
and a neutral fallback for custom colors.

Evidence: `InventoryPage.jsx:134–136`; `index.css:699–700`; matrix component.

### 11. P3 — Creation has no clear step indicator or return to definition

Continue moves from defining the product to a receiving heading. There is no
visible “1. Product / 2. Quantities & cost / 3. Review” indicator, and the next
step offers Cancel rather than returning to edit the unsaved product definition.
Warehouse's save-only step is also headed “receiving” despite having no receipt.

Recommendation: show a short, role-aware step indicator and preserve the
definition when returning to edit it. Title Warehouse's step as product review.
Update “add a product in the catalog” in the empty Inventory state to match the
new creation location.

Evidence: ProductCreateForm onDefine; `StockReceiptForm.jsx:61–69`;
`InventoryPage.jsx:130`.

## What works

- Colors as rows and sizes as columns match the receiving task.
- Quantities start blank, with current stock separately labeled.
- Shared purchase cost and explicit confirmation reduce repetitive entry.
- Search, product photos and named receiving action are discoverable.
- White/neutral surfaces and dark green navigation provide a coherent base.
- Ordinary three-size receipt review had no page-level horizontal overflow at
  390, 768 or 1366px; the dense case exposes a separate responsive issue.
- Receipt matrix fields have accessible color/size names; a focusable table
  region and focused receipt heading support keyboard navigation.

## Recommended order

1. Fix dense mobile overflow and receipt-mode heading layout.
2. Make normal receiving distinct from legacy Restock/Set cost.
3. Compact the product picker and separate history/reconciliation views.
4. Give review/recovery meaningful summaries and consistent status colors.
5. Unify typography, option identity and creation-step navigation.

Keep the existing green identity. Color is mainly a consistency issue here,
not a reason to invent a new palette. No fresh contrast certification, screen
reader audit, live receiving mutation or production performance test was done.

## Saved visual evidence

- [Desktop list](inventory-ui-review/list-1366.png)
- [Mobile receipt review](inventory-ui-review/review-390.png)
- [Mobile eight-size overflow](inventory-ui-review/dense-390.png)

Only this report and the three evidence images were added by this audit.
