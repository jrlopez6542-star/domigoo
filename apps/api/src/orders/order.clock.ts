import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ExpirationRepository } from "./expiration.repository.js";

const MINUTE_MS = 60_000;

@Injectable()
export class OrderClock implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly expirations: ExpirationRepository) {}

  onModuleInit(): void {
    if (process.env["NODE_ENV"] === "test") {
      return;
    }
    this.timer = setInterval(() => {
      void this.expirations.expireStale(new Date()).catch(() => undefined);
    }, MINUTE_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
  }
}
