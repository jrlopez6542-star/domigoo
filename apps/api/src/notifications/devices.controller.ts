import {
  Body,
  Controller,
  HttpException,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { OutboxRepository } from "./outbox.repository.js";

@ApiTags("notificaciones")
@Controller("v1/devices")
@UseGuards(SessionGuard)
export class DevicesController {
  constructor(private readonly outbox: OutboxRepository) {}

  @Post("push-token")
  @ApiOperation({ summary: "Registra el token Android de notificaciones push para la cuenta" })
  async registerPushToken(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; platform: "ANDROID" }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const token = readToken(body);
    if (token === null) {
      throw new HttpException({ message: "Token push inválido" }, 422);
    }
    return this.outbox.registerPushToken(userId, token);
  }
}

function readToken(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const raw = (body as Record<string, unknown>)["token"];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length < 10 || trimmed.length > 512) {
    return null;
  }
  return trimmed;
}
