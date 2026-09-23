# SaaS2 Clothes - Architecture

## 1. Project

SaaS2 Clothes is a multi-tenant SaaS for clothing stores.

Each store is represented by one Account.
Business data from one Account must never be accessible by another Account.

---

## 2. Technology Stack

### Frontend
- React
- Vite
- TypeScript
- Tailwind CSS

### Backend
- Node.js
- Express
- TypeScript

### Database
- PostgreSQL hosted on Supabase
- Prisma ORM

### Authentication
- Supabase Auth

### Hosting
- Frontend: Vercel
- Backend: Railway
- Database: Supabase

### Storage
- Product images use a private Cloudflare R2 bucket. Other storage decisions
  remain outside this product-image infrastructure step.

---

## 3. Application Architecture

Frontend must never connect directly to privileged database operations.

Flow:

React Frontend
    |
    v
Node.js / Express API
    |
    v
Prisma
    |
    v
Supabase PostgreSQL

Authentication:

React
    |
    v
Supabase Auth
    |
    v
Access Token
    |
    v
Backend verifies authenticated user
    |
    v
Resolve role + accountId

---

## 4. Multi-Tenancy

The application uses:

Shared Database
Shared Schema
accountId-based tenant isolation

Every business entity must belong to an Account.

Examples:

- Category
- Product
- ProductVariant
- InventoryMovement
- Sale
- SaleItem
- SaleReturn
- SaleReturnItem
- Exchange
- Expense
- DailyReport

The frontend must never be trusted to decide accountId.

The backend resolves accountId from the authenticated user.

Account A must never access Account B data.

Tenant isolation must be enforced in:
1. Backend authorization
2. Database/RLS where applicable

---

## 5. Roles

### SUPER_ADMIN

Platform-level administrator.

Can:
- manage Accounts
- activate/deactivate Accounts
- access platform administration

SUPER_ADMIN does not belong to an Account.

### OWNER

Belongs to one Account.

Can:
- manage products
- manage variants
- manage categories
- view costs
- manage pricing
- restock inventory
- manage expenses
- access accounting
- access reports
- perform sales
- void sales
- process returns and exchanges
- manage Warehouse employee

An OWNER employee code is optional.

### WAREHOUSE

Belongs to one Account.

Can:
- view products
- create products
- create categories
- perform sales
- process returns and exchanges

An Account may have multiple WAREHOUSE employees. Each WAREHOUSE employee has
their own User account and a required employee code that is unique within the
Account.

Cannot:
- access accounting
- access expenses
- view sensitive costs/profit
- restock inventory in the MVP
- manage account-level settings
- void sales

Authorization must be enforced by the backend.
Hiding UI elements is not considered authorization.

---

## 6. Product Model

Product represents the general product.

For the MVP, Product has one primary image. PostgreSQL stores only the nullable
`Product.imageKey`, not image bytes, a public URL, or a signed URL. The backend
derives the canonical key `tenants/{accountId}/products/{productId}/main.webp`
from authenticated tenant context and a tenant-owned Product; the frontend
cannot choose the key or bucket. R2 credentials remain backend-only.

The backend accepts JPEG, PNG, and static WebP uploads up to 10 MiB. It rejects
animated and unsupported formats, validates decoded content rather than MIME or
extension, and caps decoded dimensions at 40 million pixels. Sharp auto-rotates,
resizes within 1600 × 1600 without enlargement, preserves aspect ratio, strips
unneeded metadata, and produces WebP at quality 82 and effort 4. The private
bucket is read through short-lived signed GET URLs (at most five minutes), never
persisted in PostgreSQL.

Product flows create the Product before deriving its image key. For a first
image, a failed database `imageKey` update after R2 upload triggers
best-effort R2 cleanup. Replacement overwrites the same canonical key: deleting
that key on a later database failure would remove the Product's existing image,
so the flow must reconcile or retry instead. R2 and PostgreSQL are not an atomic
transaction. To remove an image, the backend clears `imageKey` first, then
deletes the private object; a failed R2 deletion leaves an orphan for later
cleanup, never a database reference to a missing object. Product responses
contain a runtime signed `imageUrl` or `null`, not the raw key.

Product and Variant catalog APIs are available to active OWNER and WAREHOUSE
users only. The backend derives `accountId` and `createdById` from authentication
and scopes Product, Category, and Variant queries by Account. OWNER may see and
edit Product `profitMarginOverride` and see Variant `lastPurchaseCost`;
WAREHOUSE may not see or edit either field. Neither role may edit stock or
`lastPurchaseCost` through Product APIs. New Variants begin with stock zero and
null cost; inventory and Restock flows own subsequent changes. Products and
Variants are deactivated with `isActive = false`, never hard-deleted. Inactive
Products are omitted from the default active catalog/POS choices; inactive
Variants must likewise be excluded from future sellable choices. Historical
Sale, inventory, and return references remain intact and queryable.

Example:

Nike T-Shirt

ProductVariant represents the actual sellable inventory unit.

Examples:

Nike T-Shirt / Black / S
Nike T-Shirt / Black / M
Nike T-Shirt / White / L

Stock belongs to ProductVariant, not Product.

A variant can contain:

- size
- color
- SKU
- barcode
- currentStock
- lastPurchaseCost
- sellingPrice

ProductVariant.lastPurchaseCost is the unit purchase cost from the latest
successful RESTOCK and the current cost basis for the variant. It is not an
average cost or a total invoice amount.
ProductVariant does not store averageCost.

ProductVariant.sellingPrice is the normal/default catalog selling price for the
variant. OWNER owns catalog selling-price changes. WAREHOUSE may read the
catalog selling price but cannot set or update it. A WAREHOUSE Sale must use the
locked current catalog price; a differing submitted price is rejected as stale
or unauthorized pricing. An OWNER Sale may use an explicit positive per-line
price override without changing the catalog price.

SaleItem.unitSoldPrice is the actual price charged in a completed sale. It may
differ from ProductVariant.sellingPrice without mutating the catalog price.

SaleItem.unitCostAtSale is the immutable historical cost snapshot. Sale
creation must copy the current ProductVariant.lastPurchaseCost into this field.
If that cost is required and lastPurchaseCost is null, the sale must be rejected;
the application must never silently substitute zero.

Purchase/unit costs use Decimal(18,4) for ProductVariant.lastPurchaseCost,
InventoryMovement.unitCost, and SaleItem.unitCostAtSale. Catalog
ProductVariant.sellingPrice remains Decimal(18,2).

---

## 7. Inventory

Inventory history must never be lost.

InventoryMovement is the inventory ledger.

Supported movement concepts:

- RESTOCK
- SALE
- RETURN
- SALE_VOID
- DAMAGE
- ADJUSTMENT

RETURN and SALE_VOID movements restore stock. Every SALE, SALE_VOID, and RETURN
movement has exactly one matching SaleItem or SaleReturnItem reference, and
database partial unique indexes make those movements idempotent. There is no
EXCHANGE inventory movement type; an exchange is a Return plus a new Sale.

For RETURN and SALE_VOID movements, InventoryMovement.unitCost must equal the
original SaleItem.unitCostAtSale. Reversals never use the ProductVariant's
current cost.

currentStock is used for fast reads.

InventoryMovement is used as historical evidence explaining how stock changed.

Under correctly functioning stock workflows, each Variant's `currentStock`
equals the sum of its `InventoryMovement.quantityChange` values. The read-only
inventory reconciliation compares stored stock with this ledger sum and reports
`difference = storedStock - ledgerStock`; it surfaces mismatches without editing
stock or creating movements. The movement ledger remains append-only.

The tenant-scoped movement-history API is timestamp-based and cursor-paginated
by `createdAt DESC, id DESC`. OWNER may receive movement unit cost and note;
WAREHOUSE receives neither. Neither role receives idempotency metadata or raw
tenant identifiers from normal history responses. Reconciliation contains no
costs for either role. Status-filtered reconciliation must compute the ledger
sum before limiting results, so it may scan a large tenant ledger; unfiltered
pages aggregate only their bounded Variant page.

FUTURE PERFORMANCE FOLLOW-UP: Reconciliation status filtering may require
optimization for large tenant ledgers. Review measured query plans before
choosing indexes, precomputed state, or another strategy.

Stock must never become negative.

In the MVP, RESTOCK is OWNER-only. WAREHOUSE cannot create RESTOCK movements or
receive purchase-cost fields. A normal RESTOCK requires an active Product and
active Variant, a positive integer quantity, and a unit purchase cost greater
than zero with at most four decimal places. Free or promotional inventory needs
a separate, explicitly approved workflow. The future backend must atomically
increase ProductVariant.currentStock, set lastPurchaseCost to that RESTOCK's
unit cost, and append one RESTOCK InventoryMovement; failure rolls back all
three changes. RESTOCK movements require a positive unitCost and have no SaleItem
or ReturnItem reference.

Each RESTOCK requires a UUID idempotency key unique per Account and a canonical
SHA-256 request fingerprint. The future backend derives accountId and
performedById from authentication and hashes a UTF-8 JSON object with keys in
this fixed order: type, accountId, performedById, variantId, quantity, unitCost,
note. Use type "RESTOCK", lowercase canonical UUIDs, an integer quantity, a
decimal unitCost string normalized to exactly four fractional digits, and a
Unicode-NFC note trimmed at both ends (empty becomes JSON null). JSON null
represents an absent note. The hash is lowercase 64-character hexadecimal;
raw request JSON is not stored. An identical retry within the same Account
returns the original successful movement result without another stock change.
The same key with a different fingerprint is a conflict. A tenant-scoped unique
database index is the final concurrent-duplicate guard. Idempotency metadata
is part of the append-only movement record. In this MVP, SALE, RETURN,
SALE_VOID, DAMAGE, and ADJUSTMENT must have null idempotencyKey and
requestFingerprint; only RESTOCK may carry them.

The OWNER-only `POST /api/products/:productId/variants/:variantId/restocks`
endpoint requires one client-generated UUID in the `Idempotency-Key` header.
It accepts only a positive integer quantity (at most 1,000,000), a positive
decimal-string unitCost with at most four fractional digits, and an optional
note of at most 500 Unicode characters after NFC normalization and trimming.
The backend locks the tenant-owned Product then Variant in one transaction,
checks both remain active, atomically increments stock, updates lastPurchaseCost,
and inserts the movement. A matching-key retry returns the original movement
without another mutation, even if the catalog item was later deactivated; a
different fingerprint returns a conflict. The response's Variant
`currentStock` and `lastPurchaseCost` are current state,
not an historical stock-after snapshot for the returned movement.

The OWNER frontend creates one idempotency key per valid Restock operation.
After an uncertain outcome, retrying the same Product, Variant, quantity,
cost, and normalized note reuses that key and frozen payload. Changing those
semantics begins a new operation with a new key. A confirmed success or replay discards
the key and refreshes catalog stock and cost from the backend.

---

## 8. Sales

A Sale represents one transaction/receipt.

A Sale can contain multiple SaleItems.

Example:

Sale
├── Jeans x1
├── Shirt x2
└── Jacket x1

SaleItem must preserve historical snapshots such as:

- sold price
- cost at sale
- product/category information required for historical reports

Changing a Product later must never modify historical sales.

The stored SaleStatus contract is COMPLETED or VOIDED. Return disposition is
derived from SaleReturnItem history rather than stored.

A void stores voidedAt, the tenant-qualified void actor and immutable actor-name
and optional actor-code snapshots, plus a required nonblank reason. Voiding is
OWNER-only, restores stock through SALE_VOID movements, and reverses the Sale's
reporting impact without rewriting its totals or items. A Sale can transition
only once from COMPLETED to VOIDED, cannot be voided after any Return, and cannot
be hard-deleted.

A COMPLETED Sale is immutable after creation. Its only permitted update is the
approved COMPLETED to VOIDED transition and the corresponding void metadata.

SaleReturn is an immutable return header with a tenant-qualified Sale and
processor. SaleReturnItem records positive returned quantities and immutable
refund amounts against the original SaleItem and ProductVariant. Returns can be
partial or full, may have an optional reason, and may be processed by OWNER or
WAREHOUSE. The original SaleItem quantity never changes. The database locks the
relevant SaleItem before checking the cumulative returned quantity, preventing
over-return under concurrent transactions.

SaleReturnItem.refundAmount equals its quantity multiplied by the original
SaleItem.unitSoldPrice. The frontend never supplies authoritative refund value.

Return creation and voiding both lock the relevant Sale row. This guarantees
that a VOIDED Sale cannot receive a Return and a Sale with any Return cannot be
voided, including under concurrency.

Exchange is an immutable, tenant-qualified one-to-one link from one SaleReturn
to one distinct new Sale. Exchange contains no stock or money fields; its
monetary difference is derived from the new Sale total minus the ReturnItems'
refund total.

SaleReturn, SaleReturnItem, Exchange, and InventoryMovement are append-only.
SaleItem remains immutable and non-deletable. Returns and voids must not rewrite
the original Sale or SaleItems.

Sale must preserve the seller name and optional employee code as immutable
snapshots. `soldById` is derived from the authenticated Supabase user. OWNER and
WAREHOUSE may perform sales; SUPER_ADMIN may not perform tenant sales.

Sale creation through `POST /api/sales` is available to active OWNER and
WAREHOUSE users and requires a client operation UUID stored as
`Sale.idempotencyKey`, unique within the authenticated Account, and a
server-computed lowercase SHA-256 `requestFingerprint`. Retrying the same key
and semantic request returns the original Sale; reusing the key for a different
request is a conflict. The client never supplies the authoritative fingerprint.

The Sale request contains only a nonempty cart of at most 100 unique Variants,
with a positive integer quantity of at most 1,000,000 and a positive decimal
string price with at most two fractional digits per line. Duplicate Variants
are rejected rather than merged. The fingerprint includes authenticated
Account and seller IDs plus the cart normalized to two-decimal prices and
sorted by Variant ID, so reordered equivalent requests replay safely.

The transaction locks the Account, authenticated seller, Product rows sorted
by ID, and ProductVariant rows sorted by ID. Products and Variants must be
active. WAREHOUSE must submit the current locked non-null catalog price; OWNER
may submit an explicit Sale-only price even when the catalog price is null.
Every Variant must have a non-null `lastPurchaseCost`, which is copied exactly
to `SaleItem.unitCostAtSale`. Currency comes from `Account.baseCurrency`, and
seller, Product, Category, and Variant snapshots come from trusted database
state. Decimal line totals and Sale totals are calculated by the backend;
normal Sales cannot have zero-price lines or negative stock.

Sales history is exposed read-only through `GET /api/sales` and
`GET /api/sales/:saleId` to active OWNER and WAREHOUSE users. Both endpoints
derive the Account from authenticated tenant context. The list supports
optional status, seller, and `createdAt` timestamp-range filters and uses a
bounded cursor ordered by `createdAt DESC, id DESC` (default 25, maximum 100).
It returns stored Sale totals and seller snapshots plus line and unit counts,
without cost or profit data.

Sale detail uses the immutable seller and SaleItem catalog snapshots rather
than current User, Product, Category, or ProductVariant values. OWNER detail
also derives historical economics from `SaleItem.unitCostAtSale`: `lineCost`,
`totalCOGS`, `lineGrossProfit`, and `grossProfit` use Decimal arithmetic and
are serialized to four fractional digits without being persisted. WAREHOUSE
detail omits all cost and profit fields. Neither history endpoint exposes Sale
idempotency metadata or inventory state, and neither endpoint changes Sales,
stock, InventoryMovement, Return, Void, Exchange, or DailyReport state. Return
history serialization remains deferred to the Return runtime step.

Each inserted SALE InventoryMovement must use
`quantityChange = -SaleItem.quantity` and
`unitCost = SaleItem.unitCostAtSale`, resolved through the tenant-qualified
SaleItem relation. The Sale API must create the Sale, SaleItems, stock
decrements, and SALE movements atomically. Conditional stock decrements and
movement inserts happen in the same transaction, and any failure rolls back
the entire cart. DailyReport is not updated synchronously. This endpoint does
not model payment/tender, customer, invoice, or sequential receipt-number data,
and no frontend POS is implemented by this backend step.

---

## 9. Sale Transaction

Creating a sale must be atomic.

The following operations happen in one database transaction:

1. Validate user/account
2. Validate variants
3. Validate available stock
4. Create Sale
5. Create SaleItems
6. Decrease stock
7. Create InventoryMovements

If any operation fails:

ROLLBACK everything.

Never allow:

Sale created without stock decrease.

Never allow:

Stock decrease without Sale creation.

---

## 10. Money

Never use Float for financial values.

Use Prisma Decimal / PostgreSQL Decimal for:

- purchase cost
- sale price
- catalog selling price
- expenses
- revenue
- profit
- stock value

---

## 11. Accounting

Daily accounting distinguishes gross activity from reversals:

- `grossRevenue` is the total of Sales created on the report date.
- `returnedRevenue` is the total refund amount of SaleReturns created on the report date.
- `voidedRevenue` is the original total of Sales voided on the report date.
- `netRevenue = grossRevenue - returnedRevenue - voidedRevenue`.
- `grossCOGS` is the sum of SaleItem quantity multiplied by `unitCostAtSale` for Sales created on the report date.
- `returnedCOGS` is the sum of returned quantity multiplied by the original SaleItem `unitCostAtSale` for SaleReturns created on the report date.
- `voidedCOGS` is the sum of the original SaleItem quantity multiplied by `unitCostAtSale` for Sales voided on the report date.
- `netCOGS = grossCOGS - returnedCOGS - voidedCOGS`.
- `grossProfit = netRevenue - netCOGS`.
- `operatingExpenses` is the aggregate of Expense amounts belonging to the report date.
- `netProfit = grossProfit - operatingExpenses`.

Gross, returned, and voided magnitude fields, operating expenses, and stock
value cannot be negative. Net revenue, net COGS, gross profit, and net profit
may be negative.

Reversals are attributed to the date they occur, not the date of the original
sale. This preserves the existing `reportDate` business-day convention and does
not introduce a new timezone boundary.

---

## 12. Reports

Sale, SaleItem, SaleReturn, SaleReturnItem, Sale void metadata, and Expense are
the authoritative accounting history.

DailyReport is a precomputed cache for faster dashboards.

If DailyReport conflicts with the authoritative accounting history:

The authoritative accounting history wins.

DailyReport can be rebuilt.

`DailyReport.operatingExpenses` is only the cached per-business-day aggregate
of authoritative Expense records; it does not replace or duplicate them.

In the v1 report contract, `salesCount` is the number of gross Sale transactions
created during the business day, and `totalUnitsSold` is the gross quantity on
Sales created during that business day. Returns and voids do not rewrite these
historical gross counts. Future return, void, or net count metrics require
explicit new fields rather than overloading these fields.

Exchanges are represented by their linked return and replacement sale; those
underlying records contribute to the report on the dates they occur.

---

## 13. Security Principles

- Never expose Supabase service-role key to frontend.
- Never trust accountId from request body.
- Never trust role from frontend.
- Validate all API input.
- Enforce authorization in backend.
- Protect tenant boundaries.
- Do not store user passwords in the application database when using Supabase Auth.
- Secrets must never be committed to Git.

---

## 14. Deployment

Frontend:
Vercel

Backend:
Railway

Database:
Supabase PostgreSQL

Authentication:
Supabase Auth

Development migrations:

npx prisma migrate dev

Production migrations:

npx prisma migrate deploy

Never run migrate dev against production.

---

## 15. Scaling Strategy

Do not introduce infrastructure complexity before it is required.

Initial architecture:

Vercel
    |
Railway API
    |
Supabase PostgreSQL

Do not add Redis, multiple API servers, or load balancers unless measurements show a real need.

The backend should remain stateless so horizontal scaling can be added later.
