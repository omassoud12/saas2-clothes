-- Business data is available only through the Express/Prisma backend. RLS has
-- no anon/authenticated policies, so these roles remain deny-by-default even
-- if a table privilege is granted accidentally later.
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleReturn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleReturnItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Exchange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyReport" ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  "Account",
  "User",
  "Category",
  "Product",
  "ProductVariant",
  "InventoryMovement",
  "Expense",
  "Sale",
  "SaleItem",
  "SaleReturn",
  "SaleReturnItem",
  "Exchange",
  "DailyReport"
FROM anon, authenticated;

-- Prisma migration metadata is infrastructure rather than business data, but
-- public Data API roles must not be able to inspect or corrupt it.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM anon, authenticated;

-- The live catalog confirms postgres owns and creates the application objects.
-- Keep future public application tables and sequences closed by default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
