import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { TrackingController } from "./tracking.controller.js";
import { TrackingRepository } from "./tracking.repository.js";

@Module({
  imports: [IdentityModule],
  controllers: [TrackingController],
  providers: [TrackingRepository],
})
export class TrackingModule {}
