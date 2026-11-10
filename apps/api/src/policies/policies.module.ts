import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { PoliciesController } from "./policies.controller.js";
import { PolicyRepository } from "./policy.repository.js";

@Module({
  imports: [IdentityModule],
  controllers: [PoliciesController],
  providers: [PolicyRepository],
})
export class PoliciesModule {}
