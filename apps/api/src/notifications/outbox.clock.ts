import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { OutboxRepository } from "./outbox.repository.js";

const MINUTE_MS = 60_000;

@Injectable()
export class OutboxClock implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly outbox: OutboxRepository) {}

  onModuleInit(): void {
    if (process.env["NODE_ENV"] === "test") {
      return;
    }
    this.timer = setInterval(() => {
      void this.outbox.drain(new Date()).catch(() => undefined);
    }, MINUTE_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
  }
}
