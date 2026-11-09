import { Module } from "@nestjs/common";
import { Database } from "../database.js";
import { AuthController } from "./auth.controller.js";
import { IdentityRepository } from "./identity.repository.js";
import { IdentityService } from "./identity.service.js";

@Module({
  controllers: [AuthController],
  providers: [Database, IdentityRepository, IdentityService],
  exports: [IdentityService, Database],
})
export class IdentityModule {}
