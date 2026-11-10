import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { PrivacyModule } from "../privacy/privacy.module.js";
import { CourierRepository } from "./courier.repository.js";
import { CouriersController } from "./couriers.controller.js";

@Module({
  imports: [IdentityModule, PrivacyModule],
  controllers: [CouriersController],
  providers: [CourierRepository],
})
export class CouriersModule {}
