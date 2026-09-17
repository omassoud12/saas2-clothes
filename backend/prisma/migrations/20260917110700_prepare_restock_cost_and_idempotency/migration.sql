-- Widen the current purchase cost to match movement and sale cost snapshots.
ALTER TABLE "ProductVariant"
ALTER COLUMN "lastPurchaseCost" TYPE DECIMAL(18,4);

-- RESTOCK idempotency metadata is immutable with the movement row. Other
-- movement types must leave both fields null.
ALTER TABLE "InventoryMovement"
ADD COLUMN "idempotencyKey" UUID,
ADD COLUMN "requestFingerprint" VARCHAR(64);

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_restock_unit_cost_positive_check"
CHECK (
  "type" <> 'RESTOCK'
  OR ("unitCost" IS NOT NULL AND "unitCost" > 0)
),
ADD CONSTRAINT "InventoryMovement_restock_idempotency_check"
CHECK (
  ("type" = 'RESTOCK' AND "idempotencyKey" IS NOT NULL AND "requestFingerprint" IS NOT NULL)
  OR ("type" <> 'RESTOCK' AND "idempotencyKey" IS NULL AND "requestFingerprint" IS NULL)
),
ADD CONSTRAINT "InventoryMovement_request_fingerprint_format_check"
CHECK (
  "requestFingerprint" IS NULL
  OR "requestFingerprint" COLLATE "C" ~ '^[0-9a-f]{64}$'
);

CREATE UNIQUE INDEX "InventoryMovement_accountId_restock_idempotencyKey_key"
ON "InventoryMovement"("accountId", "idempotencyKey")
WHERE "type" = 'RESTOCK' AND "idempotencyKey" IS NOT NULL;
