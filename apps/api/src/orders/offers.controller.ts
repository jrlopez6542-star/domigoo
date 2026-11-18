import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import {
  OffersRepository,
  type AcceptResult,
  type AvailableOfferItem,
} from "./offers.repository.js";

@ApiTags("ofertas")
@Controller("v1/offers")
@UseGuards(SessionGuard)
export class OffersController {
  constructor(private readonly offers: OffersRepository) {}

  @Get("available")
  @ApiOperation({
    summary: "Lista las ofertas pendientes disponibles para el domiciliario en sesión",
  })
  async available(@Req() request: AuthenticatedRequest): Promise<{ offers: AvailableOfferItem[] }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const offers = await this.offers.listAvailableForUser(userId);
    if (offers === "forbidden") {
      throw new ForbiddenException();
    }
    return { offers };
  }

  @Post(":id/accept")
  @ApiOperation({ summary: "Acepta una oferta en exclusiva" })
  async accept(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<AcceptResult> {
    const userId = request.auth?.userId;
    const key = Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey;
    if (userId === undefined || key === undefined || key.trim() === "") {
      throw new HttpException({ message: "Falta la clave de idempotencia" }, 422);
    }
    const result = await this.offers.accept(id, userId, key.trim(), body ?? {});
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "conflict" || result === "mismatch") {
      throw new HttpException({ message: "La oferta ya no se puede aceptar" }, 409);
    }
    return result;
  }

  @Post(":id/decline")
  @ApiOperation({ summary: "Rechaza una oferta pendiente" })
  async decline(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ offerId: string; status: "DECLINED" }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const result = await this.offers.decline(id, userId);
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "conflict") {
      throw new HttpException({ message: "La oferta ya no se puede rechazar" }, 409);
    }
    return result;
  }
}
