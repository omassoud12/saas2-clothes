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
- Supabase Storage for the MVP

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
- manage expenses
- access accounting
- access reports
- perform sales
- manage Warehouse employee

An OWNER employee code is optional.

### WAREHOUSE

Belongs to one Account.

Can:
- view products
- create products
- create categories
- restock inventory
- perform sales

An Account may have multiple WAREHOUSE employees. Each WAREHOUSE employee has
their own User account and a required employee code that is unique within the
Account.

Cannot:
- access accounting
- access expenses
- view sensitive costs/profit
- manage account-level settings

Authorization must be enforced by the backend.
Hiding UI elements is not considered authorization.

---

## 6. Product Model

Product represents the general product.

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
- averageCost
- lastPurchaseCost
- sellingPrice

ProductVariant.sellingPrice is the normal/default catalog selling price for the
variant.

SaleItem.unitSoldPrice is the actual price charged in a completed sale. It may
differ from ProductVariant.sellingPrice without mutating the catalog price.

---

## 7. Inventory

Inventory history must never be lost.

InventoryMovement is the inventory ledger.

Supported movement concepts:

- RESTOCK
- SALE
- DAMAGE
- ADJUSTMENT

Returns and exchanges will be added with their complete financial and inventory
reversal models in a later version.

currentStock is used for fast reads.

InventoryMovement is used as historical evidence explaining how stock changed.

Stock must never become negative.

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

Sale must preserve the seller name and optional employee code as immutable
snapshots. `soldById` is derived from the authenticated Supabase user. OWNER and
WAREHOUSE may perform sales; SUPER_ADMIN may not perform tenant sales.

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
- average cost
- sale price
- catalog selling price
- expenses
- revenue
- profit
- stock value

---

## 11. Accounting

Reports distinguish between:

Revenue

Cost of Goods Sold (COGS)

Gross Profit =
Revenue - COGS

Operating Expenses

Net Profit =
Gross Profit - Operating Expenses

---

## 12. Reports

Sale and SaleItem are the source of truth.

DailyReport is a precomputed cache for faster dashboards.

If DailyReport conflicts with Sale/SaleItem data:

Sale/SaleItem win.

DailyReport can be rebuilt.

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
