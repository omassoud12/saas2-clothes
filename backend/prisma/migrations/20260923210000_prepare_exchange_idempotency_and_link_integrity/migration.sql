-- Exchange idempotency is supplied deliberately by the future Exchange API.
-- The live preflight confirmed there are no Exchange rows, so no defaults or
-- invented backfill values are needed.
ALTER TABLE "Exchange"
ADD COLUMN "idempotencyKey" UUID NOT NULL,
ADD COLUMN "requestFingerprint" VARCHAR(64) NOT NULL;

ALTER TABLE "Exchange"
ADD CONSTRAINT "Exchange_requestFingerprint_format_check"
CHECK ("requestFingerprint" COLLATE "C" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "Exchange_accountId_idempotencyKey_key"
ON "Exchange"("accountId", "idempotencyKey");

-- Preserve append-only history and validate the complete Exchange link when it
-- is created. Later Sale lifecycle changes remain governed by the Sale trigger.
CREATE OR REPLACE FUNCTION "validate_exchange_link"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original_sale_id uuid;
  original_currency text;
  replacement_status text;
  replacement_currency text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'historical exchanges cannot be updated';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'historical exchanges cannot be deleted';
  END IF;

  SELECT sr."saleId", original_sale."currency"::text
  INTO original_sale_id, original_currency
  FROM "SaleReturn" AS sr
  JOIN "Sale" AS original_sale
    ON original_sale."id" = sr."saleId"
   AND original_sale."accountId" = sr."accountId"
  WHERE sr."id" = NEW."returnId"
    AND sr."accountId" = NEW."accountId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exchange return must belong to the exchange account';
  END IF;

  SELECT replacement_sale."status"::text, replacement_sale."currency"::text
  INTO replacement_status, replacement_currency
  FROM "Sale" AS replacement_sale
  WHERE replacement_sale."id" = NEW."newSaleId"
    AND replacement_sale."accountId" = NEW."accountId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exchange replacement sale must belong to the exchange account';
  END IF;

  IF original_sale_id = NEW."newSaleId" THEN
    RAISE EXCEPTION 'exchange new sale must differ from the returned sale';
  END IF;

  IF replacement_status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'exchange replacement sale must be completed when linked';
  END IF;

  IF original_currency IS DISTINCT FROM replacement_currency THEN
    RAISE EXCEPTION 'exchange original and replacement sales must use the same currency';
  END IF;

  RETURN NEW;
END;
$$;
