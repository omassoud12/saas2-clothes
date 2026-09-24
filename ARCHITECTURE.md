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

The transactional `POST /api/sales/:saleId/returns` endpoint is available to
active OWNER and WAREHOUSE users; SUPER_ADMIN cannot process tenant Returns.
It requires one client operation UUID in `Idempotency-Key`, stored as
`SaleReturn.idempotencyKey` and unique within the authenticated Account. The
backend stores its own lowercase SHA-256 `requestFingerprint`; the client
cannot supply the authoritative fingerprint. Its fixed-order UTF-8 JSON input
is `type` set to `"RETURN"`, lowercase authenticated `accountId`, lowercase
authenticated `processedById`, lowercase route `saleId`, items sorted by
lowercase `saleItemId` with integer quantities, and the normalized reason or
JSON null. Refunds, costs, Variant IDs, timestamps, generated Return IDs, and
current stock are excluded. A matching key and fingerprint replays the
persisted Return with HTTP 200; the same key with different semantics conflicts.
The tenant-scoped database unique constraint is the final concurrent-key guard,
and its losing transaction is rolled back before the winner is re-read.

Return requests contain only an optional reason and a nonempty array of at most
100 unique SaleItem IDs with positive integer quantities no greater than
1,000,000. Duplicate SaleItem IDs are rejected rather than merged. The reason
is Unicode-NFC normalized and trimmed, with an empty result represented by null
and a maximum of 2,000 characters. Fingerprinting and persistence use the same
normalized value. The runtime derives the Account and processor from
authentication, rechecks that processor under a row lock, and writes that actor
consistently to both SaleReturn and every RETURN movement; this actor equality
is a runtime transaction guarantee rather than a database constraint.

A new Return runs in one READ COMMITTED transaction and locks the Account,
processor, Sale, requested SaleItems sorted by ID, and affected Variants sorted
by ID. The Sale must be tenant-owned and COMPLETED. Each SaleItem must belong to
that Sale and Account. After locking, the service sums authoritative prior
SaleReturnItem quantities and rejects the entire request if any line exceeds
its remaining sold quantity. Sale and SaleItem locks serialize competing
Return and future Void operations; the database cumulative-quantity and
Return/Void triggers remain final integrity backstops.

Refund amounts come only from the immutable `SaleItem.unitSoldPrice`, and
RETURN movement costs come only from `SaleItem.unitCostAtSale`. Current catalog
prices and costs are not authorities. Historical Product, Category, SKU,
color, and size display in the mutation/replay response comes from the original
SaleItem snapshots. A Product or Variant becoming inactive does not block a
historical Return and does not reactivate it.

The transaction creates one SaleReturn, one SaleReturnItem per requested line,
one RETURN InventoryMovement per ReturnItem, and atomically restores stock to
the exact historical Variant after checking PostgreSQL integer capacity. Any
header, item, movement, or stock failure rolls back the entire Return. The safe
OWNER and WAREHOUSE mutation response includes refund amounts but omits costs,
profit, stock, movement identifiers, idempotency metadata, and fingerprints.
The Sale remains COMPLETED and DailyReport is not updated synchronously.

The Return service exposes a transaction-scoped creation primitive in addition
to the public transaction-opening operation, allowing a future Exchange to
compose Return work inside one outer transaction without nested transactions.

Every RETURN movement quantity must equal its SaleReturnItem quantity, and
every SALE_VOID movement quantity must equal the original SaleItem quantity.
Both continue using the immutable `SaleItem.unitCostAtSale` as their movement
cost.

The transactional `POST /api/sales/:saleId/void` endpoint is OWNER-only;
WAREHOUSE and SUPER_ADMIN cannot Void tenant Sales. Its request contains only a
required reason, normalized with Unicode NFC and trimming, which must remain
nonempty and no longer than 2,000 characters. Void has no dedicated
idempotency key. It uses state-based replay: an already-VOIDED Sale with the
same authenticated actor and normalized reason returns its persisted result
with HTTP 200 and no inventory mutation; another actor or reason conflicts.
The first successful Void returns HTTP 201. Stored actor snapshots, reason, and
`voidedAt` remain authoritative on replay and are never rebuilt from the
current User.

A new Void runs in one READ COMMITTED transaction and locks the Account,
authenticated active OWNER, tenant-owned Sale, and affected ProductVariants
sorted by ID. SaleItems are immutable and are loaded by the tenant-qualified
Sale relationship after the Sale lock; a zero-item Sale fails safely. The Sale
must be COMPLETED and have no SaleReturn. The service restores every original
SaleItem quantity to its historical Variant, appends exactly one SALE_VOID
InventoryMovement per SaleItem using `SaleItem.unitCostAtSale`, then transitions
the Sale to VOIDED with trusted current actor snapshots. Stock increments are
atomic and overflow-checked. The final Sale transition trigger rechecks Return
exclusion, and any stock, movement, or transition failure rolls back the entire
Void.

Inactive current Products or Variants do not block historical Void and are not
reactivated. Runtime guarantees the authenticated OWNER is both
`Sale.voidedById` and every SALE_VOID movement's `performedById`. Void does not
create SaleReturn or SaleReturnItem records, alter original Sale totals/items,
or synchronously update DailyReport. Its mutation response uses immutable Sale
and SaleItem display snapshots and omits costs, profit, stock, movement IDs,
and internal metadata.

Return creation and voiding both lock the relevant Sale row. This guarantees
that a VOIDED Sale cannot receive a Return and a Sale with any Return cannot be
voided, including under concurrency.

Exchange is an immutable, tenant-qualified one-to-one link from one SaleReturn
to one distinct new Sale. Exchange contains no stock or money fields; its
monetary difference is derived from the new Sale total minus the ReturnItems'
refund total.

The transactional `POST /api/sales/:saleId/exchanges` endpoint allows active
OWNER and WAREHOUSE users to compose one Return plus one replacement Sale in
one outer READ COMMITTED transaction. It reuses the transaction-scoped Return
and Sale primitives without nested transactions. Existing Return rules apply
unchanged to historical original items, including items whose current Product
or Variant is inactive. Normal Sale rules apply unchanged to replacement
items, whose current Product and Variant must be active. The authenticated
actor is both `SaleReturn.processedById` and replacement `Sale.soldById`.

The original Sale is derived only through `Exchange -> SaleReturn -> Sale`.
The replacement Sale must belong to the same Account, differ from the original
Sale, be COMPLETED when the Exchange link is inserted, and use the same
currency as the original Sale. It may later follow the normal Return or Void
lifecycle. Exchange remains append-only, with at most one Exchange per Return
and at most one Exchange per replacement Sale.

The public Exchange request requires one client-generated UUID in the
`Idempotency-Key` header. `Exchange.idempotencyKey` is unique within the
authenticated Account, and the backend stores its own lowercase SHA-256
`requestFingerprint`; the frontend cannot supply the authoritative fingerprint.
An identical tenant/key/fingerprint retry replays the persisted Exchange with
no duplicate Return, replacement Sale, or stock mutation. Reusing the key with
different semantics returns `409 EXCHANGE_IDEMPOTENCY_CONFLICT`; only an
Exchange tenant/key unique collision participates in Exchange race recovery.

The Exchange fingerprint is SHA-256 over deterministic fixed-order UTF-8 JSON.
Its semantic content is: `type` set to `"EXCHANGE"`; lowercase authenticated
`accountId` and `actorId`; lowercase original `saleId`; the normalized Return
reason or JSON null; Return items sorted by lowercase `saleItemId`, each with
`saleItemId` and integer `quantity`; and replacement items sorted by lowercase
`variantId`, each with `variantId`, integer `quantity`, and `unitSoldPrice`
normalized to exactly two decimals. Duplicate Return `saleItemId` values and
duplicate replacement `variantId` values are rejected rather than merged.
Refund amounts, costs, generated Return, replacement Sale, and Exchange IDs,
timestamps, stock, current catalog snapshots, and current purchase costs are
excluded. The stored fingerprint is exactly 64 lowercase hexadecimal
characters.

The public Exchange owns this single external idempotency key. A deterministic
transaction-scoped PostgreSQL advisory lock over Account plus Exchange key
serializes same-key attempts, after which the Exchange is reread before any
child creation. The deployed tenant/key unique index remains the final race
backstop. Internal Return and replacement Sale UUIDv5 keys are derived from the
Exchange key with distinct fixed child discriminators and are never accepted
from or exposed to the client. Their request fingerprints retain the canonical
standalone Return and Sale semantics rather than reusing the Exchange
fingerprint. Standalone Return and Sale idempotency behavior remains unchanged.

Before invoking either child primitive, the Exchange transaction acquires its
complete lock set in this order: Exchange advisory lock, Account, authenticated
actor User, original Sale, requested original SaleItems sorted by ID,
replacement Products sorted by ID, then the union of returned and replacement
Variants sorted by ID. Advisory relationship reads only discover that lock set;
all tenant and relationship authority is revalidated after locking. This avoids
Return/Sale lock inversion while retaining every validation performed by each
child primitive. The Return runs before the replacement Sale, so returned stock
is transaction-visible to the replacement Sale. Returning and reselling the
same Variant therefore creates separate RETURN and SALE records and may have a
net stock effect of zero; neither event is optimized away.

The original and replacement Sales must use the same currency; no conversion
is performed. Exchange responses derive `totalRefund` from persisted
SaleReturnItem refund amounts, use the persisted replacement Sale total, and
report `differenceAmount = replacementTotal - totalRefund` to two decimal
places. Positive, zero, and negative results are mathematical differences only,
not evidence of payment, collection, or refund settlement. Responses use
stored processor, seller, and SaleItem snapshots and omit costs, profit, stock,
movements, and all Exchange or child idempotency metadata.

Failure during Return creation, replacement Sale creation, stock mutation,
movement creation, or Exchange-link insertion rolls back the entire graph. The
operation never changes the original Sale status, creates no EXCHANGE movement,
and does not synchronously update DailyReport. The child Return and replacement
Sale naturally appear in their existing history endpoints.

Active OWNER and WAREHOUSE users may read tenant-owned Exchanges through
`GET /api/exchanges` and `GET /api/exchanges/:exchangeId`. Exchange history
uses a bounded cursor ordered by `createdAt DESC, id DESC` (default 25,
maximum 100) with optional UTC `from` and `to` filters. Detail IDs and all
queries are tenant-qualified; foreign Exchanges return a safe 404. The list
loads a bounded page and grouped stored ReturnItem refunds without per-Exchange
queries. Detail uses immutable Return processor, original SaleItem, replacement
seller, and replacement SaleItem snapshots; it never rebuilds display values
from current Users or catalog. Currency comes from the historical original
Sale, replacement totals from the persisted replacement Sale, and
`differenceAmount` remains a Decimal-safe mathematical difference without
payment or settlement meaning. A later VOIDED replacement Sale remains visible
with its current stored status and the original Exchange history intact.

Sale detail includes only `exchangeSummary.originalExchangeCount` (counting
Exchange-linked Returns for that original Sale) and
`exchangeSummary.replacementForExchangeId` (the optional Exchange for which it
is the replacement). Each Return-history entry includes `exchangeId` or null.
The Sales list remains unchanged. These read APIs expose neither cost/profit,
inventory state, movement IDs, nor any Exchange or child idempotency metadata
to either role. They do not write Sale, Return, Exchange, inventory, or
DailyReport state and introduce no synthetic Sale status. No frontend Exchange
UI is included in this backend step.

Exchange has no payment or settlement semantics: a derived replacement total
minus Return refund total does not prove that money was paid or refunded.
There is no Exchange InventoryMovement type; the Return produces RETURN
movements and the replacement Sale produces SALE movements. DailyReport is
rebuilt from those authoritative child events, not from a separate Exchange
financial record.

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

Standalone Sale creation keeps its public idempotency wrapper separate from a
reusable transaction-scoped `createSaleInTransaction` primitive. The wrapper
owns replay lookup, the interactive transaction boundary, post-rollback
recovery for the exact Sale idempotency unique race, and public serialization.
The primitive receives a caller-provided Prisma transaction plus trusted
Account/seller context and required internal `idempotencyKey` and
`requestFingerprint` metadata. It opens no nested transaction and performs no
replay lookup or unique-race recovery; it locks authoritative state and creates
the Sale, SaleItems, stock decrements, and SALE movements, returning persisted
Sale data to its caller. Existing standalone Sale behavior is unchanged.

The Exchange transaction composes the existing Return primitive and this Sale
primitive before inserting its Exchange link, so failure of any step rolls back
every child effect. The child primitives keep their standalone validation and
locking behavior; the Exchange's unified outer locks establish the compatible
global ordering first without a lock-skipping flag.

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
detail omits all cost and profit fields. Sale detail also exposes a derived,
bounded `returnSummary`: whether any Returns exist, Return header count, total
returned units, and the sum of stored ReturnItem refund amounts. Every SaleItem
includes its cumulative returned quantity and remaining returnable quantity.
These additions do not redefine the original Sale economics or invent a
`RETURNED` or `PARTIALLY_RETURNED` Sale status; `Sale.status` remains COMPLETED
or VOIDED.

Return history is exposed read-only through
`GET /api/sales/:saleId/returns` to active OWNER and WAREHOUSE users after a
tenant-qualified Sale ownership check. It is cursor-paginated by
`createdAt DESC, id DESC`, defaults to 25 Return headers, and permits at most
100 per page. The cursor contains only the timestamp and Return ID and conveys
no tenant authority. Header paging happens before ReturnItems are loaded, so
the endpoint never provides an unbounded history mode.

Return history uses immutable `SaleReturn.processedByName` and
`processedByCode` snapshots for the processor, immutable SaleItem snapshots
for Product, Category, SKU, color, and size, and stored
`SaleReturnItem.refundAmount` values for line and Return refund totals. It
reports ReturnItem line count separately from summed returned units. OWNER and
WAREHOUSE receive the same Return-history shape: neither receives Return cost,
COGS, profit, margin, inventory state or movement data, or Return idempotency
metadata. Sale detail summaries and Return history are strictly read-only and
do not change Sales, stock, InventoryMovement, Return, Void, Exchange, or
DailyReport state.

Neither Sales history endpoint exposes Sale idempotency metadata or inventory
state. Existing OWNER Sale-detail economics remain based on the original Sale,
while WAREHOUSE continues to receive no cost or profit fields.

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
value, when available, cannot be negative. Net revenue, net COGS, gross profit,
and net profit may be negative. `DailyReport.stockValue` is nullable: null means
that historical stock valuation is unavailable or was not computed, while zero
is reserved for a future approved valuation engine that proves a zero value.

The reporting day is the UTC calendar day. Timestamp-backed Sale, SaleReturn,
and Void events for `YYYY-MM-DD` are grouped in the half-open interval from
`YYYY-MM-DD 00:00:00 UTC` through the next day at `00:00:00 UTC`. Reversals are
attributed to the UTC day they occur, not the original Sale day. Expense uses
its explicit `expenseDate` directly without timezone conversion. There is no
6AM, Lebanon-local, browser-local, or Account-timezone boundary in this MVP.

Expense is authoritative append-only history. MVP operations are CREATE and
READ only; updates and deletes are rejected by the database, and corrections
require a separately approved reversal design. Expense has no category, note,
soft-delete state, or occurrence timestamp. It stores a required description,
strictly positive two-decimal amount, explicit report `expenseDate`, trusted
creator relation, and a currency snapshot derived from the locked Account base
currency. It does not store a creator name/code snapshot, so future reads must
not promise immutable creator display data.

`POST /api/expenses` and `GET /api/expenses` are implemented for active OWNER
users only. WAREHOUSE cannot access Expense data, and SUPER_ADMIN has no tenant
financial authority. Create accepts only a positive decimal-string amount with
at most two fractional digits, a required NFC-normalized and trimmed
description of at most 2,000 characters, and `expenseDate` as `YYYY-MM-DD`.
The backend derives Account, creator, and the locked Account base-currency
snapshot; there is no client currency, category, note, or `occurredAt`.

Expense history is tenant-scoped and uses bounded keyset pagination ordered by
`expenseDate DESC, id DESC` (default 25, maximum 100), with inclusive `from`
and `to` DATE filters. Responses use the persisted Expense currency and
creator ID without joining current User display data. No Expense PATCH, PUT,
DELETE, correction, or reversal endpoint exists. Expense creation inserts only
the authoritative Expense row and does not update DailyReport, inventory, or
other financial history. Expense has no idempotency contract in this MVP, so
each successful POST creates one immutable record.

Revenue, refunds, expenses, and report fields use two decimal places.
Historical unit cost uses four. Each daily gross, returned, or voided COGS
component is calculated by multiplying quantities by historical
`unitCostAtSale`, summing at full Decimal precision, and rounding the daily
aggregate once to two decimals with `ROUND_HALF_UP`. Lines are not rounded to
two decimals before summation. Net COGS and profit fields are then derived from
the stored rounded report components so database equations remain exact. JS
Number is never used for financial arithmetic.

---

## 12. Reports

Sale, SaleItem, SaleReturn, SaleReturnItem, Sale void metadata, and Expense are
the authoritative accounting history.

DailyReport is a precomputed cache for faster dashboards.

If DailyReport conflicts with the authoritative accounting history:

The authoritative accounting history wins.

DailyReport can be rebuilt.

DailyReport stores the Account base-currency snapshot used for its computation.
Its `computedAt` records when the cache row was calculated; it is not proof that
the row is currently fresh. Sale, Return, Void, Exchange, and Expense writes do
not synchronously update this cache.

`DailyReport.operatingExpenses` is only the cached per-business-day aggregate
of authoritative Expense records; it does not replace or duplicate them.

In the v1 report contract, `salesCount` is the number of gross Sale transactions
created during the business day, and `totalUnitsSold` is the gross quantity on
Sales created during that business day. Returns and voids do not rewrite these
historical gross counts. Future return, void, or net count metrics require
explicit new fields rather than overloading these fields.

Exchanges are represented by their linked return and replacement sale; those
underlying records contribute to the report on the dates they occur. Exchange
itself contributes no financial value: its Return child supplies returned
revenue/COGS, its replacement Sale supplies gross revenue/COGS, and a later
replacement Void supplies voided revenue/COGS.

The authoritative daily sources are persisted Sale totals by `Sale.createdAt`,
persisted ReturnItem refunds by `SaleReturn.createdAt`, original Sale totals by
`Sale.voidedAt`, and Expense amounts by `Expense.expenseDate`. Gross COGS uses
original SaleItem quantity and historical unit cost; returned COGS uses returned
quantity and the original SaleItem historical cost; voided COGS uses the full
original SaleItem quantity and historical cost. Gross Sale counts and units are
based on Sales created that UTC day, including Sales later returned or voided.

Historical stock-value rebuild is deferred. Current stock and last purchase
cost are present-state fields. Inventory movements can reconstruct quantities,
but historical cost basis still has unavailable or ambiguous cases. Until a
separate valuation algorithm is approved, `DailyReport.stockValue` remains
null; current stock multiplied by current cost and missing cost treated as zero
are both forbidden substitutes.

The internal authoritative calculation core is implemented as transaction-
scoped `computeFinancialRangeInTransaction` and
`computeDailyFinancialsInTransaction` primitives. Callers supply the Prisma
transaction and a trusted Account ID; the calculation layer is not an HTTP
authorization layer and opens no nested transaction. It accepts strict UTC
calendar dates, permits bounded inclusive ranges of at most 366 days, and
returns every date in ascending order, including zero-activity dates.

Financial sources are aggregated in one parameterized, set-based PostgreSQL
query independent of range length. Gross Sale revenue/counts and original
units/COGS remain on `Sale.createdAt`; Return refund and historical COGS
reversals use `SaleReturn.createdAt`; Void revenue and full historical COGS use
`Sale.voidedAt`; and Expense uses its DATE-valued `expenseDate` directly.
Exchange is never queried as an independent amount source because its Return
and replacement Sale already represent its financial activity.

Each day's gross, returned, and voided COGS is summed at full numeric precision
and rounded once per component to two decimals with `ROUND_HALF_UP`. Derived
net revenue, net COGS, gross profit, and net profit use those two-decimal daily
components. Range summaries sum the already-rounded daily components, rather
than rounding a hidden whole-range raw COGS value. All outputs are checked
against Decimal(18,2), and daily counts/units are checked against PostgreSQL
Int bounds. Mixed Sale/Expense currency metadata fails as a financial invariant;
the engine never converts or relabels currency. Historical stock valuation
remains unavailable, so daily and summary `stockValue` is always null.

The internal `rebuildDailyReport(accountId, reportDate)` service opens one
`READ COMMITTED` transaction, locks the Account row, calculates the day from
authoritative history in one aggregate query, and upserts the unique
`(accountId, reportDate)` cache row with a new `computedAt`. All current
financial writers lock the Account before mutation, so this rebuild lock
serializes same-Account writes and rebuilds while the source set is calculated
and persisted. `READ COMMITTED` is intentional here: if the lock waits for an
earlier writer, the following aggregate sees that writer's committed rows;
new same-Account writers remain blocked until rebuild commit. A repeatable-read
snapshot taken before a lock wait could otherwise precede a writer that commits
while the rebuild is waiting. `computedAt` records computation time only and
does not prove ongoing freshness. Sale, Return, Void, Exchange, and Expense
write paths do not synchronously rebuild DailyReport.

Authoritative financial reads are implemented as OWNER-only
`GET /api/reports/daily?date=YYYY-MM-DD` and
`GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`. WAREHOUSE receives no
Expense, COGS, profit, operating-expense, or stock-valuation data, and
SUPER_ADMIN has no tenant financial-report authority. Both endpoints derive
the Account from authenticated tenant context, accept strict UTC calendar
dates, and are read-only. Summary ranges contain 1 to 366 inclusive days and
return aggregate totals without embedding the daily rows.

Each public report calculation runs inside one `REPEATABLE READ` transaction
and reuses the authoritative transaction-scoped financial core. It takes no
Account write lock, does not rebuild or read DailyReport, and does not block
participating financial writers merely to calculate a live report. The result
represents one consistent committed snapshot; a concurrent write may fall
before or after that snapshot, so this is not a serializable real-time
freshness guarantee. Live PostgreSQL report snapshot-concurrency verification
remains deferred; unit tests verify transaction configuration and service
composition, not live concurrent database behavior.

Daily responses retain the UTC Sale/Return/Void occurrence semantics and
Expense DATE semantics defined above. Summary responses use
`summarizeFinancialDays` over the already-rounded daily rows, preserving daily
COGS rounding before range summation. Money is returned as canonical
two-decimal strings, negative net/profit values remain signed, the validated
Account currency is not converted, and `stockValue` remains null. No public
DailyReport rebuild or other Report mutation endpoint exists.

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

### HTTP runtime security boundary

The Express API uses a startup-validated, comma-separated
`CORS_ALLOWED_ORIGINS` allowlist. Entries must be absolute HTTP(S) origins with
only a scheme, hostname, and optional port; credentials, paths, queries,
fragments, malformed values, and wildcards are rejected. Production fails
closed when the allowlist is missing or empty. Development does not implicitly
trust localhost or arbitrary local ports: every browser origin must still be
listed explicitly. Requests without an `Origin` header remain valid for
same-origin, server-to-server, CLI, and health-probe use and continue through
normal route authentication.

CORS permits only `GET`, `POST`, `PATCH`, `DELETE`, and `OPTIONS`, with
`Authorization`, `Content-Type`, and `Idempotency-Key` request headers.
Credentials are disabled because authentication uses Bearer tokens rather than
cross-origin cookies. CORS is only a browser enforcement mechanism; Bearer
authentication, role authorization, tenant scoping, database boundaries, and
all other server-side protections remain authoritative.

Express proxy trust is an explicit bounded numeric `TRUST_PROXY_HOPS` setting,
never trust-all. Production requires a positive configured value and fails
startup when it is absent or invalid; non-production defaults to zero trusted
hops. Railway's actual forwarding topology and protection from direct backend
ingress must be verified during deployment before selecting the production hop
count. This verification is required for `req.ip` and the existing OWNER
bootstrap IP limiter to represent the intended client. It is not a claim that
the local forwarded-header tests prove Railway's live topology.

The API disables `X-Powered-By` and emits `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`. HSTS remains a Railway TLS-termination
deployment check and is not emitted on local plaintext development. JSON
request bodies have an explicit 100 KiB limit; malformed JSON and oversized
JSON receive controlled JSON 400 and 413 responses. Unknown routes receive a
controlled JSON 404 after registered routes. Multipart image parsing remains
route-specific and is not governed by the JSON limit.

Unexpected HTTP failures return only the generic error envelope and runtime
logging records bounded category/status metadata rather than raw error objects,
request bodies, provider details, SQL, credentials, or production stack traces.
The health endpoint is a liveness response (`status: ok`) only and makes no
hardcoded dependency-readiness claims.

Ordinary HTTP startup loads only the Supabase URL and publishable/legacy anon
key needed by the non-privileged Bearer-token verifier. It neither reads the
service-role key nor constructs an admin client. The SUPER_ADMIN administrative
CLI has a separate environment loader and is the only current path that
requires `SUPABASE_SERVICE_ROLE_KEY`. `DIRECT_URL` remains migration-tooling
configuration and is not required by ordinary API or SUPER_ADMIN runtime.
Runtime configuration accepts only `development`, `test`, or `production`,
validates the TCP port, requires HTTPS for remote Supabase URLs (with explicit
loopback HTTP allowed outside production), bounds Supabase key strings, and
preserves the verified database-TLS contract below.

General/distributed rate limiting, structured request IDs/logging, dependency
readiness, graceful shutdown, and application timeout policy remain FBH4 work;
none is claimed by this HTTP-hardening layer.

### Supabase database access boundary

The frontend uses Supabase directly for authentication only. All tenant
business-data requests go through the Express API, which derives authorization
and Account scope before Prisma accesses PostgreSQL. The public-schema
application tables are not a client-facing Supabase Data API.

The deployed and verified production database boundary enables row-level
security on every application business table without creating `anon` or
`authenticated` policies, and revokes those roles' direct table privileges.
This is deliberate deny-by-default protection rather than tenant-aware
frontend RLS: neither role may read or mutate business data directly. Backend
Prisma remains the database authority through its separately configured
database role.

The same boundary enables RLS and removes `anon` and `authenticated` table
privileges on Prisma's `_prisma_migrations` metadata table. It also removes
those roles from the `postgres` role's default table and sequence privileges in
the `public` schema so future backend-owned objects remain closed by default.
Prisma migration deploy remains compatible because its configured database
role owns the objects and bypasses RLS.

No frontend business CRUD policy exists. Any future proposal to access
business data directly through Supabase PostgREST, GraphQL, or another Data API
requires a separate security design and explicit approval. The FBH1 migration
that establishes this boundary is deployed and verified against the Supabase
development database.

### PostgreSQL transport security

Every remote PostgreSQL connection must use certificate-verified TLS equivalent
to `sslmode=verify-full`. The CA certificate is supplied through the backend's
`SUPABASE_DB_CA_PATH` environment setting and remains outside the repository.
The backend gives `pg` an explicit trusted CA with peer and hostname
verification enabled; it never uses `rejectUnauthorized: false`.

Runtime `DATABASE_URL` remains the Supabase Session Pooler on port 5432. Local
migration tooling may also use the Session Pooler because the current Windows
development environment cannot reach Supabase's IPv6-only Direct endpoint.
In production, Railway must enable outbound IPv6 before `DIRECT_URL` is set to
the true Supabase Direct endpoint for migration tooling. Both paths use the
same external CA and verified-TLS requirement.

Production configuration fails closed unless remote database URLs explicitly
declare `sslmode=verify-full`; missing, downgrade-capable, unverified, unknown,
or conflicting TLS modes are rejected with a credential-safe startup/config
error. Plaintext is permitted only for a genuine loopback PostgreSQL endpoint
outside production.

For pooled runtime connections, `pg_stat_ssl` describes the Supavisor-to-
PostgreSQL hop and is not authoritative evidence for the application's TLS
socket. FBH2 live verification instead confirmed the Node client socket is
encrypted and certificate-authorized using TLS 1.3. An invalid trusted CA was
also rejected without an insecure fallback.

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
