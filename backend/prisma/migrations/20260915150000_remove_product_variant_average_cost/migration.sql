-- DropConstraint
ALTER TABLE "ProductVariant"
DROP CONSTRAINT "ProductVariant_costs_nonnegative_check";

-- ReplaceFunction
CREATE OR REPLACE FUNCTION "prevent_base_currency_change_after_financial_activity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."baseCurrency" IS DISTINCT FROM OLD."baseCurrency"
     AND (
       EXISTS (
         SELECT 1
         FROM "ProductVariant"
         WHERE "accountId" = OLD."id"
           AND "lastPurchaseCost" IS NOT NULL
       )
       OR EXISTS (SELECT 1 FROM "InventoryMovement" WHERE "accountId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "Expense" WHERE "accountId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "Sale" WHERE "accountId" = OLD."id")
       OR EXISTS (SELECT 1 FROM "DailyReport" WHERE "accountId" = OLD."id")
     )
  THEN
    RAISE EXCEPTION 'baseCurrency cannot change after financial activity exists';
  END IF;

  RETURN NEW;
END;
$$;

-- DropColumn
ALTER TABLE "ProductVariant"
DROP COLUMN "averageCost";

-- AddConstraint
ALTER TABLE "ProductVariant"
ADD CONSTRAINT "ProductVariant_costs_nonnegative_check"
CHECK (
  ("lastPurchaseCost" IS NULL OR "lastPurchaseCost" >= 0)
  AND ("sellingPrice" IS NULL OR "sellingPrice" >= 0)
);
