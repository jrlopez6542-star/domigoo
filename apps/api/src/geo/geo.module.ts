import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { BranchCandidatesController } from "./branch-candidates.controller.js";
import { GeoRepository } from "./geo.repository.js";

@Module({
  imports: [IdentityModule],
  controllers: [BranchCandidatesController],
  providers: [GeoRepository],
  exports: [GeoRepository],
})
export class GeoModule {}
