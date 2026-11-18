-- M53: Campos aditivos para perfil público de restaurantes y vinculación opcional de pedidos a cuenta de cliente
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "publicPhone" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "acceptingOrders" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "claimedByUserId" UUID REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "orders_claimed_by_user_idx"
  ON "orders"("claimedByUserId", "createdAt");
