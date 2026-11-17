import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { TariffRepository } from "./tariff.repository.js";
import { TariffQuoteController, TariffsController } from "./tariffs.controller.js";

@Module({
  imports: [IdentityModule],
  controllers: [TariffsController, TariffQuoteController],
  providers: [TariffRepository],
  exports: [TariffRepository],
})
export class TariffsModule {}
