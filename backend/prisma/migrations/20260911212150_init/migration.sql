-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'OWNER', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('RESTOCK', 'SALE', 'DAMAGE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "baseCurrency" CHAR(3) NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "employeeCode" TEXT,
    "role" "UserRole" NOT NULL,
    "accountId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "defaultProfitMargin" DECIMAL(7,4) NOT NULL DEFAULT 0.3000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "profitMarginOverride" DECIMAL(7,4),
    "createdById" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "color" TEXT,
    "size" TEXT,
    "averageCost" DECIMAL(18,4),
    "lastPurchaseCost" DECIMAL(18,2),
    "suggestedPrice" DECIMAL(18,2),
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "unitCost" DECIMAL(18,4),
    "performedById" UUID NOT NULL,
    "saleItemId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "expenseDate" DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "soldById" UUID NOT NULL,
    "sellerNameAtSale" TEXT NOT NULL,
    "sellerCodeAtSale" TEXT,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "productNameAtSale" TEXT NOT NULL,
    "categoryNameAtSale" TEXT NOT NULL,
    "skuAtSale" TEXT NOT NULL,
    "colorAtSale" TEXT,
    "sizeAtSale" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitSoldPrice" DECIMAL(18,2) NOT NULL,
    "unitCostAtSale" DECIMAL(18,4) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "reportDate" DATE NOT NULL,
    "revenue" DECIMAL(18,2) NOT NULL,
    "costOfGoodsSold" DECIMAL(18,2) NOT NULL,
    "grossProfit" DECIMAL(18,2) NOT NULL,
    "operatingExpenses" DECIMAL(18,2) NOT NULL,
    "netProfit" DECIMAL(18,2) NOT NULL,
    "salesCount" INTEGER NOT NULL,
    "totalUnitsSold" INTEGER NOT NULL,
    "stockValue" DECIMAL(18,2) NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_accountId_role_isActive_idx" ON "User"("accountId", "role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_accountId_key" ON "User"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "User_accountId_employeeCode_key" ON "User"("accountId", "employeeCode");

-- CreateIndex
CREATE INDEX "Category_accountId_isActive_idx" ON "Category"("accountId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Category_id_accountId_key" ON "Category"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_accountId_name_key" ON "Category"("accountId", "name");

-- CreateIndex
CREATE INDEX "Product_accountId_categoryId_isActive_idx" ON "Product"("accountId", "categoryId", "isActive");

-- CreateIndex
CREATE INDEX "Product_accountId_name_idx" ON "Product"("accountId", "name");

-- CreateIndex
CREATE INDEX "Product_categoryId_accountId_idx" ON "Product"("categoryId", "accountId");

-- CreateIndex
CREATE INDEX "Product_createdById_accountId_idx" ON "Product"("createdById", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_accountId_key" ON "Product"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_categoryId_accountId_key" ON "Product"("id", "categoryId", "accountId");

-- CreateIndex
CREATE INDEX "ProductVariant_accountId_productId_isActive_idx" ON "ProductVariant"("accountId", "productId", "isActive");

-- CreateIndex
CREATE INDEX "ProductVariant_accountId_currentStock_idx" ON "ProductVariant"("accountId", "currentStock");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_accountId_idx" ON "ProductVariant"("productId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_id_accountId_key" ON "ProductVariant"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_id_productId_accountId_key" ON "ProductVariant"("id", "productId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_accountId_sku_key" ON "ProductVariant"("accountId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_accountId_barcode_key" ON "ProductVariant"("accountId", "barcode");

-- CreateIndex
CREATE INDEX "InventoryMovement_accountId_createdAt_idx" ON "InventoryMovement"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_accountId_variantId_createdAt_idx" ON "InventoryMovement"("accountId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_accountId_type_createdAt_idx" ON "InventoryMovement"("accountId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_variantId_accountId_idx" ON "InventoryMovement"("variantId", "accountId");

-- CreateIndex
CREATE INDEX "InventoryMovement_performedById_accountId_idx" ON "InventoryMovement"("performedById", "accountId");

-- CreateIndex
CREATE INDEX "InventoryMovement_saleItemId_variantId_accountId_idx" ON "InventoryMovement"("saleItemId", "variantId", "accountId");

-- CreateIndex
CREATE INDEX "Expense_accountId_expenseDate_idx" ON "Expense"("accountId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_createdById_accountId_idx" ON "Expense"("createdById", "accountId");

-- CreateIndex
CREATE INDEX "Sale_accountId_createdAt_idx" ON "Sale"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_accountId_soldById_createdAt_idx" ON "Sale"("accountId", "soldById", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_accountId_status_createdAt_idx" ON "Sale"("accountId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_soldById_accountId_idx" ON "Sale"("soldById", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_id_accountId_key" ON "Sale"("id", "accountId");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_accountId_idx" ON "SaleItem"("saleId", "accountId");

-- CreateIndex
CREATE INDEX "SaleItem_accountId_categoryId_createdAt_idx" ON "SaleItem"("accountId", "categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleItem_accountId_productId_createdAt_idx" ON "SaleItem"("accountId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleItem_accountId_variantId_createdAt_idx" ON "SaleItem"("accountId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleItem_productId_categoryId_accountId_idx" ON "SaleItem"("productId", "categoryId", "accountId");

-- CreateIndex
CREATE INDEX "SaleItem_variantId_productId_accountId_idx" ON "SaleItem"("variantId", "productId", "accountId");

-- CreateIndex
CREATE INDEX "SaleItem_categoryId_accountId_idx" ON "SaleItem"("categoryId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleItem_id_variantId_accountId_key" ON "SaleItem"("id", "variantId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_accountId_reportDate_key" ON "DailyReport"("accountId", "reportDate");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_accountId_fkey" FOREIGN KEY ("categoryId", "accountId") REFERENCES "Category"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_createdById_accountId_fkey" FOREIGN KEY ("createdById", "accountId") REFERENCES "User"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_accountId_fkey" FOREIGN KEY ("productId", "accountId") REFERENCES "Product"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_variantId_accountId_fkey" FOREIGN KEY ("variantId", "accountId") REFERENCES "ProductVariant"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_performedById_accountId_fkey" FOREIGN KEY ("performedById", "accountId") REFERENCES "User"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_saleItemId_variantId_accountId_fkey" FOREIGN KEY ("saleItemId", "variantId", "accountId") REFERENCES "SaleItem"("id", "variantId", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_accountId_fkey" FOREIGN KEY ("createdById", "accountId") REFERENCES "User"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_soldById_accountId_fkey" FOREIGN KEY ("soldById", "accountId") REFERENCES "User"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_accountId_fkey" FOREIGN KEY ("saleId", "accountId") REFERENCES "Sale"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_categoryId_accountId_fkey" FOREIGN KEY ("productId", "categoryId", "accountId") REFERENCES "Product"("id", "categoryId", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_variantId_productId_accountId_fkey" FOREIGN KEY ("variantId", "productId", "accountId") REFERENCES "ProductVariant"("id", "productId", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_categoryId_accountId_fkey" FOREIGN KEY ("categoryId", "accountId") REFERENCES "Category"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Custom SaaS2 database integrity constraints and triggers
-- ============================================================

-- User, currency, margin, inventory, financial, and reporting constraints
ALTER TABLE "User"
  ADD CONSTRAINT "User_role_accountId_check"
  CHECK (
    ("role" = 'SUPER_ADMIN' AND "accountId" IS NULL)
    OR ("role" = 'OWNER' AND "accountId" IS NOT NULL)
    OR (
      "role" = 'WAREHOUSE'
      AND "accountId" IS NOT NULL
      AND "employeeCode" IS NOT NULL
      AND btrim("employeeCode") <> ''
    )
  ),
  ADD CONSTRAINT "User_name_not_blank_check"
  CHECK (btrim("firstName") <> '' AND btrim("lastName") <> ''),
  ADD CONSTRAINT "User_employeeCode_not_blank_check"
  CHECK ("employeeCode" IS NULL OR btrim("employeeCode") <> '');

ALTER TABLE "Account"
  ADD CONSTRAINT "Account_baseCurrency_format_check"
  CHECK ("baseCurrency" ~ '^[A-Z]{3}$');

ALTER TABLE "Category"
  ADD CONSTRAINT "Category_defaultProfitMargin_range_check"
  CHECK ("defaultProfitMargin" >= 0 AND "defaultProfitMargin" <= 1);

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_profitMarginOverride_range_check"
  CHECK (
    "profitMarginOverride" IS NULL
    OR ("profitMarginOverride" >= 0 AND "profitMarginOverride" <= 1)
  );

ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_stock_nonnegative_check"
  CHECK ("currentStock" >= 0),
  ADD CONSTRAINT "ProductVariant_costs_nonnegative_check"
  CHECK (
    ("averageCost" IS NULL OR "averageCost" >= 0)
    AND ("lastPurchaseCost" IS NULL OR "lastPurchaseCost" >= 0)
    AND ("suggestedPrice" IS NULL OR "suggestedPrice" >= 0)
  ),
  ADD CONSTRAINT "ProductVariant_sku_not_blank_check"
  CHECK (btrim("sku") <> ''),
  ADD CONSTRAINT "ProductVariant_barcode_not_blank_check"
  CHECK ("barcode" IS NULL OR btrim("barcode") <> '');

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_quantity_nonzero_check"
  CHECK ("quantityChange" <> 0),
  ADD CONSTRAINT "InventoryMovement_quantity_direction_check"
  CHECK (
    ("type" = 'RESTOCK' AND "quantityChange" > 0)
    OR ("type" IN ('SALE', 'DAMAGE') AND "quantityChange" < 0)
    OR ("type" = 'ADJUSTMENT' AND "quantityChange" <> 0)
  ),
  ADD CONSTRAINT "InventoryMovement_saleItem_reference_check"
  CHECK (
    ("type" = 'SALE' AND "saleItemId" IS NOT NULL)
    OR ("type" IN ('RESTOCK', 'DAMAGE', 'ADJUSTMENT') AND "saleItemId" IS NULL)
  ),
  ADD CONSTRAINT "InventoryMovement_unitCost_nonnegative_check"
  CHECK ("unitCost" IS NULL OR "unitCost" >= 0);

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_amount_nonnegative_check"
  CHECK ("amount" >= 0);

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_currency_format_check"
  CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Sale_seller_snapshot_not_blank_check"
  CHECK (
    btrim("sellerNameAtSale") <> ''
    AND ("sellerCodeAtSale" IS NULL OR btrim("sellerCodeAtSale") <> '')
  ),
  ADD CONSTRAINT "Sale_amounts_nonnegative_check"
  CHECK ("subtotal" >= 0 AND "totalAmount" >= 0),
  ADD CONSTRAINT "Sale_v1_totals_match_check"
  CHECK ("subtotal" = "totalAmount");

ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_quantity_positive_check"
  CHECK ("quantity" > 0),
  ADD CONSTRAINT "SaleItem_amounts_nonnegative_check"
  CHECK (
    "unitSoldPrice" >= 0
    AND "unitCostAtSale" >= 0
    AND "lineTotal" >= 0
  ),
  ADD CONSTRAINT "SaleItem_lineTotal_check"
  CHECK ("lineTotal" = "quantity" * "unitSoldPrice");

ALTER TABLE "DailyReport"
  ADD CONSTRAINT "DailyReport_counts_nonnegative_check"
  CHECK ("salesCount" >= 0 AND "totalUnitsSold" >= 0),
  ADD CONSTRAINT "DailyReport_nonnegative_values_check"
  CHECK (
    "revenue" >= 0
    AND "costOfGoodsSold" >= 0
    AND "operatingExpenses" >= 0
    AND "stockValue" >= 0
  ),
  ADD CONSTRAINT "DailyReport_grossProfit_calculation_check"
  CHECK ("grossProfit" = "revenue" - "costOfGoodsSold"),
  ADD CONSTRAINT "DailyReport_netProfit_calculation_check"
  CHECK ("netProfit" = "grossProfit" - "operatingExpenses");

-- Account base-currency immutability after real financial activity
CREATE FUNCTION "prevent_base_currency_change_after_financial_activity"()
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
           AND (
             "averageCost" IS NOT NULL
             OR "lastPurchaseCost" IS NOT NULL
           )
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

CREATE TRIGGER "Account_baseCurrency_immutable_after_activity"
BEFORE UPDATE OF "baseCurrency" ON "Account"
FOR EACH ROW
EXECUTE FUNCTION "prevent_base_currency_change_after_financial_activity"();

-- Sale seller authorization, identity snapshots, and immutability
CREATE FUNCTION "validate_and_preserve_sale_seller"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  seller_role text;
  seller_active boolean;
  seller_name text;
  seller_code text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
       OR NEW."soldById" IS DISTINCT FROM OLD."soldById"
       OR NEW."sellerNameAtSale" IS DISTINCT FROM OLD."sellerNameAtSale"
       OR NEW."sellerCodeAtSale" IS DISTINCT FROM OLD."sellerCodeAtSale"
    THEN
      RAISE EXCEPTION 'sale seller identity and snapshots are immutable';
    END IF;

    RETURN NEW;
  END IF;

  SELECT
    u."role"::text,
    u."isActive",
    btrim(concat_ws(' ', u."firstName", u."lastName")),
    u."employeeCode"
  INTO seller_role, seller_active, seller_name, seller_code
  FROM "User" AS u
  WHERE u."id" = NEW."soldById"
    AND u."accountId" = NEW."accountId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale seller must belong to the sale account';
  END IF;

  IF seller_role NOT IN ('OWNER', 'WAREHOUSE') OR NOT seller_active THEN
    RAISE EXCEPTION 'sale seller must be an active OWNER or WAREHOUSE user';
  END IF;

  IF NEW."sellerNameAtSale" IS DISTINCT FROM seller_name
     OR NEW."sellerCodeAtSale" IS DISTINCT FROM seller_code
  THEN
    RAISE EXCEPTION 'sale seller snapshots must match the current seller identity';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Sale_validate_and_preserve_seller"
BEFORE INSERT OR UPDATE OF
  "accountId", "soldById", "sellerNameAtSale", "sellerCodeAtSale"
ON "Sale"
FOR EACH ROW
EXECUTE FUNCTION "validate_and_preserve_sale_seller"();

-- SaleItem historical immutability
CREATE FUNCTION "prevent_sale_item_history_changes"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'historical sale items cannot be deleted';
  END IF;

  IF NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."saleId" IS DISTINCT FROM OLD."saleId"
     OR NEW."productId" IS DISTINCT FROM OLD."productId"
     OR NEW."variantId" IS DISTINCT FROM OLD."variantId"
     OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId"
     OR NEW."productNameAtSale" IS DISTINCT FROM OLD."productNameAtSale"
     OR NEW."categoryNameAtSale" IS DISTINCT FROM OLD."categoryNameAtSale"
     OR NEW."skuAtSale" IS DISTINCT FROM OLD."skuAtSale"
     OR NEW."colorAtSale" IS DISTINCT FROM OLD."colorAtSale"
     OR NEW."sizeAtSale" IS DISTINCT FROM OLD."sizeAtSale"
     OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
     OR NEW."unitSoldPrice" IS DISTINCT FROM OLD."unitSoldPrice"
     OR NEW."unitCostAtSale" IS DISTINCT FROM OLD."unitCostAtSale"
     OR NEW."lineTotal" IS DISTINCT FROM OLD."lineTotal"
  THEN
    RAISE EXCEPTION 'historical sale item fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "SaleItem_prevent_history_update"
BEFORE UPDATE OF
  "accountId", "saleId", "productId", "variantId", "categoryId",
  "productNameAtSale", "categoryNameAtSale", "skuAtSale",
  "colorAtSale", "sizeAtSale", "quantity", "unitSoldPrice",
  "unitCostAtSale", "lineTotal"
ON "SaleItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_sale_item_history_changes"();

CREATE TRIGGER "SaleItem_prevent_history_delete"
BEFORE DELETE ON "SaleItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_sale_item_history_changes"();
