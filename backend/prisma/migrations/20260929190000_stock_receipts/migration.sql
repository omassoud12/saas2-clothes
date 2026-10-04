BEGIN;
ALTER TABLE "Product" ADD COLUMN "creationOperationId" UUID,
 ADD COLUMN "creationFingerprint" VARCHAR(64);
CREATE UNIQUE INDEX "Product_accountId_creationOperationId_key" ON "Product"("accountId","creationOperationId");
CREATE UNIQUE INDEX "InventoryMovement_id_variantId_accountId_key" ON "InventoryMovement"("id","variantId","accountId");
CREATE TABLE "StockReceipt" (
 "id" UUID NOT NULL, "accountId" UUID NOT NULL, "productId" UUID NOT NULL,
 "createdById" UUID NOT NULL, "operationId" UUID NOT NULL,
 "requestFingerprint" VARCHAR(64) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StockReceiptItem" (
 "id" UUID NOT NULL, "accountId" UUID NOT NULL, "productId" UUID NOT NULL,
 "receiptId" UUID NOT NULL, "variantId" UUID NOT NULL, "movementId" UUID NOT NULL,
 "quantity" INTEGER NOT NULL, "unitCost" DECIMAL(18,4) NOT NULL,
 CONSTRAINT "StockReceiptItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockReceipt_accountId_operationId_key" ON "StockReceipt"("accountId","operationId");
CREATE UNIQUE INDEX "StockReceipt_id_productId_accountId_key" ON "StockReceipt"("id","productId","accountId");
CREATE INDEX "StockReceipt_accountId_createdAt_id_idx" ON "StockReceipt"("accountId","createdAt","id");
CREATE INDEX "StockReceipt_accountId_productId_createdAt_idx" ON "StockReceipt"("accountId","productId","createdAt");
CREATE UNIQUE INDEX "StockReceiptItem_movementId_key" ON "StockReceiptItem"("movementId");
CREATE UNIQUE INDEX "StockReceiptItem_movementId_variantId_accountId_key" ON "StockReceiptItem"("movementId","variantId","accountId");
CREATE UNIQUE INDEX "StockReceiptItem_receiptId_variantId_key" ON "StockReceiptItem"("receiptId","variantId");
CREATE INDEX "StockReceiptItem_accountId_variantId_idx" ON "StockReceiptItem"("accountId","variantId");
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_productId_accountId_fkey" FOREIGN KEY ("productId","accountId") REFERENCES "Product"("id","accountId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_createdById_accountId_fkey" FOREIGN KEY ("createdById","accountId") REFERENCES "User"("id","accountId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_receiptId_productId_accountId_fkey" FOREIGN KEY ("receiptId","productId","accountId") REFERENCES "StockReceipt"("id","productId","accountId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_variantId_productId_accountId_fkey" FOREIGN KEY ("variantId","productId","accountId") REFERENCES "ProductVariant"("id","productId","accountId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_movementId_variantId_accountId_fkey" FOREIGN KEY ("movementId","variantId","accountId") REFERENCES "InventoryMovement"("id","variantId","accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_quantity_check" CHECK ("quantity" > 0 AND "quantity" <= 1000000);
ALTER TABLE "StockReceiptItem" ADD CONSTRAINT "StockReceiptItem_cost_check" CHECK ("unitCost" > 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_creation_operation_pair_check" CHECK (("creationOperationId" IS NULL) = ("creationFingerprint" IS NULL));
COMMIT;
