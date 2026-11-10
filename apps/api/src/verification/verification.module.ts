import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { VerificationController } from "./verification.controller.js";
import { VerificationRepository } from "./verification.repository.js";

@Module({
  imports: [IdentityModule],
  controllers: [VerificationController],
  providers: [VerificationRepository],
})
export class VerificationModule {}
