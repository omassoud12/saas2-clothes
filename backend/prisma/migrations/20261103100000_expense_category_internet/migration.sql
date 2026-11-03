-- Owner Dashboard: the INTERNET expense category. On its own because a new enum value cannot be used
-- in the transaction that adds it.
ALTER TYPE "ExpenseCategory" ADD VALUE IF NOT EXISTS 'INTERNET' BEFORE 'OTHER';
