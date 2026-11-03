-- Owner Dashboard (additive): employees and access (User fields, UserStore, Invite), AuditLog, product
-- cost history (CostEntry, ProductVariant.costUpdatedAt), recurring expenses and editable expenses.
-- Nothing existing is dropped or renamed. Generated with prisma migrate diff, then reviewed; the two
-- hand-written NULLS NOT DISTINCT indexes of the business migration are kept (the diff wanted to drop them).
BEGIN;

-- CreateEnum
CREATE TYPE "EmployeeRole" AS ENUM ('MANAGER', 'CASHIER', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');




-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "deletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "originalAmount" DECIMAL(18,2),
ADD COLUMN     "originalCurrency" CHAR(3),
ADD COLUMN     "recurringExpenseId" UUID,
ADD COLUMN     "storeId" UUID;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "costUpdatedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deactivatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "deactivatedById" UUID,
ADD COLUMN     "employeeRole" "EmployeeRole",
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "permissionsCustom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "quantity" INTEGER NOT NULL,
    "totalCost" DECIMAL(18,2) NOT NULL,
    "unitCost" DECIMAL(18,2) NOT NULL,
    "supplierName" TEXT,
    "note" TEXT,
    "addedToStock" BOOLEAN NOT NULL DEFAULT false,
    "storeId" UUID,
    "variantIds" UUID[],
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStore" (
    "userId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "accountId" UUID NOT NULL,

    CONSTRAINT "UserStore_pkey" PRIMARY KEY ("userId","storeId")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "invitedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "storeId" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "employeeId" UUID,
    "startMonth" CHAR(7) NOT NULL,
    "endMonth" CHAR(7),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostEntry_accountId_productId_createdAt_idx" ON "CostEntry"("accountId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "CostEntry_variantId_accountId_idx" ON "CostEntry"("variantId", "accountId");

-- CreateIndex
CREATE INDEX "CostEntry_createdById_accountId_idx" ON "CostEntry"("createdById", "accountId");

-- CreateIndex
CREATE INDEX "UserStore_storeId_accountId_idx" ON "UserStore"("storeId", "accountId");

-- CreateIndex
CREATE INDEX "UserStore_accountId_idx" ON "UserStore"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_accountId_email_idx" ON "Invite"("accountId", "email");

-- CreateIndex
CREATE INDEX "Invite_userId_accountId_idx" ON "Invite"("userId", "accountId");

-- CreateIndex
CREATE INDEX "AuditLog_accountId_createdAt_idx" ON "AuditLog"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_accountId_targetType_targetId_idx" ON "AuditLog"("accountId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "RecurringExpense_accountId_active_idx" ON "RecurringExpense"("accountId", "active");

-- CreateIndex
CREATE INDEX "RecurringExpense_storeId_accountId_idx" ON "RecurringExpense"("storeId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringExpense_id_accountId_key" ON "RecurringExpense"("id", "accountId");

-- CreateIndex
CREATE INDEX "Expense_accountId_storeId_expenseDate_idx" ON "Expense"("accountId", "storeId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_recurringExpenseId_expenseDate_key" ON "Expense"("recurringExpenseId", "expenseDate");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_storeId_accountId_fkey" FOREIGN KEY ("storeId", "accountId") REFERENCES "Store"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringExpenseId_accountId_fkey" FOREIGN KEY ("recurringExpenseId", "accountId") REFERENCES "RecurringExpense"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_productId_accountId_fkey" FOREIGN KEY ("productId", "accountId") REFERENCES "Product"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_variantId_accountId_fkey" FOREIGN KEY ("variantId", "accountId") REFERENCES "ProductVariant"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_createdById_accountId_fkey" FOREIGN KEY ("createdById", "accountId") REFERENCES "User"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStore" ADD CONSTRAINT "UserStore_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStore" ADD CONSTRAINT "UserStore_userId_accountId_fkey" FOREIGN KEY ("userId", "accountId") REFERENCES "User"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStore" ADD CONSTRAINT "UserStore_storeId_accountId_fkey" FOREIGN KEY ("storeId", "accountId") REFERENCES "Store"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_userId_accountId_fkey" FOREIGN KEY ("userId", "accountId") REFERENCES "User"("id", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_storeId_accountId_fkey" FOREIGN KEY ("storeId", "accountId") REFERENCES "Store"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------- Data for existing rows

-- Every existing employee keeps exactly the access it has today (the WAREHOUSE preset).
UPDATE "User" SET "employeeRole" = 'WAREHOUSE' WHERE "role" = 'WAREHOUSE' AND "employeeRole" IS NULL;
-- An inactive user is a deactivated member.
UPDATE "User" SET "status" = 'DEACTIVATED', "deactivatedAt" = CURRENT_TIMESTAMP WHERE "isActive" = false;

-- ---------------------------------------------------------------- Checks

ALTER TABLE "User"
  ALTER COLUMN "permissions" SET NOT NULL,
  ADD CONSTRAINT "User_employee_role_check" CHECK (("role" = 'WAREHOUSE') = ("employeeRole" IS NOT NULL)),
  ADD CONSTRAINT "User_status_active_check" CHECK ("isActive" = ("status" = 'ACTIVE')),
  ADD CONSTRAINT "User_permissions_size_check" CHECK (cardinality("permissions") <= 64);

ALTER TABLE "CostEntry"
  ADD CONSTRAINT "CostEntry_quantity_check" CHECK ("quantity" >= 1 AND "quantity" <= 100000),
  ADD CONSTRAINT "CostEntry_total_cost_check" CHECK ("totalCost" > 0),
  ADD CONSTRAINT "CostEntry_unit_cost_check" CHECK ("unitCost" >= 0),
  ADD CONSTRAINT "CostEntry_variants_check" CHECK (cardinality("variantIds") >= 1),
  ADD CONSTRAINT "CostEntry_supplier_check" CHECK ("supplierName" IS NULL OR char_length("supplierName") <= 200),
  ADD CONSTRAINT "CostEntry_note_check" CHECK ("note" IS NULL OR char_length("note") <= 1000);

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_email_lowercase_check" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "Invite_expiry_check" CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "Invite_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "RecurringExpense"
  ADD CONSTRAINT "RecurringExpense_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "RecurringExpense_currency_check" CHECK ("currency" IN ('USD', 'LBP')),
  ADD CONSTRAINT "RecurringExpense_label_check" CHECK (btrim("label") <> '' AND char_length("label") <= 200),
  ADD CONSTRAINT "RecurringExpense_start_month_check" CHECK ("startMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "RecurringExpense_end_month_check" CHECK ("endMonth" IS NULL OR ("endMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "endMonth" >= "startMonth"));

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_original_currency_check" CHECK ("originalCurrency" IS NULL OR "originalCurrency" IN ('USD', 'LBP')),
  ADD CONSTRAINT "Expense_original_pair_check" CHECK (("originalAmount" IS NULL) = ("originalCurrency" IS NULL)),
  ADD CONSTRAINT "Expense_original_amount_check" CHECK ("originalAmount" IS NULL OR "originalAmount" > 0),
  ADD CONSTRAINT "Expense_recurring_first_day_check" CHECK ("recurringExpenseId" IS NULL OR EXTRACT(DAY FROM "expenseDate") = 1),
  ADD CONSTRAINT "Expense_note_check" CHECK ("note" IS NULL OR char_length("note") <= 1000);

-- ---------------------------------------------------------------- Expense: editable, never deleted

-- Expenses were append-only. The owner can now correct an expense or remove it, so UPDATE is allowed
-- on the fields the owner edits; the row itself is never deleted (removal sets deletedAt), its
-- identity, author, currency and month link never change, and a removed expense is frozen.
-- Every change is written to AuditLog by the API in the same transaction.
CREATE OR REPLACE FUNCTION "prevent_expense_changes"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'historical expenses cannot be deleted';
  END IF;
  IF OLD."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'a removed expense cannot be changed';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."accountId" IS DISTINCT FROM OLD."accountId"
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."recurringExpenseId" IS DISTINCT FROM OLD."recurringExpenseId" THEN
    RAISE EXCEPTION 'expense identity, author, currency and recurring link cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------- Supabase boundary (like every table)

ALTER TABLE "CostEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserStore" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringExpense" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CostEntry", "UserStore", "Invite", "AuditLog", "RecurringExpense" FROM anon, authenticated;

COMMIT;
