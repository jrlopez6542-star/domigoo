import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import type { CourierOrderView } from "./journey.repository.js";
import { PinRepository } from "./pin.repository.js";
import type { PinKind } from "./pin.js";

@ApiTags("pedidos")
@Controller("v1/orders")
@UseGuards(SessionGuard)
export class PinController {
  constructor(private readonly pins: PinRepository) {}

  @Post(":id/pickup-pin")
  @ApiOperation({ summary: "Confirma el PIN de recogida del domiciliario asignado" })
  pickup(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CourierOrderView> {
    return this.confirm(id, request, "PICKUP", body, idempotencyKey);
  }

  @Post(":id/delivery-pin")
  @ApiOperation({ summary: "Confirma el PIN de entrega del domiciliario asignado" })
  delivery(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CourierOrderView> {
    return this.confirm(id, request, "DELIVERY", body, idempotencyKey);
  }

  private async confirm(
    id: string,
    request: AuthenticatedRequest,
    kind: PinKind,
    body: unknown,
    idempotencyKey: string | string[] | undefined,
  ): Promise<CourierOrderView> {
    const userId = request.auth?.userId;
    const key = Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey;
    const pin = readPin(body);
    if (userId === undefined) {
      throw new NotFoundException();
    }
    if (key === undefined || key.trim() === "") {
      throw new HttpException({ message: "Falta la clave de idempotencia" }, 422);
    }
    if (pin === null) {
      throw new HttpException({ message: "El PIN es obligatorio" }, 422);
    }
    const result = await this.pins.confirm(id, userId, kind, pin, key.trim());
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "forbidden") {
      throw new ForbiddenException();
    }
    if (result === "conflict") {
      throw new HttpException({ message: "Esa clave de idempotencia ya se usó" }, 409);
    }
    if (result === "invalid") {
      throw new HttpException({ message: "Ese paso no corresponde al estado del pedido" }, 422);
    }
    if (result === "rejected") {
      throw new HttpException({ message: "El PIN no corresponde" }, 422);
    }
    if (result === "locked") {
      throw new HttpException({ message: "El PIN quedó bloqueado" }, 422);
    }
    return result;
  }
}

function readPin(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const pin = (body as Record<string, unknown>)["pin"];
  if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) {
    return null;
  }
  return pin;
}
