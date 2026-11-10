import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database.module.js";
import { HealthController } from "./health/health.controller.js";
import { ReadinessService } from "./health/readiness.service.js";
import { IdentityModule } from "./identity/identity.module.js";
import { PrivacyModule } from "./privacy/privacy.module.js";
import { TariffsModule } from "./tariffs/tariffs.module.js";
import { RestaurantsModule } from "./restaurants/restaurants.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuditModule,
    IdentityModule,
    RestaurantsModule,
    PrivacyModule,
    TariffsModule,
  ],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class AppModule {}
