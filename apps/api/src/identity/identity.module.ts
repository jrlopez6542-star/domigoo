import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { AuthController } from "./auth.controller.js";
import { IdentityRepository } from "./identity.repository.js";
import { IdentityService } from "./identity.service.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  controllers: [AuthController, AdminController],
  providers: [IdentityRepository, IdentityService, SessionGuard, AdminGuard],
  exports: [IdentityService, SessionGuard, AdminGuard],
})
export class IdentityModule {}
