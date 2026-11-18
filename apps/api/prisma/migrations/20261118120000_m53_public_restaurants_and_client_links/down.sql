DROP INDEX IF EXISTS "orders_claimed_by_user_idx";

ALTER TABLE "orders"
  DROP COLUMN IF EXISTS "claimedByUserId";

ALTER TABLE "branches"
  DROP COLUMN IF EXISTS "acceptingOrders",
  DROP COLUMN IF EXISTS "publicPhone";
