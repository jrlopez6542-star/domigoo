import { Global, Module } from "@nestjs/common";
import { APP_ENV, readEnv, type AppEnv } from "./env.js";

@Global()
@Module({
  providers: [
    {
      provide: APP_ENV,
      useFactory: (): AppEnv => readEnv(process.env),
    },
  ],
  exports: [APP_ENV],
})
export class ConfigModule {}
