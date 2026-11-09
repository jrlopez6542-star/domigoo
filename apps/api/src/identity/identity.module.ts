import { Module } from "@nestjs/common";
import { Database } from "../database.js";
import { AdminController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { AuthController } from "./auth.controller.js";
import { IdentityRepository } from "./identity.repository.js";
import { IdentityService } from "./identity.service.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  controllers: [AuthController, AdminController],
  providers: [Database, IdentityRepository, IdentityService, SessionGuard, AdminGuard],
  exports: [IdentityService, Database, SessionGuard, AdminGuard],
})
export class IdentityModule {}
