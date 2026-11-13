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
import { GeoModule } from "./geo/geo.module.js";
import { IncidentsModule } from "./incidents/incidents.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { OrdersModule } from "./orders/orders.module.js";
import { TrackingModule } from "./tracking/tracking.module.js";
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
    GeoModule,
    IncidentsModule,
    NotificationsModule,
    OrdersModule,
    TrackingModule,
    VerificationModule,
  ],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class AppModule {}
