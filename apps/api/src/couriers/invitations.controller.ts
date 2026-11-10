import {
  Body,
  Controller,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { PrivacyRepository } from "../privacy/privacy.repository.js";
import { readCourierProfile } from "./courier-profile.js";
import { CourierRepository } from "./courier.repository.js";

@ApiTags("domiciliarios")
@Controller("v1/courier-invitations")
export class InvitationsController {
  constructor(
    private readonly couriers: CourierRepository,
    private readonly privacy: PrivacyRepository,
  ) {}

  @Post()
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Crea una invitación y muestra el token una sola vez" })
  async create(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; token: string; expiresAt: string }> {
    const userId = request.auth?.userId;
    const parsed = readRestaurant(body);
    if (userId === undefined || parsed === null) {
      throw new NotFoundException();
    }
    if (!(await this.couriers.canInvite(userId, parsed.restaurantId))) {
      throw new NotFoundException();
    }
    const created = await this.couriers.createInvitation({
      createdById: userId,
      restaurantId: parsed.restaurantId,
    });
    if (created === null) {
      throw new NotFoundException();
    }
    return created;
  }

  @Post(":token/accept")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Acepta una invitación sin aprobar al domiciliario" })
  async accept(
    @Param("token") token: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: "REGISTERING"; registrationSource: "INVITATION" }> {
    const userId = request.auth?.userId;
    const profile = readCourierProfile(body);
    if (userId === undefined || profile === null || token.trim() === "") {
      throw new NotFoundException();
    }
    if (!(await this.privacy.isCurrent(userId, "DOCUMENT_STORAGE"))) {
      throw new HttpException({ message: "Hace falta el consentimiento de documentos" }, 422);
    }
    const created = await this.couriers.acceptInvitation(token, { ...profile, userId });
    if (created === "missing") {
      throw new NotFoundException();
    }
    if (created === "conflict") {
      throw new HttpException({ message: "Ya existe un domiciliario con esos datos" }, 409);
    }
    if (created.status !== "REGISTERING") {
      throw new Error("Aceptar una invitación no puede aprobar al domiciliario");
    }
    return { id: created.id, status: "REGISTERING", registrationSource: "INVITATION" };
  }
}

function readRestaurant(body: unknown): { restaurantId: string | null } | null {
  if (typeof body !== "object" || body === null) {
    return { restaurantId: null };
  }
  const record = body as Record<string, unknown>;
  if (!("restaurantId" in record) || record["restaurantId"] === null) {
    return { restaurantId: null };
  }
  if (typeof record["restaurantId"] !== "string" || record["restaurantId"].trim() === "") {
    return null;
  }
  return { restaurantId: record["restaurantId"] };
}
