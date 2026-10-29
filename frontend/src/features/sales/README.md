# Sales UI

This folder contains the responsive Sales/POS screen.

## Structure

- `sales-catalog.js`: authenticated adapter from real Category, Product and ProductVariant API records to the UI model.
- `mock-sales-data.js`: test fixtures only; production rendering does not import or display them.
- `mock-sales-storage.js`: persists local prototype receipts only. Catalog records are never copied to browser storage.
- `mock-sales-model.js`: pure cart, stock, category and receipt operations.
- `MockSalesScreen.jsx`: real catalog loading, page composition, filtering, voice search and UI state.
- `MockSalesSheets.jsx`: product picker, cart, history and category bottom sheets.
- `MockSalesSheet.jsx`: reusable accessible sheet shell.
- `mock-sales.css`: page-scoped responsive, dark-mode and RTL styles.

Products, categories, prices and stock are read from the authenticated store APIs. Category creation, rename and product reassignment also use the existing tenant-scoped APIs. The redesigned cart checkout remains the local UI prototype requested for this screen; completing it does not call the Sales API or mutate real stock. Production checkout, inventory and accounting integration remain outside this UI pass.
