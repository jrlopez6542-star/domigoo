import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { TariffRepository } from "./tariff.repository.js";
import { TariffsController } from "./tariffs.controller.js";

@Module({
  imports: [IdentityModule],
  controllers: [TariffsController],
  providers: [TariffRepository],
})
export class TariffsModule {}
