-- Fix for 20261101090000_sale_payment_discount_receipt_and_rate: that migration added discounts
-- (subtotal = catalog total, totalAmount = what the customer paid, discountAmount = the difference,
-- checked by "Sale_discount_check") but left the original v1 rule "subtotal = totalAmount" in place,
-- so every discounted sale was rejected by the database. Sale_discount_check replaces it.
ALTER TABLE "Sale" DROP CONSTRAINT IF EXISTS "Sale_v1_totals_match_check";
