# Pre-migration database requirements

This document records PostgreSQL integrity rules that Prisma's schema language
cannot represent. Add these statements to the reviewed, create-only first
migration after Prisma generates the table DDL. Do not execute them separately
against production.

## Required check constraints

```sql
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
```

`grossProfit` and `netProfit` intentionally have no nonnegative constraint
because a valid reporting period can produce a loss.

For SaaS2 v1, SALE movements require a matching SaleItem. RESTOCK, DAMAGE, and
ADJUSTMENT movements must not reference one. Returns, exchanges, and voids are
deferred until their complete financial and inventory reversal models exist.

## Base-currency immutability

`Account.baseCurrency` is authoritative. Application code must reject changing
it after any inventory cost, inventory movement, expense, sale, or daily report
exists for the account. The first migration should also include this trigger:

```sql
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
```

Sale creation must also verify inside the transaction that `Sale.currency`
equals the account's authoritative `baseCurrency`.

## Sale employee identity

`soldById` is derived from the authenticated Supabase user and is never accepted
from frontend input. The tenant-aware Sale-to-User foreign key ensures that the
seller belongs to the same Account. The first migration should enforce the
allowed seller roles and immutable identity snapshots with this trigger:

```sql
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
```

An OWNER may have no employee code, in which case `sellerCodeAtSale` is `NULL`.
A WAREHOUSE user must have a nonblank employee code, and every WAREHOUSE sale
captures it.

## SaleItem historical immutability

Completed SaleItems are immutable accounting records. Add the following
function and triggers to the reviewed first migration:

```sql
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
```

## Application invariants

- Resolve `accountId` from the authenticated user; never accept it as authority
  from frontend input.
- Derive `Sale.soldById` from the authenticated Supabase user. Only active OWNER
  and WAREHOUSE users may perform tenant sales; SUPER_ADMIN may not.
- Capture `sellerNameAtSale` from the seller's first and last name and
  `sellerCodeAtSale` from their employee code inside the sale transaction.
- Calculate `Sale.subtotal` and `Sale.totalAmount` server-side in the atomic sale
  transaction. For v1 they are equal to the sum of SaleItem line totals because
  the actual per-item selling price already includes any negotiated reduction.
- Normalize email to lowercase and trim it before storage.
- Trim first and last names. Trim and consistently normalize employee codes
  within each Account. WAREHOUSE users must have a code; OWNER codes are
  optional.
- Trim Category names and compare their normalized lowercase form before create
  or rename. Database-level case-insensitive uniqueness is deferred.
- Trim SKU and normalize its case consistently per account. SKU must not be
  blank.
- Trim barcode and store an absent value as `NULL`, never an empty string.
- Trim color and size; store absent values as `NULL`. Use consistent canonical
  spelling/casing in application validation.
- Prefer user deactivation. Do not delete application users that are referenced
  by historical sales, expenses, products, or inventory movements.
- DailyReport is a rebuildable cache. Sale and SaleItem remain authoritative.

## Deferred security and history work

- No application User foreign key to `auth.users` is part of the first schema.
  `User.id` remains the Supabase Auth UUID.
- Sale seller, Product creator, Expense creator, and InventoryMovement performer
  relations are tenant-aware compound foreign keys. SUPER_ADMIN cannot perform
  tenant business operations.
- InventoryMovement must eventually become append-only through database
  privileges or a reviewed trigger. Corrections use compensating ADJUSTMENT
  movements; historical movements are never edited or deleted.
- RLS is deferred to a dedicated pre-production security step. The supported
  business-data path is Frontend -> Backend -> Prisma -> PostgreSQL; the frontend
  must not access business tables directly, and every backend operation must
  apply tenant filtering.
