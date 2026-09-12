-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "isActive",
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMPTZ(3),
ADD COLUMN     "reviewedById" UUID,
ADD COLUMN     "status" "AccountStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Account_status_createdAt_idx" ON "Account"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Account_reviewedById_idx" ON "Account"("reviewedById");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Account approval status and review-field consistency
ALTER TABLE "Account"
  ADD CONSTRAINT "Account_status_review_fields_check"
  CHECK (
    (
      "status" = 'PENDING'
      AND "reviewedAt" IS NULL
      AND "reviewedById" IS NULL
      AND "rejectionReason" IS NULL
    )
    OR (
      "status" = 'ACTIVE'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
      AND "rejectionReason" IS NULL
    )
    OR (
      "status" = 'REJECTED'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
      AND "rejectionReason" IS NOT NULL
      AND btrim("rejectionReason") <> ''
    )
    OR (
      "status" = 'SUSPENDED'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
      AND "rejectionReason" IS NULL
    )
  ),
  ADD CONSTRAINT "Account_rejectionReason_length_check"
  CHECK (
    "rejectionReason" IS NULL
    OR char_length("rejectionReason") <= 2000
  );

-- Enforce the initial PENDING state and the currently approved lifecycle transitions.
-- This trigger rejects invalid writes and never rewrites historical review fields.
CREATE FUNCTION "enforce_account_status_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reviewer_role text;
  reviewer_account_id uuid;
  reviewer_is_active boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING'
       OR NEW."reviewedAt" IS NOT NULL
       OR NEW."reviewedById" IS NOT NULL
       OR NEW."rejectionReason" IS NOT NULL
    THEN
      RAISE EXCEPTION 'new accounts must start PENDING with empty review fields';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    IF NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
       OR NEW."reviewedById" IS DISTINCT FROM OLD."reviewedById"
       OR NEW."rejectionReason" IS DISTINCT FROM OLD."rejectionReason"
    THEN
      RAISE EXCEPTION 'account review fields may change only during an allowed status transition';
    END IF;

    RETURN NEW;
  END IF;

  IF OLD."status" = 'PENDING'
     AND NEW."status" IN ('ACTIVE', 'REJECTED')
  THEN
    IF NEW."reviewedAt" IS NULL OR NEW."reviewedById" IS NULL THEN
      RAISE EXCEPTION 'account review requires reviewedAt and reviewedById';
    END IF;

    SELECT u."role"::text, u."accountId", u."isActive"
    INTO reviewer_role, reviewer_account_id, reviewer_is_active
    FROM "User" AS u
    WHERE u."id" = NEW."reviewedById";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'account reviewer must reference an existing user';
    END IF;

    IF reviewer_role <> 'SUPER_ADMIN'
       OR reviewer_account_id IS NOT NULL
       OR NOT reviewer_is_active
    THEN
      RAISE EXCEPTION 'account reviewer must be an active SUPER_ADMIN without an account';
    END IF;

    IF NEW."status" = 'ACTIVE' AND NEW."rejectionReason" IS NOT NULL THEN
      RAISE EXCEPTION 'approved accounts cannot have a rejection reason';
    END IF;

    IF NEW."status" = 'REJECTED'
       AND (
         NEW."rejectionReason" IS NULL
         OR btrim(NEW."rejectionReason") = ''
       )
    THEN
      RAISE EXCEPTION 'rejected accounts require a nonblank rejection reason';
    END IF;

    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'SUSPENDED' THEN
    IF NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
       OR NEW."reviewedById" IS DISTINCT FROM OLD."reviewedById"
       OR NEW."rejectionReason" IS DISTINCT FROM OLD."rejectionReason"
    THEN
      RAISE EXCEPTION 'suspension must preserve the original account review fields';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'account status transition from % to % is not allowed', OLD."status", NEW."status";
END;
$$;

CREATE TRIGGER "Account_enforce_status_transition"
BEFORE INSERT OR UPDATE OF
  "status", "reviewedAt", "reviewedById", "rejectionReason"
ON "Account"
FOR EACH ROW
EXECUTE FUNCTION "enforce_account_status_transition"();
