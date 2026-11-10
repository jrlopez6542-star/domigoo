import { Module } from "@nestjs/common";
import { GeoModule } from "../geo/geo.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module.js";
import { TariffsModule } from "../tariffs/tariffs.module.js";
import { OrderRepository } from "./order.repository.js";
import { OrdersController } from "./orders.controller.js";
import { PublishRepository } from "./publish.repository.js";

@Module({
  imports: [IdentityModule, TariffsModule, GeoModule, SubscriptionsModule],
  controllers: [OrdersController],
  providers: [OrderRepository, PublishRepository],
})
export class OrdersModule {}
