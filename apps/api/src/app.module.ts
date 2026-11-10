import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database.module.js";
import { HealthController } from "./health/health.controller.js";
import { ReadinessService } from "./health/readiness.service.js";
import { IdentityModule } from "./identity/identity.module.js";
import { PoliciesModule } from "./policies/policies.module.js";
import { PrivacyModule } from "./privacy/privacy.module.js";
import { TariffsModule } from "./tariffs/tariffs.module.js";
import { RestaurantsModule } from "./restaurants/restaurants.module.js";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module.js";
import { CouriersModule } from "./couriers/couriers.module.js";
import { VerificationModule } from "./verification/verification.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuditModule,
    IdentityModule,
    RestaurantsModule,
    PrivacyModule,
    TariffsModule,
    PoliciesModule,
    SubscriptionsModule,
    CouriersModule,
    VerificationModule,
  ],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class AppModule {}
