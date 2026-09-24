-- Required currency snapshots are safe because the development preflight found
-- no Expense or DailyReport rows. No default or backfill is used.
ALTER TABLE "Expense"
ADD COLUMN "currency" CHAR(3) NOT NULL;

ALTER TABLE "DailyReport"
ADD COLUMN "currency" CHAR(3) NOT NULL,
ALTER COLUMN "stockValue" DROP NOT NULL;

-- Expense values and descriptions must be meaningful authoritative history.
ALTER TABLE "Expense"
DROP CONSTRAINT "Expense_amount_nonnegative_check",
ADD CONSTRAINT "Expense_amount_positive_check"
CHECK ("amount" > 0),
ADD CONSTRAINT "Expense_description_valid_check"
CHECK (btrim("description") <> '' AND char_length("description") <= 2000);

-- Keep all existing DailyReport arithmetic checks; only make unavailable stock
-- valuation explicit as NULL rather than a fabricated zero.
ALTER TABLE "DailyReport"
DROP CONSTRAINT "DailyReport_nonnegative_magnitudes_check",
ADD CONSTRAINT "DailyReport_nonnegative_magnitudes_check" CHECK (
  "grossRevenue" >= 0
  AND "returnedRevenue" >= 0
  AND "voidedRevenue" >= 0
  AND "grossCOGS" >= 0
  AND "returnedCOGS" >= 0
  AND "voidedCOGS" >= 0
  AND "operatingExpenses" >= 0
  AND ("stockValue" IS NULL OR "stockValue" >= 0)
);

-- Currency snapshots must come from the tenant Account, never from client
-- authority. DailyReport validates both INSERT and cache-row UPDATE/upsert.
CREATE FUNCTION "validate_expense_currency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_currency char(3);
BEGIN
  SELECT "baseCurrency"
  INTO account_currency
  FROM "Account"
  WHERE "id" = NEW."accountId"
  FOR UPDATE;

  IF NOT FOUND OR NEW."currency" IS DISTINCT FROM account_currency THEN
    RAISE EXCEPTION 'expense currency must match account base currency';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Expense_validate_currency"
BEFORE INSERT ON "Expense"
FOR EACH ROW
EXECUTE FUNCTION "validate_expense_currency"();

CREATE FUNCTION "validate_daily_report_currency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_currency char(3);
BEGIN
  SELECT "baseCurrency"
  INTO account_currency
  FROM "Account"
  WHERE "id" = NEW."accountId"
  FOR UPDATE;

  IF NOT FOUND OR NEW."currency" IS DISTINCT FROM account_currency THEN
    RAISE EXCEPTION 'daily report currency must match account base currency';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "DailyReport_validate_currency"
BEFORE INSERT OR UPDATE ON "DailyReport"
FOR EACH ROW
EXECUTE FUNCTION "validate_daily_report_currency"();

-- Expense is append-only authoritative financial history in the MVP.
CREATE FUNCTION "prevent_expense_changes"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'historical expenses cannot be updated';
  END IF;

  RAISE EXCEPTION 'historical expenses cannot be deleted';
END;
$$;

CREATE TRIGGER "Expense_prevent_history_changes"
BEFORE UPDATE OR DELETE ON "Expense"
FOR EACH ROW
EXECUTE FUNCTION "prevent_expense_changes"();

-- Stable Expense history and tenant-wide Return/Void occurrence-date reporting.
CREATE INDEX "Expense_accountId_expenseDate_id_idx"
ON "Expense"("accountId", "expenseDate" DESC, "id" DESC);

CREATE INDEX "Sale_accountId_voidedAt_idx"
ON "Sale"("accountId", "voidedAt");

CREATE INDEX "SaleReturn_accountId_createdAt_idx"
ON "SaleReturn"("accountId", "createdAt");
