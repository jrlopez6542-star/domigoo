import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { PrivacyController } from "./privacy.controller.js";
import { PrivacyRepository } from "./privacy.repository.js";

@Module({
  imports: [IdentityModule],
  controllers: [PrivacyController],
  providers: [PrivacyRepository],
  exports: [PrivacyRepository],
})
export class PrivacyModule {}
