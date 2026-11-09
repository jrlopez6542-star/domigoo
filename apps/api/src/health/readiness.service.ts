import { Inject, Injectable } from "@nestjs/common";
import { Client } from "pg";
import { APP_ENV, type AppEnv } from "../config/env.js";

@Injectable()
export class ReadinessService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async canConnect(): Promise<boolean> {
    const client = new Client({
      connectionString: this.env.databaseUrl,
      connectionTimeoutMillis: 2000,
    });
    try {
      await client.connect();
      await client.query("SELECT PostGIS_Version()");
      return true;
    } catch {
      return false;
    } finally {
      try {
        await client.end();
      } catch {
        // La conexión no llegó a abrirse.
      }
    }
  }
}
