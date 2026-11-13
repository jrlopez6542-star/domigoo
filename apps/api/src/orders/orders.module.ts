import { Module } from "@nestjs/common";
import { GeoModule } from "../geo/geo.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module.js";
import { TariffsModule } from "../tariffs/tariffs.module.js";
import { ExpirationRepository } from "./expiration.repository.js";
import { JourneyRepository } from "./journey.repository.js";
import { OffersController } from "./offers.controller.js";
import { OffersRepository } from "./offers.repository.js";
import { OrderClock } from "./order.clock.js";
import { OrderRepository } from "./order.repository.js";
import { OrdersController } from "./orders.controller.js";
import { PublishRepository } from "./publish.repository.js";

@Module({
  imports: [IdentityModule, TariffsModule, GeoModule, SubscriptionsModule],
  controllers: [OrdersController, OffersController],
  providers: [
    OrderRepository,
    PublishRepository,
    OffersRepository,
    JourneyRepository,
    ExpirationRepository,
    OrderClock,
  ],
  exports: [ExpirationRepository],
})
export class OrdersModule {}
