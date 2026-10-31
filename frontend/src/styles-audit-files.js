// Stylesheets that the style tests check. A file is added to a list when it has been fixed, so a regression fails the build.

// styles-audit.test.js (phone sizes). An entry is a file, or { file, only } to check just the rules whose selectors match `only`.
export const SIZE_AUDITED = Object.freeze([
  'features/sales/mock-sales.css',
  'features/products/products.css',
  'features/products/product-polish.css',
  'features/products/product-catalog.css',
  'features/products/product-workspace.css',
  'features/inventory/entry-polish.css',
  'features/inventory/receiving.css',
  'styles/categories.css',
  'index.css',
  'styles/shell-phone.css',
  'styles/dashboard.css',
  'styles/product-base.css',
])

// tokens-audit.test.js (no hardcoded hex colors outside styles/tokens.css).
export const TOKEN_AUDITED = Object.freeze([
  'features/sales/mock-sales.css',
  'index.css',
  'styles/shell-phone.css',
  'styles/dashboard.css',
  'features/products/products.css',
  'features/products/product-polish.css',
  'features/products/product-catalog.css',
  'features/products/product-workspace.css',
  'styles/product-base.css',
  'features/inventory/receiving.css',
  'features/inventory/entry-polish.css',
  'styles/categories.css',
])
