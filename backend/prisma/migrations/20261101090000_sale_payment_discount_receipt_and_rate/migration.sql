-- Sale payment method, customer, discount, per-account receipt number, debt settlement and the USD->LBP rate.
--
-- Existing data is preserved as-is:
--   * existing Sales become paymentMethod CASH (the only way they could have been sold), discount 0,
--     no customer, no receipt number (they keep the short id reference) and no rate snapshot;
--   * existing SaleItems get discountAmount 0 and no listUnitPrice (their unitSoldPrice was always final);
--   * existing Accounts get lastReceiptNumber 0 and no exchange rate until the owner sets one.
-- No existing row is updated: every new column is nullable or has a default, so the immutability triggers on
-- Sale and SaleItem are never fired by this migration.

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'WHISH_OMT', 'DEBT');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "lastReceiptNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lbpPerUsd" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" DECIMAL(5,2),
ADD COLUMN     "lbpRateAtSale" DECIMAL(18,2),
ADD COLUMN     "paidAt" TIMESTAMPTZ(3),
ADD COLUMN     "paidByCode" TEXT,
ADD COLUMN     "paidById" UUID,
ADD COLUMN     "paidByName" TEXT,
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "receiptNumber" INTEGER;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "listUnitPrice" DECIMAL(18,2);

-- CreateIndex
CREATE INDEX "Sale_accountId_paymentMethod_createdAt_idx" ON "Sale"("accountId", "paymentMethod", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_accountId_paymentMethod_paidAt_idx" ON "Sale"("accountId", "paymentMethod", "paidAt");

-- CreateIndex
CREATE INDEX "Sale_paidById_accountId_idx" ON "Sale"("paidById", "accountId");

-- CreateIndex (NULL receipt numbers of old Sales never collide)
CREATE UNIQUE INDEX "Sale_accountId_receiptNumber_key" ON "Sale"("accountId", "receiptNumber");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_paidById_accountId_fkey" FOREIGN KEY ("paidById", "accountId") REFERENCES "User"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity checks (all existing rows already satisfy them)
ALTER TABLE "Account"
ADD CONSTRAINT "Account_lbpPerUsd_check" CHECK ("lbpPerUsd" IS NULL OR ("lbpPerUsd" > 0 AND "lbpPerUsd" <= 1000000000)),
ADD CONSTRAINT "Account_lastReceiptNumber_check" CHECK ("lastReceiptNumber" >= 0);

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_receiptNumber_check" CHECK ("receiptNumber" IS NULL OR "receiptNumber" > 0),
ADD CONSTRAINT "Sale_debt_customer_check" CHECK ("paymentMethod" <> 'DEBT' OR ("customerName" IS NOT NULL AND btrim("customerName") <> '')),
ADD CONSTRAINT "Sale_customer_length_check" CHECK (
  ("customerName" IS NULL OR char_length("customerName") <= 120)
  AND ("customerPhone" IS NULL OR char_length("customerPhone") <= 30)
),
ADD CONSTRAINT "Sale_discount_check" CHECK ("discountAmount" >= 0 AND "subtotal" - "totalAmount" = "discountAmount"),
ADD CONSTRAINT "Sale_discountPercent_check" CHECK ("discountPercent" IS NULL OR ("discountPercent" >= 0 AND "discountPercent" <= 100)),
ADD CONSTRAINT "Sale_lbpRateAtSale_check" CHECK ("lbpRateAtSale" IS NULL OR "lbpRateAtSale" > 0),
ADD CONSTRAINT "Sale_paid_only_debt_check" CHECK (
  ("paidAt" IS NULL AND "paidById" IS NULL AND "paidByName" IS NULL AND "paidByCode" IS NULL)
  OR ("paymentMethod" = 'DEBT' AND "paidAt" IS NOT NULL AND "paidById" IS NOT NULL AND "paidByName" IS NOT NULL)
);

ALTER TABLE "SaleItem"
ADD CONSTRAINT "SaleItem_discount_check" CHECK (
  "discountAmount" >= 0
  AND (
    ("listUnitPrice" IS NULL AND "discountAmount" = 0)
    OR ("listUnitPrice" IS NOT NULL AND "listUnitPrice" >= "unitSoldPrice"
        AND "discountAmount" = ("listUnitPrice" - "unitSoldPrice") * "quantity")
  )
);

-- Sale history trigger: the new Sale fields are immutable like the rest, and the only new allowed change is
-- settling a DEBT Sale once (paidAt, paidById and the paid-by snapshots together, by an active OWNER of the account).
CREATE OR REPLACE FUNCTION "enforce_sale_lifecycle_and_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_role text;
  actor_active boolean;
  actor_name text;
  actor_code text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'historical sales cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'COMPLETED' THEN
      RAISE EXCEPTION 'new sales must start COMPLETED';
    END IF;

    IF NEW."paidAt" IS NOT NULL OR NEW."paidById" IS NOT NULL OR NEW."paidByName" IS NOT NULL OR NEW."paidByCode" IS NOT NULL THEN
      RAISE EXCEPTION 'new sales cannot start settled';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."soldById" IS DISTINCT FROM OLD."soldById"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
     OR NEW."sellerNameAtSale" IS DISTINCT FROM OLD."sellerNameAtSale"
     OR NEW."sellerCodeAtSale" IS DISTINCT FROM OLD."sellerCodeAtSale"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
     OR NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount"
     OR NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber"
     OR NEW."paymentMethod" IS DISTINCT FROM OLD."paymentMethod"
     OR NEW."customerName" IS DISTINCT FROM OLD."customerName"
     OR NEW."customerPhone" IS DISTINCT FROM OLD."customerPhone"
     OR NEW."discountAmount" IS DISTINCT FROM OLD."discountAmount"
     OR NEW."discountPercent" IS DISTINCT FROM OLD."discountPercent"
     OR NEW."lbpRateAtSale" IS DISTINCT FROM OLD."lbpRateAtSale"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'historical sale fields are immutable';
  END IF;

  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'voided sales are immutable';
  END IF;

  -- Settling a debt: COMPLETED stays COMPLETED, only the paid-by fields change, once.
  IF NEW."status" = 'COMPLETED'
     AND (NEW."paidAt" IS DISTINCT FROM OLD."paidAt"
          OR NEW."paidById" IS DISTINCT FROM OLD."paidById"
          OR NEW."paidByName" IS DISTINCT FROM OLD."paidByName"
          OR NEW."paidByCode" IS DISTINCT FROM OLD."paidByCode")
  THEN
    IF OLD."status" <> 'COMPLETED' OR OLD."paymentMethod" <> 'DEBT' OR OLD."paidAt" IS NOT NULL OR NEW."paidAt" IS NULL THEN
      RAISE EXCEPTION 'only an unpaid DEBT sale can be settled, once';
    END IF;

    IF NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt"
       OR NEW."voidedById" IS DISTINCT FROM OLD."voidedById"
       OR NEW."voidedByName" IS DISTINCT FROM OLD."voidedByName"
       OR NEW."voidedByCode" IS DISTINCT FROM OLD."voidedByCode"
       OR NEW."voidReason" IS DISTINCT FROM OLD."voidReason"
    THEN
      RAISE EXCEPTION 'settling a sale cannot change void metadata';
    END IF;

    SELECT
      u."role"::text,
      u."isActive",
      btrim(concat_ws(' ', u."firstName", u."lastName")),
      u."employeeCode"
    INTO actor_role, actor_active, actor_name, actor_code
    FROM "User" AS u
    WHERE u."id" = NEW."paidById"
      AND u."accountId" = NEW."accountId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale settlement actor must belong to the sale account';
    END IF;

    IF actor_role <> 'OWNER' OR NOT actor_active THEN
      RAISE EXCEPTION 'sale settlement actor must be an active OWNER';
    END IF;

    IF NEW."paidByName" IS DISTINCT FROM actor_name
       OR NEW."paidByCode" IS DISTINCT FROM actor_code
    THEN
      RAISE EXCEPTION 'sale settlement actor snapshots must match the current actor identity';
    END IF;

    RETURN NEW;
  END IF;

  -- Only status, void metadata, and updatedAt may differ for the void transition.
  IF NEW."paidAt" IS DISTINCT FROM OLD."paidAt"
     OR NEW."paidById" IS DISTINCT FROM OLD."paidById"
     OR NEW."paidByName" IS DISTINCT FROM OLD."paidByName"
     OR NEW."paidByCode" IS DISTINCT FROM OLD."paidByCode"
  THEN
    RAISE EXCEPTION 'voiding a sale cannot change its settlement';
  END IF;

  IF OLD."status" <> 'COMPLETED' OR NEW."status" <> 'VOIDED' THEN
    RAISE EXCEPTION 'sale status transition from % to % is not allowed', OLD."status", NEW."status";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SaleReturn" AS sr
    WHERE sr."saleId" = OLD."id"
      AND sr."accountId" = OLD."accountId"
  ) THEN
    RAISE EXCEPTION 'a sale with returns cannot be voided';
  END IF;

  SELECT
    u."role"::text,
    u."isActive",
    btrim(concat_ws(' ', u."firstName", u."lastName")),
    u."employeeCode"
  INTO actor_role, actor_active, actor_name, actor_code
  FROM "User" AS u
  WHERE u."id" = NEW."voidedById"
    AND u."accountId" = NEW."accountId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale void actor must belong to the sale account';
  END IF;

  IF actor_role <> 'OWNER' OR NOT actor_active THEN
    RAISE EXCEPTION 'sale void actor must be an active OWNER';
  END IF;

  IF NEW."voidedByName" IS DISTINCT FROM actor_name
     OR NEW."voidedByCode" IS DISTINCT FROM actor_code
  THEN
    RAISE EXCEPTION 'sale void actor snapshots must match the current actor identity';
  END IF;

  RETURN NEW;
END;
$$;
