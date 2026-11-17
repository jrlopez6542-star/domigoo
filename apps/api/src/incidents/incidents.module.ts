import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { IncidentsController } from "./incidents.controller.js";
import { IncidentsRepository } from "./incidents.repository.js";

@Module({
  imports: [IdentityModule],
  controllers: [IncidentsController],
  providers: [IncidentsRepository],
})
export class IncidentsModule {}
