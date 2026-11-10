import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { SubscriptionClock } from "./subscription.clock.js";
import { SubscriptionRepository } from "./subscription.repository.js";
import {
  SubscriptionAdminController,
  SubscriptionRestaurantController,
} from "./subscriptions.controller.js";

@Module({
  imports: [IdentityModule],
  controllers: [SubscriptionAdminController, SubscriptionRestaurantController],
  providers: [SubscriptionRepository, SubscriptionClock],
  exports: [SubscriptionRepository],
})
export class SubscriptionsModule {}
