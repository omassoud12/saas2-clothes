-- Return idempotency is supplied deliberately by the future Return API.
-- The live preflight confirmed there are no SaleReturn rows, so no defaults
-- or invented backfill values are needed.
ALTER TABLE "SaleReturn"
ADD COLUMN "idempotencyKey" UUID NOT NULL,
ADD COLUMN "requestFingerprint" VARCHAR(64) NOT NULL;

ALTER TABLE "SaleReturn"
ADD CONSTRAINT "SaleReturn_requestFingerprint_format_check"
CHECK ("requestFingerprint" COLLATE "C" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "SaleReturn_accountId_idempotencyKey_key"
ON "SaleReturn"("accountId", "idempotencyKey");

-- Preserve all existing SaleReturn validation and make the new idempotency
-- metadata explicitly immutable. Every SaleReturn update remains forbidden.
CREATE OR REPLACE FUNCTION "validate_and_preserve_sale_return"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sale_status text;
  processor_role text;
  processor_active boolean;
  processor_name text;
  processor_code text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
       OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
    THEN
      RAISE EXCEPTION 'sale return idempotency metadata is immutable';
    END IF;

    RAISE EXCEPTION 'historical sale returns cannot be updated';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'historical sale returns cannot be deleted';
  END IF;

  SELECT s."status"::text
  INTO sale_status
  FROM "Sale" AS s
  WHERE s."id" = NEW."saleId"
    AND s."accountId" = NEW."accountId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'returned sale must belong to the return account';
  END IF;

  IF sale_status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'voided sales cannot receive returns';
  END IF;

  SELECT
    u."role"::text,
    u."isActive",
    btrim(concat_ws(' ', u."firstName", u."lastName")),
    u."employeeCode"
  INTO processor_role, processor_active, processor_name, processor_code
  FROM "User" AS u
  WHERE u."id" = NEW."processedById"
    AND u."accountId" = NEW."accountId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'return processor must belong to the return account';
  END IF;

  IF processor_role NOT IN ('OWNER', 'WAREHOUSE') OR NOT processor_active THEN
    RAISE EXCEPTION 'return processor must be an active OWNER or WAREHOUSE user';
  END IF;

  IF NEW."processedByName" IS DISTINCT FROM processor_name
     OR NEW."processedByCode" IS DISTINCT FROM processor_code
  THEN
    RAISE EXCEPTION 'return processor snapshots must match the current processor identity';
  END IF;

  RETURN NEW;
END;
$$;

-- Extend the existing movement validator without changing RESTOCK, DAMAGE, or
-- ADJUSTMENT behavior. SALE keeps its exact quantity and historical-cost
-- checks; RETURN and SALE_VOID gain exact positive reversal quantities while
-- retaining their trusted tenant-qualified references and historical costs.
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

    IF NEW."unitCost" IS NULL
       OR NEW."unitCost" IS DISTINCT FROM historical_unit_cost
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

  IF NEW."unitCost" IS NULL
     OR NEW."unitCost" IS DISTINCT FROM historical_unit_cost
  THEN
    RAISE EXCEPTION 'reversal movement unit cost must match original unit cost at sale';
  END IF;

  RETURN NEW;
END;
$$;
