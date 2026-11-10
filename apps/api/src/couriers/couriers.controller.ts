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
import { PrivacyRepository } from "../privacy/privacy.repository.js";
import { readCourierProfile } from "./courier-profile.js";
import { CourierRepository } from "./courier.repository.js";

@ApiTags("domiciliarios")
@Controller("v1/couriers")
@UseGuards(SessionGuard)
export class CouriersController {
  constructor(
    private readonly couriers: CourierRepository,
    private readonly privacy: PrivacyRepository,
  ) {}

  @Post()
  @ApiOperation({ summary: "Abre el registro de un domiciliario" })
  async register(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: "REGISTERING" }> {
    const userId = request.auth?.userId;
    const draft = readCourierProfile(body);
    if (userId === undefined || draft === null) {
      throw new NotFoundException();
    }
    const consented = await this.privacy.isCurrent(userId, "DOCUMENT_STORAGE");
    if (!consented) {
      throw new HttpException({ message: "Hace falta el consentimiento de documentos" }, 422);
    }
    const created = await this.couriers.registerOpen({ ...draft, userId });
    if (created === "conflict") {
      throw new HttpException({ message: "Ya existe un domiciliario con esos datos" }, 409);
    }
    if (created.status !== "REGISTERING") {
      throw new Error("El alta no puede aprobar al domiciliario");
    }
    return { id: created.id, status: "REGISTERING" };
  }
}
