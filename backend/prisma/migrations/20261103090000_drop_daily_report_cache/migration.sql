-- Drop the DailyReport cache table. Financial reports are computed live from the ledger
-- (src/reports/financial.service.ts) and the Business reports use their own rollup tables, so
-- nothing reads this table; its only writer, the rebuild service, was never called and is removed.
-- Refuses to run if the table holds rows, so no report data can be lost by mistake.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DailyReport") THEN
    RAISE EXCEPTION 'DailyReport is not empty: refusing to drop it';
  END IF;
END $$;

DROP TABLE "DailyReport";

COMMIT;
