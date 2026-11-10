import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { VerificationAdminController } from "./verification-admin.controller.js";
import { VerificationController } from "./verification.controller.js";
import { VerificationRepository } from "./verification.repository.js";

@Module({
  imports: [IdentityModule],
  controllers: [VerificationController, VerificationAdminController],
  providers: [VerificationRepository],
})
export class VerificationModule {}
