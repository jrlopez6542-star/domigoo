import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { APP_ENV, type AppEnv } from "./config/env.js";
import { assertPreviewDatabaseAuthorized } from "./config/preview-db-guard.js";

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    assertPreviewDatabaseAuthorized({
      ...process.env,
      DATABASE_URL: env.databaseUrl,
    });
    this.pool = new Pool({ connectionString: env.databaseUrl, max: 4 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
