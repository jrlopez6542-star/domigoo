import { Module } from "@nestjs/common";
import { GeoModule } from "../geo/geo.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { PrivacyModule } from "../privacy/privacy.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { AvailabilityController } from "./availability.controller.js";
import { CourierFilesController } from "./courier-files.controller.js";
import { CourierFilesRepository } from "./courier-files.repository.js";
import { CourierRepository } from "./courier.repository.js";
import { CouriersController } from "./couriers.controller.js";
import { InvitationsController } from "./invitations.controller.js";

@Module({
  imports: [IdentityModule, PrivacyModule, StorageModule, GeoModule],
  controllers: [
    CouriersController,
    InvitationsController,
    CourierFilesController,
    AvailabilityController,
  ],
  providers: [CourierRepository, CourierFilesRepository],
})
export class CouriersModule {}
