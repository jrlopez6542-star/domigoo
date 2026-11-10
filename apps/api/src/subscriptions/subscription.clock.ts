import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { SubscriptionRepository } from "./subscription.repository.js";

const MINUTE_MS = 60_000;

@Injectable()
export class SubscriptionClock implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly subscriptions: SubscriptionRepository) {}

  onModuleInit(): void {
    if (process.env["NODE_ENV"] === "test") {
      return;
    }
    this.timer = setInterval(() => {
      void this.subscriptions.advance(new Date()).catch(() => undefined);
    }, MINUTE_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
  }
}
