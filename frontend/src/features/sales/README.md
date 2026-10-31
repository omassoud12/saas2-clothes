# Sales UI

This folder contains the responsive Sales/POS screen.

## Structure

- `sales-catalog.js`: authenticated adapter from real Category, Product and ProductVariant API records to the UI model.
- `mock-sales-data.js`: test fixtures only; production rendering does not import or display them.
- `mock-sales-storage.js`: persists only the unfinished cart and a checkout that may not have reached the server (with its Idempotency-Key), per account and user. Catalog records and receipts are never copied to browser storage.
- `mock-sales-model.js`: pure cart, stock, category and totals operations.
- `pos-checkout.js`: cart to `POST /api/sales` mapping, checkout error handling and cart/catalog comparison.
- `MockSalesScreen.jsx`: real catalog loading, page composition, filtering, voice search and UI state.
- `MockSalesSheets.jsx`: product picker, cart, history and category bottom sheets.
- `pos-receipt.js` / `SaleReceipt.jsx`: the receipt shown after a sale, its WhatsApp text, share handoff and print copy (`@media print`, 58mm/80mm/A4).
- `MockSalesSheet.jsx`: reusable accessible sheet shell.
- `mock-sales.css`: page-scoped responsive, dark-mode and RTL styles.

Products, categories, prices and stock are read from the authenticated store APIs. Category creation, rename and product reassignment also use the existing tenant-scoped APIs. Completing a sale calls `POST /api/sales` (see `pos-checkout.js` and `sale-flow.js`): the cart is mapped to `{ variantId, quantity, unitSoldPrice }` lines, an OWNER discount is applied to each unit price, and one Idempotency-Key is kept until the sale is confirmed so a retry never duplicates it. Today's sales and the history sheet are read from `GET /api/sales`. Payment method, discount fields and a sequential receipt number are not stored by the backend yet; the receipt number is the first 8 characters of the sale id.
