-- Business reports (Daily / Weekly / Monthly / Yearly). Additive only: nothing existing is dropped, renamed
-- or changed in type. Sale, SaleItem and their immutability triggers are untouched.
--   * Account.timezone (default Asia/Beirut) and Expense.category (existing expenses become OTHER);
--   * Store: one default store per Account (created here for every existing Account);
--   * SalesTarget, ClosedDay;
--   * three rollup tables for finished shop-local days;
--   * an index for the newest-first invoice list.
BEGIN;

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'SALARIES', 'ELECTRICITY', 'GENERATOR', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesTargetPeriod" AS ENUM ('WEEK', 'MONTH');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Beirut';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "Store" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTarget" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "storeId" UUID,
    "period" "SalesTargetPeriod" NOT NULL,
    "periodStart" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClosedDay" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "storeId" UUID,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClosedDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySalesRollup" (
    "accountId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "salesTotal" DECIMAL(18,2) NOT NULL,
    "costTotal" DECIMAL(18,2) NOT NULL,
    "invoiceCount" INTEGER NOT NULL,
    "piecesSold" INTEGER NOT NULL,
    "discountsTotal" DECIMAL(18,2) NOT NULL,
    "returnsCount" INTEGER NOT NULL,
    "returnsTotal" DECIMAL(18,2) NOT NULL,
    "cashTotal" DECIMAL(18,2) NOT NULL,
    "cashCount" INTEGER NOT NULL,
    "whishTotal" DECIMAL(18,2) NOT NULL,
    "whishCount" INTEGER NOT NULL,
    "costMissing" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailySalesRollup_pkey" PRIMARY KEY ("accountId","storeId","date")
);

-- CreateTable
CREATE TABLE "DailyProductRollup" (
    "accountId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "salesTotal" DECIMAL(18,2) NOT NULL,
    "costTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "DailyProductRollup_pkey" PRIMARY KEY ("accountId","storeId","date","variantId")
);

-- CreateTable
CREATE TABLE "DailyStaffRollup" (
    "accountId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "userId" UUID NOT NULL,
    "salesTotal" DECIMAL(18,2) NOT NULL,
    "costTotal" DECIMAL(18,2) NOT NULL,
    "invoiceCount" INTEGER NOT NULL,

    CONSTRAINT "DailyStaffRollup_pkey" PRIMARY KEY ("accountId","storeId","date","userId")
);

-- CreateIndex
CREATE INDEX "Store_accountId_idx" ON "Store"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_id_accountId_key" ON "Store"("id", "accountId");

-- CreateIndex
CREATE INDEX "SalesTarget_accountId_period_periodStart_idx" ON "SalesTarget"("accountId", "period", "periodStart");

-- CreateIndex
CREATE INDEX "SalesTarget_storeId_accountId_idx" ON "SalesTarget"("storeId", "accountId");

-- CreateIndex
CREATE INDEX "ClosedDay_accountId_date_idx" ON "ClosedDay"("accountId", "date");

-- CreateIndex
CREATE INDEX "ClosedDay_storeId_accountId_idx" ON "ClosedDay"("storeId", "accountId");

-- CreateIndex
CREATE INDEX "DailySalesRollup_accountId_date_idx" ON "DailySalesRollup"("accountId", "date");

-- CreateIndex
CREATE INDEX "DailySalesRollup_storeId_accountId_idx" ON "DailySalesRollup"("storeId", "accountId");

-- CreateIndex
CREATE INDEX "DailyProductRollup_accountId_date_idx" ON "DailyProductRollup"("accountId", "date");

-- CreateIndex
CREATE INDEX "DailyProductRollup_storeId_accountId_idx" ON "DailyProductRollup"("storeId", "accountId");

-- CreateIndex
CREATE INDEX "DailyProductRollup_variantId_accountId_idx" ON "DailyProductRollup"("variantId", "accountId");

-- CreateIndex
CREATE INDEX "DailyStaffRollup_accountId_date_idx" ON "DailyStaffRollup"("accountId", "date");

-- CreateIndex
CREATE INDEX "DailyStaffRollup_storeId_accountId_idx" ON "DailyStaffRollup"("storeId", "accountId");

-- CreateIndex
CREATE INDEX "DailyStaffRollup_userId_accountId_idx" ON "DailyStaffRollup"("userId", "accountId");

-- CreateIndex
CREATE INDEX "Sale_accountId_createdAt_id_idx" ON "Sale"("accountId", "createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_storeId_accountId_fkey" FOREIGN KEY ("storeId", "accountId") REFERENCES "Store"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosedDay" ADD CONSTRAINT "ClosedDay_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosedDay" ADD CONSTRAINT "ClosedDay_storeId_accountId_fkey" FOREIGN KEY ("storeId", "accountId") REFERENCES "Store"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySalesRollup" ADD CONSTRAINT "DailySalesRollup_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySalesRollup" ADD CONSTRAINT "DailySalesRollup_storeId_accountId_fkey" FOREIGN KEY ("storeId", "accountId") REFERENCES "Store"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyProductRollup" ADD CONSTRAINT "DailyProductRollup_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyProductRollup" ADD CONSTRAINT "DailyProductRollup_storeId_accountId_fkey" FOREIGN KEY ("storeId", "accountId") REFERENCES "Store"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyProductRollup" ADD CONSTRAINT "DailyProductRollup_variantId_accountId_fkey" FOREIGN KEY ("variantId", "accountId") REFERENCES "ProductVariant"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStaffRollup" ADD CONSTRAINT "DailyStaffRollup_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStaffRollup" ADD CONSTRAINT "DailyStaffRollup_storeId_accountId_fkey" FOREIGN KEY ("storeId", "accountId") REFERENCES "Store"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStaffRollup" ADD CONSTRAINT "DailyStaffRollup_userId_accountId_fkey" FOREIGN KEY ("userId", "accountId") REFERENCES "User"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One default store per Account, and the store of every existing Account.
CREATE UNIQUE INDEX "Store_one_default_per_account" ON "Store"("accountId") WHERE "isDefault";
ALTER TABLE "Store" ADD CONSTRAINT "Store_name_check" CHECK (btrim("name") <> '' AND char_length("name") <= 160);
INSERT INTO "Store" ("id", "accountId", "name", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."id", left(a."name", 160), true, now(), now()
FROM "Account" a
WHERE NOT EXISTS (SELECT 1 FROM "Store" s WHERE s."accountId" = a."id" AND s."isDefault");

-- The timezone must be a name Postgres knows (an unknown name makes this expression fail).
ALTER TABLE "Account" ADD CONSTRAINT "Account_timezone_check"
  CHECK (char_length("timezone") BETWEEN 1 AND 64 AND (TIMESTAMPTZ '2000-01-01 00:00:00+00' AT TIME ZONE "timezone") IS NOT NULL);

-- One target per store (or per account when storeId is null), period and start; starts on a Monday / the 1st.
CREATE UNIQUE INDEX "SalesTarget_account_store_period_start_key"
  ON "SalesTarget"("accountId", "storeId", "period", "periodStart") NULLS NOT DISTINCT;
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_periodStart_check" CHECK (
  ("period" = 'WEEK' AND EXTRACT(ISODOW FROM "periodStart") = 1)
  OR ("period" = 'MONTH' AND EXTRACT(DAY FROM "periodStart") = 1)
);

CREATE UNIQUE INDEX "ClosedDay_account_store_date_key" ON "ClosedDay"("accountId", "storeId", "date") NULLS NOT DISTINCT;
ALTER TABLE "ClosedDay" ADD CONSTRAINT "ClosedDay_reason_check" CHECK ("reason" IS NULL OR char_length("reason") <= 160);

ALTER TABLE "DailySalesRollup" ADD CONSTRAINT "DailySalesRollup_counts_check" CHECK (
  "invoiceCount" >= 0 AND "piecesSold" >= 0 AND "returnsCount" >= 0 AND "cashCount" >= 0 AND "whishCount" >= 0
  AND "discountsTotal" >= 0 AND "returnsTotal" >= 0
);
ALTER TABLE "DailyProductRollup" ADD CONSTRAINT "DailyProductRollup_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "DailyStaffRollup" ADD CONSTRAINT "DailyStaffRollup_invoiceCount_check" CHECK ("invoiceCount" >= 0);

-- Same database boundary as every other table: the API reaches it through Prisma only.
ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesTarget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClosedDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailySalesRollup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyProductRollup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyStaffRollup" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "Store", "SalesTarget", "ClosedDay", "DailySalesRollup", "DailyProductRollup", "DailyStaffRollup"
FROM anon, authenticated;

COMMIT;
