ALTER TABLE "DailyReport"
DROP CONSTRAINT "DailyReport_nonnegative_values_check",
DROP CONSTRAINT "DailyReport_grossProfit_calculation_check",
DROP CONSTRAINT "DailyReport_netProfit_calculation_check";

ALTER TABLE "DailyReport"
DROP COLUMN "revenue",
DROP COLUMN "costOfGoodsSold",
ADD COLUMN "grossRevenue" DECIMAL(18, 2) NOT NULL DEFAULT 0,
ADD COLUMN "returnedRevenue" DECIMAL(18, 2) NOT NULL DEFAULT 0,
ADD COLUMN "voidedRevenue" DECIMAL(18, 2) NOT NULL DEFAULT 0,
ADD COLUMN "netRevenue" DECIMAL(18, 2) NOT NULL DEFAULT 0,
ADD COLUMN "grossCOGS" DECIMAL(18, 2) NOT NULL DEFAULT 0,
ADD COLUMN "returnedCOGS" DECIMAL(18, 2) NOT NULL DEFAULT 0,
ADD COLUMN "voidedCOGS" DECIMAL(18, 2) NOT NULL DEFAULT 0,
ADD COLUMN "netCOGS" DECIMAL(18, 2) NOT NULL DEFAULT 0,
ALTER COLUMN "grossProfit" SET DEFAULT 0,
ALTER COLUMN "operatingExpenses" SET DEFAULT 0,
ALTER COLUMN "netProfit" SET DEFAULT 0;

ALTER TABLE "DailyReport"
ADD CONSTRAINT "DailyReport_nonnegative_magnitudes_check" CHECK (
  "grossRevenue" >= 0
  AND "returnedRevenue" >= 0
  AND "voidedRevenue" >= 0
  AND "grossCOGS" >= 0
  AND "returnedCOGS" >= 0
  AND "voidedCOGS" >= 0
  AND "operatingExpenses" >= 0
  AND "stockValue" >= 0
),
ADD CONSTRAINT "DailyReport_netRevenue_calculation_check" CHECK (
  "netRevenue" = "grossRevenue" - "returnedRevenue" - "voidedRevenue"
),
ADD CONSTRAINT "DailyReport_netCOGS_calculation_check" CHECK (
  "netCOGS" = "grossCOGS" - "returnedCOGS" - "voidedCOGS"
),
ADD CONSTRAINT "DailyReport_grossProfit_calculation_check" CHECK (
  "grossProfit" = "netRevenue" - "netCOGS"
),
ADD CONSTRAINT "DailyReport_netProfit_calculation_check" CHECK (
  "netProfit" = "grossProfit" - "operatingExpenses"
);
