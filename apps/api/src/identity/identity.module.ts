import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { AuthController } from "./auth.controller.js";
import { IdentityRepository } from "./identity.repository.js";
import { IdentityService } from "./identity.service.js";
import { RestaurantRepository } from "../restaurants/restaurant.repository.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  controllers: [AuthController, AdminController],
  providers: [IdentityRepository, IdentityService, SessionGuard, AdminGuard, RestaurantRepository],
  exports: [IdentityService, SessionGuard, AdminGuard],
})
export class IdentityModule {}
