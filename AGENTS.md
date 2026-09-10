# SaaS2 Clothes - Codex Instructions

## Start Here

Before modifying code, read:

- ARCHITECTURE.md
- prisma/schema.prisma
- relevant existing code for the requested feature

ARCHITECTURE.md is the source of truth for system architecture.

Do not change architectural decisions unless the user explicitly requests an architecture change.

---

## Working Method

For substantial tasks:

1. Inspect the existing implementation.
2. Understand related models and dependencies.
3. Produce a short implementation plan.
4. Identify files that will be modified.
5. Implement only the requested scope.
6. Run validation/tests.
7. Review the diff before finishing.

Do not rewrite unrelated working code.

Do not perform large refactors unless explicitly requested.

---

## Technology Constraints

Use the existing stack:

- React + Vite + TypeScript
- Node.js + Express + TypeScript
- Prisma
- PostgreSQL / Supabase
- Supabase Auth
- Railway backend deployment
- Vercel frontend deployment

Do not replace these technologies without explicit approval.

---

## Multi-Tenant Rules

This is a multi-tenant SaaS.

Every business operation must respect Account isolation.

Never trust accountId from:

- request body
- query parameters
- frontend state

Resolve the Account from the authenticated user.

Never allow Account A to access Account B data.

Whenever implementing CRUD, explicitly check tenant isolation.

---

## Authorization

Roles:

- SUPER_ADMIN
- OWNER
- WAREHOUSE

Backend authorization is mandatory.

Frontend visibility is not authorization.

Sensitive OWNER-only data such as costs, profit and accounting must not be returned to unauthorized users.

---

## Database Rules

Financial fields use Decimal, never Float.

Use database transactions for operations that modify multiple related records.

Sales must atomically:

- create Sale
- create SaleItems
- decrease stock
- create InventoryMovements

Stock must never become negative.

Preserve historical snapshots.

Do not modify existing migrations manually unless explicitly required.

Development:

npx prisma migrate dev

Production:

npx prisma migrate deploy

Never reset, drop, or destroy production data.

---

## Product and Inventory Rules

Product is the general product.

ProductVariant is the sellable stock unit.

Stock belongs to ProductVariant.

InventoryMovement is the inventory history.

Never change currentStock without creating the appropriate inventory history when the business flow requires it.

---

## Auth and Security

Authentication uses Supabase Auth.

Do not store application passwords in Prisma.

Never expose:

- SUPABASE_SERVICE_ROLE_KEY
- DATABASE_URL
- private secrets

to frontend code.

Validate external input.

Do not weaken security rules to make a feature work.

---

## Coding Rules

- Use TypeScript.
- Follow existing naming and project structure.
- Prefer small focused changes.
- Avoid duplicate business logic.
- Do not create unnecessary abstractions.
- Do not change API contracts without explaining the impact.
- Do not silently change business behavior.

---

## Validation

Before considering a task complete, run the relevant available checks.

Examples:

npm run typecheck
npm run lint
npm test
npm run build

For backend/database changes, also verify:

- tenant isolation
- authorization
- transaction safety
- input validation
- Prisma relation correctness

If a check cannot be run, explain why.

---

## Completion Report

At the end of a task report:

1. What changed
2. Files changed
3. Tests/checks run
4. Any remaining risks
5. Any assumptions made