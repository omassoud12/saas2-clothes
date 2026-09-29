-- Unknown historical purchase cost is null, never zero. Existing snapshots remain unchanged.
ALTER TABLE "SaleItem" ALTER COLUMN "unitCostAtSale" DROP NOT NULL;
ALTER TABLE "DailyReport" ALTER COLUMN "grossCOGS" DROP NOT NULL;
ALTER TABLE "DailyReport" ALTER COLUMN "returnedCOGS" DROP NOT NULL;
ALTER TABLE "DailyReport" ALTER COLUMN "voidedCOGS" DROP NOT NULL;
ALTER TABLE "DailyReport" ALTER COLUMN "netCOGS" DROP NOT NULL;
ALTER TABLE "DailyReport" ALTER COLUMN "grossProfit" DROP NOT NULL;
ALTER TABLE "DailyReport" ALTER COLUMN "netProfit" DROP NOT NULL;
ALTER TABLE "DailyReport" ADD COLUMN "costStatus" varchar(10) NOT NULL DEFAULT 'COMPLETE';
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_cost_completeness_check" CHECK (("costStatus" = 'COMPLETE' AND "grossCOGS" IS NOT NULL AND "returnedCOGS" IS NOT NULL AND "voidedCOGS" IS NOT NULL AND "netCOGS" IS NOT NULL AND "grossProfit" IS NOT NULL AND "netProfit" IS NOT NULL) OR ("costStatus" = 'INCOMPLETE' AND "grossCOGS" IS NULL AND "returnedCOGS" IS NULL AND "voidedCOGS" IS NULL AND "netCOGS" IS NULL AND "grossProfit" IS NULL AND "netProfit" IS NULL));

CREATE OR REPLACE FUNCTION "validate_inventory_movement_reversal_cost"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  historical_unit_cost numeric(18,4);
  expected_quantity integer;
BEGIN
  IF NEW."type" = 'SALE' THEN
    SELECT si."quantity", si."unitCostAtSale"
    INTO expected_quantity, historical_unit_cost
    FROM "SaleItem" AS si
    WHERE si."id" = NEW."saleItemId"
      AND si."variantId" = NEW."variantId"
      AND si."accountId" = NEW."accountId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale movement must reference a matching sale item';
    END IF;

    IF NEW."quantityChange" IS DISTINCT FROM -expected_quantity THEN
      RAISE EXCEPTION 'sale movement quantity must negate the sale item quantity';
    END IF;

    IF NEW."unitCost" IS DISTINCT FROM historical_unit_cost
    THEN
      RAISE EXCEPTION 'sale movement unit cost must match unit cost at sale';
    END IF;

    RETURN NEW;
  ELSIF NEW."type" = 'RETURN' THEN
    SELECT sri."quantity", si."unitCostAtSale"
    INTO expected_quantity, historical_unit_cost
    FROM "SaleReturnItem" AS sri
    JOIN "SaleItem" AS si
      ON si."id" = sri."saleItemId"
     AND si."saleId" = sri."saleId"
     AND si."variantId" = sri."variantId"
     AND si."accountId" = sri."accountId"
    WHERE sri."id" = NEW."returnItemId"
      AND sri."variantId" = NEW."variantId"
      AND sri."accountId" = NEW."accountId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'return movement must reference a matching return item';
    END IF;

    IF NEW."quantityChange" IS DISTINCT FROM expected_quantity THEN
      RAISE EXCEPTION 'return movement quantity must equal the return item quantity';
    END IF;
  ELSIF NEW."type" = 'SALE_VOID' THEN
    SELECT si."quantity", si."unitCostAtSale"
    INTO expected_quantity, historical_unit_cost
    FROM "SaleItem" AS si
    WHERE si."id" = NEW."saleItemId"
      AND si."variantId" = NEW."variantId"
      AND si."accountId" = NEW."accountId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale void movement must reference a matching sale item';
    END IF;

    IF NEW."quantityChange" IS DISTINCT FROM expected_quantity THEN
      RAISE EXCEPTION 'sale void movement quantity must equal the sale item quantity';
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF NEW."unitCost" IS DISTINCT FROM historical_unit_cost
  THEN
    RAISE EXCEPTION 'reversal movement unit cost must match original unit cost at sale';
  END IF;

  RETURN NEW;
END;
$$;
