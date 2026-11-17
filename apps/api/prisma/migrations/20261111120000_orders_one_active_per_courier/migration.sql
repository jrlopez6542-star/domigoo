-- CreateIndex
CREATE UNIQUE INDEX "orders_one_active_per_courier" ON "orders"("assignedCourierId")
WHERE "status" IN ('ACCEPTED', 'ARRIVING_PICKUP', 'AT_PICKUP', 'PICKED_UP', 'AT_DROPOFF');
