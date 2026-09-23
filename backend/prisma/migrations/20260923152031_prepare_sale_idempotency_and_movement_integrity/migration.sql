-- Sale creation idempotency is supplied deliberately by the future API.
-- The live preflight confirmed there are no Sale rows, so no defaults or
-- invented backfill values are needed.
ALTER TABLE "Sale"
ADD COLUMN "idempotencyKey" UUID NOT NULL,
ADD COLUMN "requestFingerprint" VARCHAR(64) NOT NULL;

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_requestFingerprint_format_check"
CHECK ("requestFingerprint" COLLATE "C" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "Sale_accountId_idempotencyKey_key"
ON "Sale"("accountId", "idempotencyKey");

-- Keep Sale idempotency metadata immutable with the existing Sale history.
CREATE OR REPLACE FUNCTION "enforce_sale_lifecycle_and_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  voider_role text;
  voider_active boolean;
  voider_name text;
  voider_code text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'historical sales cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'COMPLETED' THEN
      RAISE EXCEPTION 'new sales must start COMPLETED';
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
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'historical sale fields are immutable';
  END IF;

  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'voided sales are immutable';
  END IF;

  -- Only status, void metadata, and updatedAt may differ for this transition.
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
  INTO voider_role, voider_active, voider_name, voider_code
  FROM "User" AS u
  WHERE u."id" = NEW."voidedById"
    AND u."accountId" = NEW."accountId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale void actor must belong to the sale account';
  END IF;

  IF voider_role <> 'OWNER' OR NOT voider_active THEN
    RAISE EXCEPTION 'sale void actor must be an active OWNER';
  END IF;

  IF NEW."voidedByName" IS DISTINCT FROM voider_name
     OR NEW."voidedByCode" IS DISTINCT FROM voider_code
  THEN
    RAISE EXCEPTION 'sale void actor snapshots must match the current actor identity';
  END IF;

  RETURN NEW;
END;
$$;

-- Extend the existing INSERT validator. RETURN and SALE_VOID retain their
-- historical-cost checks; SALE additionally validates exact quantity and cost.
CREATE OR REPLACE FUNCTION "validate_inventory_movement_reversal_cost"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  historical_unit_cost numeric(18,4);
  sold_quantity integer;
BEGIN
  IF NEW."type" = 'SALE' THEN
    SELECT si."quantity", si."unitCostAtSale"
    INTO sold_quantity, historical_unit_cost
    FROM "SaleItem" AS si
    WHERE si."id" = NEW."saleItemId"
      AND si."variantId" = NEW."variantId"
      AND si."accountId" = NEW."accountId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale movement must reference a matching sale item';
    END IF;

    IF NEW."quantityChange" IS DISTINCT FROM -sold_quantity THEN
      RAISE EXCEPTION 'sale movement quantity must negate the sale item quantity';
    END IF;

    IF NEW."unitCost" IS NULL
       OR NEW."unitCost" IS DISTINCT FROM historical_unit_cost
    THEN
      RAISE EXCEPTION 'sale movement unit cost must match unit cost at sale';
    END IF;

    RETURN NEW;
  ELSIF NEW."type" = 'RETURN' THEN
    SELECT si."unitCostAtSale"
    INTO historical_unit_cost
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
  ELSIF NEW."type" = 'SALE_VOID' THEN
    SELECT si."unitCostAtSale"
    INTO historical_unit_cost
    FROM "SaleItem" AS si
    WHERE si."id" = NEW."saleItemId"
      AND si."variantId" = NEW."variantId"
      AND si."accountId" = NEW."accountId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale void movement must reference a matching sale item';
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
