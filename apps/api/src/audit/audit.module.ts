import { Global, Module } from "@nestjs/common";
import { AuditRecorder } from "./audit.service.js";

@Global()
@Module({
  providers: [AuditRecorder],
  exports: [AuditRecorder],
})
export class AuditModule {}
