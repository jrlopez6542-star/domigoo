import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthController } from "./health/health.controller.js";
import { ReadinessService } from "./health/readiness.service.js";
import { IdentityModule } from "./identity/identity.module.js";

@Module({
  imports: [ConfigModule, IdentityModule],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class AppModule {}
