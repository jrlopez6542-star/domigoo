import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminRepository } from "./admin.repository.js";

@Module({
  imports: [IdentityModule],
  controllers: [AdminController],
  providers: [AdminRepository],
})
export class AdminModule {}
