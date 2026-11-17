import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { DevicesController } from "./devices.controller.js";
import { OutboxClock } from "./outbox.clock.js";
import { OutboxRepository } from "./outbox.repository.js";
import { createPushSenderFromEnv, PUSH_SENDER } from "./push-sender.port.js";

@Module({
  imports: [IdentityModule],
  controllers: [DevicesController],
  providers: [
    {
      provide: PUSH_SENDER,
      useFactory: () => createPushSenderFromEnv(),
    },
    OutboxRepository,
    OutboxClock,
  ],
  exports: [OutboxRepository, PUSH_SENDER],
})
export class NotificationsModule {}
