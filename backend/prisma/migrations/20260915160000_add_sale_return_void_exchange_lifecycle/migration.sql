-- AlterEnum
ALTER TYPE "SaleStatus" ADD VALUE 'VOIDED';

-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'RETURN' AFTER 'SALE';
ALTER TYPE "InventoryMovementType" ADD VALUE 'SALE_VOID' AFTER 'RETURN';

-- AlterTable
ALTER TABLE "Sale"
ADD COLUMN "voidedAt" TIMESTAMPTZ(3),
ADD COLUMN "voidedById" UUID,
ADD COLUMN "voidedByName" TEXT,
ADD COLUMN "voidedByCode" TEXT,
ADD COLUMN "voidReason" TEXT;

-- AlterTable
ALTER TABLE "InventoryMovement"
ADD COLUMN "returnItemId" UUID;

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "processedById" UUID NOT NULL,
    "processedByName" TEXT NOT NULL,
    "processedByCode" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnItem" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "saleItemId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "refundAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exchange" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "newSaleId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sale_voidedById_accountId_idx" ON "Sale"("voidedById", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleItem_id_saleId_variantId_accountId_key"
ON "SaleItem"("id", "saleId", "variantId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_id_accountId_key" ON "SaleReturn"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_id_saleId_accountId_key"
ON "SaleReturn"("id", "saleId", "accountId");

-- CreateIndex
CREATE INDEX "SaleReturn_accountId_saleId_createdAt_idx"
ON "SaleReturn"("accountId", "saleId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturn_saleId_accountId_idx" ON "SaleReturn"("saleId", "accountId");

-- CreateIndex
CREATE INDEX "SaleReturn_processedById_accountId_createdAt_idx"
ON "SaleReturn"("processedById", "accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturnItem_id_accountId_key"
ON "SaleReturnItem"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturnItem_id_variantId_accountId_key"
ON "SaleReturnItem"("id", "variantId", "accountId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_accountId_returnId_createdAt_idx"
ON "SaleReturnItem"("accountId", "returnId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturnItem_accountId_saleItemId_createdAt_idx"
ON "SaleReturnItem"("accountId", "saleItemId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturnItem_returnId_saleId_accountId_idx"
ON "SaleReturnItem"("returnId", "saleId", "accountId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_saleId_accountId_idx"
ON "SaleReturnItem"("saleId", "accountId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_saleItemId_saleId_variantId_accountId_idx"
ON "SaleReturnItem"("saleItemId", "saleId", "variantId", "accountId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_variantId_accountId_idx"
ON "SaleReturnItem"("variantId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_id_accountId_key" ON "Exchange"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_returnId_accountId_key"
ON "Exchange"("returnId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_newSaleId_accountId_key"
ON "Exchange"("newSaleId", "accountId");

-- CreateIndex
CREATE INDEX "Exchange_accountId_createdAt_idx" ON "Exchange"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_returnItemId_variantId_accountId_idx"
ON "InventoryMovement"("returnItemId", "variantId", "accountId");

-- AddForeignKey
ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_voidedById_accountId_fkey"
FOREIGN KEY ("voidedById", "accountId") REFERENCES "User"("id", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn"
ADD CONSTRAINT "SaleReturn_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn"
ADD CONSTRAINT "SaleReturn_saleId_accountId_fkey"
FOREIGN KEY ("saleId", "accountId") REFERENCES "Sale"("id", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn"
ADD CONSTRAINT "SaleReturn_processedById_accountId_fkey"
FOREIGN KEY ("processedById", "accountId") REFERENCES "User"("id", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem"
ADD CONSTRAINT "SaleReturnItem_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem"
ADD CONSTRAINT "SaleReturnItem_returnId_saleId_accountId_fkey"
FOREIGN KEY ("returnId", "saleId", "accountId")
REFERENCES "SaleReturn"("id", "saleId", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem"
ADD CONSTRAINT "SaleReturnItem_saleId_accountId_fkey"
FOREIGN KEY ("saleId", "accountId") REFERENCES "Sale"("id", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem"
ADD CONSTRAINT "SaleReturnItem_saleItemId_saleId_variantId_accountId_fkey"
FOREIGN KEY ("saleItemId", "saleId", "variantId", "accountId")
REFERENCES "SaleItem"("id", "saleId", "variantId", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem"
ADD CONSTRAINT "SaleReturnItem_variantId_accountId_fkey"
FOREIGN KEY ("variantId", "accountId") REFERENCES "ProductVariant"("id", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_returnItemId_variantId_accountId_fkey"
FOREIGN KEY ("returnItemId", "variantId", "accountId")
REFERENCES "SaleReturnItem"("id", "variantId", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exchange"
ADD CONSTRAINT "Exchange_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exchange"
ADD CONSTRAINT "Exchange_returnId_accountId_fkey"
FOREIGN KEY ("returnId", "accountId") REFERENCES "SaleReturn"("id", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exchange"
ADD CONSTRAINT "Exchange_newSaleId_accountId_fkey"
FOREIGN KEY ("newSaleId", "accountId") REFERENCES "Sale"("id", "accountId")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sale void metadata consistency
ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_void_metadata_check"
CHECK (
  (
    "status" = 'COMPLETED'
    AND "voidedAt" IS NULL
    AND "voidedById" IS NULL
    AND "voidedByName" IS NULL
    AND "voidedByCode" IS NULL
    AND "voidReason" IS NULL
  )
  OR (
    "status" = 'VOIDED'
    AND "voidedAt" IS NOT NULL
    AND "voidedById" IS NOT NULL
    AND "voidedByName" IS NOT NULL
    AND btrim("voidedByName") <> ''
    AND ("voidedByCode" IS NULL OR btrim("voidedByCode") <> '')
    AND "voidReason" IS NOT NULL
    AND btrim("voidReason") <> ''
  )
),
ADD CONSTRAINT "Sale_voidReason_length_check"
CHECK ("voidReason" IS NULL OR char_length("voidReason") <= 2000);

-- SaleReturn snapshot and reason validation
ALTER TABLE "SaleReturn"
ADD CONSTRAINT "SaleReturn_processor_snapshot_not_blank_check"
CHECK (
  btrim("processedByName") <> ''
  AND ("processedByCode" IS NULL OR btrim("processedByCode") <> '')
),
ADD CONSTRAINT "SaleReturn_reason_check"
CHECK ("reason" IS NULL OR btrim("reason") <> ''),
ADD CONSTRAINT "SaleReturn_reason_length_check"
CHECK ("reason" IS NULL OR char_length("reason") <= 2000);

-- SaleReturnItem quantity and refund validation
ALTER TABLE "SaleReturnItem"
ADD CONSTRAINT "SaleReturnItem_quantity_positive_check"
CHECK ("quantity" > 0),
ADD CONSTRAINT "SaleReturnItem_refundAmount_nonnegative_check"
CHECK ("refundAmount" >= 0);

-- Exchange must point to a distinct new Sale
CREATE FUNCTION "validate_exchange_link"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original_sale_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'historical exchanges cannot be updated';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'historical exchanges cannot be deleted';
  END IF;

  SELECT sr."saleId"
  INTO original_sale_id
  FROM "SaleReturn" AS sr
  WHERE sr."id" = NEW."returnId"
    AND sr."accountId" = NEW."accountId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exchange return must belong to the exchange account';
  END IF;

  IF original_sale_id = NEW."newSaleId" THEN
    RAISE EXCEPTION 'exchange new sale must differ from the returned sale';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Exchange_validate_and_preserve"
BEFORE INSERT OR UPDATE OR DELETE ON "Exchange"
FOR EACH ROW
EXECUTE FUNCTION "validate_exchange_link"();

-- Sale UPDATE owns the Sale row lock before this trigger checks for Return rows.
-- Sale lifecycle, immutable history, and return/void mutual exclusion
CREATE FUNCTION "enforce_sale_lifecycle_and_history"()
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

CREATE TRIGGER "Sale_enforce_lifecycle_and_history"
BEFORE INSERT OR UPDATE OR DELETE ON "Sale"
FOR EACH ROW
EXECUTE FUNCTION "enforce_sale_lifecycle_and_history"();

-- SaleReturn INSERT takes the same Sale row lock, serializing against void updates.
-- SaleReturn actor snapshots, append-only history, and Sale locking
CREATE FUNCTION "validate_and_preserve_sale_return"()
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

CREATE TRIGGER "SaleReturn_validate_and_preserve"
BEFORE INSERT OR UPDATE OR DELETE ON "SaleReturn"
FOR EACH ROW
EXECUTE FUNCTION "validate_and_preserve_sale_return"();

-- Lock each source SaleItem before checking the aggregate to serialize concurrent returns.
CREATE FUNCTION "prevent_sale_item_over_return"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sold_quantity integer;
  sold_unit_price numeric(18,2);
  already_returned integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'historical sale return items cannot be updated';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'historical sale return items cannot be deleted';
  END IF;

  SELECT si."quantity", si."unitSoldPrice"
  INTO sold_quantity, sold_unit_price
  FROM "SaleItem" AS si
  WHERE si."id" = NEW."saleItemId"
    AND si."saleId" = NEW."saleId"
    AND si."variantId" = NEW."variantId"
    AND si."accountId" = NEW."accountId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'returned item must match the sale, variant, and account';
  END IF;

  IF NEW."refundAmount" IS DISTINCT FROM NEW."quantity" * sold_unit_price THEN
    RAISE EXCEPTION 'refund amount must equal returned quantity times original unit sold price';
  END IF;

  SELECT COALESCE(SUM(sri."quantity"), 0)::integer
  INTO already_returned
  FROM "SaleReturnItem" AS sri
  WHERE sri."saleItemId" = NEW."saleItemId"
    AND sri."saleId" = NEW."saleId"
    AND sri."variantId" = NEW."variantId"
    AND sri."accountId" = NEW."accountId";

  IF already_returned + NEW."quantity" > sold_quantity THEN
    RAISE EXCEPTION 'cumulative returned quantity cannot exceed sold quantity';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "SaleReturnItem_prevent_over_return"
BEFORE INSERT OR UPDATE OR DELETE ON "SaleReturnItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_sale_item_over_return"();

-- Tighten existing SaleItem history protection to cover every update column.
CREATE OR REPLACE FUNCTION "prevent_sale_item_history_changes"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'historical sale items cannot be deleted';
  END IF;

  RAISE EXCEPTION 'historical sale items cannot be updated';
END;
$$;

DROP TRIGGER "SaleItem_prevent_history_update" ON "SaleItem";

CREATE TRIGGER "SaleItem_prevent_history_update"
BEFORE UPDATE ON "SaleItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_sale_item_history_changes"();

-- Inventory movement direction and history references
ALTER TABLE "InventoryMovement"
DROP CONSTRAINT "InventoryMovement_quantity_direction_check",
DROP CONSTRAINT "InventoryMovement_saleItem_reference_check";

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_quantity_direction_check"
CHECK (
  ("type" = 'RESTOCK' AND "quantityChange" > 0)
  OR ("type" = 'SALE' AND "quantityChange" < 0)
  OR ("type" = 'RETURN' AND "quantityChange" > 0)
  OR ("type" = 'SALE_VOID' AND "quantityChange" > 0)
  OR ("type" = 'DAMAGE' AND "quantityChange" < 0)
  OR ("type" = 'ADJUSTMENT' AND "quantityChange" <> 0)
),
ADD CONSTRAINT "InventoryMovement_history_reference_check"
CHECK (
  ("type" = 'RESTOCK' AND "saleItemId" IS NULL AND "returnItemId" IS NULL)
  OR ("type" = 'SALE' AND "saleItemId" IS NOT NULL AND "returnItemId" IS NULL)
  OR ("type" = 'RETURN' AND "saleItemId" IS NULL AND "returnItemId" IS NOT NULL)
  OR ("type" = 'SALE_VOID' AND "saleItemId" IS NOT NULL AND "returnItemId" IS NULL)
  OR ("type" IN ('DAMAGE', 'ADJUSTMENT') AND "saleItemId" IS NULL AND "returnItemId" IS NULL)
);

-- Inventory movement idempotency
CREATE UNIQUE INDEX "InventoryMovement_one_sale_per_sale_item_key"
ON "InventoryMovement"("saleItemId")
WHERE "type" = 'SALE';

CREATE UNIQUE INDEX "InventoryMovement_one_sale_void_per_sale_item_key"
ON "InventoryMovement"("saleItemId")
WHERE "type" = 'SALE_VOID';

CREATE UNIQUE INDEX "InventoryMovement_one_return_per_return_item_key"
ON "InventoryMovement"("returnItemId")
WHERE "type" = 'RETURN';

-- RETURN and SALE_VOID must reverse the immutable cost captured by SaleItem.
CREATE FUNCTION "validate_inventory_movement_reversal_cost"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  historical_unit_cost numeric(18,4);
BEGIN
  IF NEW."type" = 'RETURN' THEN
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

CREATE TRIGGER "InventoryMovement_validate_reversal_cost"
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION "validate_inventory_movement_reversal_cost"();

-- InventoryMovement append-only history
CREATE FUNCTION "prevent_inventory_movement_changes"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'historical inventory movements cannot be updated';
  END IF;

  RAISE EXCEPTION 'historical inventory movements cannot be deleted';
END;
$$;

CREATE TRIGGER "InventoryMovement_prevent_history_changes"
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION "prevent_inventory_movement_changes"();
