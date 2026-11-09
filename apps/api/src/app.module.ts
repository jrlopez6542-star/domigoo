import { Module } from "@nestjs/common";
import { APP_ENV, readEnv, type AppEnv } from "./config/env.js";
import { HealthController } from "./health/health.controller.js";
import { ReadinessService } from "./health/readiness.service.js";

@Module({
  controllers: [HealthController],
  providers: [
    ReadinessService,
    {
      provide: APP_ENV,
      useFactory: (): AppEnv => readEnv(process.env),
    },
  ],
})
export class AppModule {}
