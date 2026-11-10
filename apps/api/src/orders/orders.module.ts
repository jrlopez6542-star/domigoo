import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { OrderRepository } from "./order.repository.js";
import { OrdersController } from "./orders.controller.js";

@Module({
  imports: [IdentityModule],
  controllers: [OrdersController],
  providers: [OrderRepository],
})
export class OrdersModule {}
