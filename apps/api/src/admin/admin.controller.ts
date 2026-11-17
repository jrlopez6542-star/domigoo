import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { AdminRepository, type AdminStats } from "./admin.repository.js";

@ApiTags("administracion")
@Controller("v1/admin")
@UseGuards(SessionGuard)
export class AdminController {
  constructor(private readonly admin: AdminRepository) {}

  @Post("couriers/:id/suspend")
  @ApiOperation({ summary: "Suspende un domiciliario con motivo obligatorio" })
  async suspendCourier(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: string }> {
    return this.runCourierSuspension(id, body, request, true);
  }

  @Post("couriers/:id/reinstate")
  @ApiOperation({ summary: "Rehabilita un domiciliario suspendido con motivo obligatorio" })
  async reinstateCourier(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: string }> {
    return this.runCourierSuspension(id, body, request, false);
  }

  @Post("restaurants/:id/suspend")
  @ApiOperation({ summary: "Suspende un restaurante con motivo obligatorio" })
  async suspendRestaurant(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: string }> {
    return this.runRestaurantSuspension(id, body, request, true);
  }

  @Post("restaurants/:id/reinstate")
  @ApiOperation({ summary: "Rehabilita un restaurante suspendido con motivo obligatorio" })
  async reinstateRestaurant(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: string }> {
    return this.runRestaurantSuspension(id, body, request, false);
  }

  @Get("stats")
  @ApiOperation({ summary: "Consulta estadísticas operativas agregadas sin PII ni PIN" })
  async getStats(
    @Query("from") rawFrom: string | undefined,
    @Query("to") rawTo: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<AdminStats> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const now = new Date();
    const from =
      rawFrom !== undefined && !Number.isNaN(Date.parse(rawFrom))
        ? new Date(rawFrom)
        : new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const to = rawTo !== undefined && !Number.isNaN(Date.parse(rawTo)) ? new Date(rawTo) : now;

    const stats = await this.admin.getStats({ userId, from, to });
    if (stats === "forbidden") {
      throw new ForbiddenException();
    }
    return stats;
  }

  private async runCourierSuspension(
    courierId: string,
    body: unknown,
    request: AuthenticatedRequest,
    suspend: boolean,
  ): Promise<{ id: string; status: string }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const reason = readReason(body);
    if (reason === null) {
      throw new HttpException({ message: "El motivo es obligatorio" }, 422);
    }
    const res = await this.admin.setCourierSuspension({ courierId, userId, suspend, reason });
    if (res === "missing") {
      throw new NotFoundException();
    }
    if (res === "forbidden") {
      throw new ForbiddenException();
    }
    return res;
  }

  private async runRestaurantSuspension(
    restaurantId: string,
    body: unknown,
    request: AuthenticatedRequest,
    suspend: boolean,
  ): Promise<{ id: string; status: string }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const reason = readReason(body);
    if (reason === null) {
      throw new HttpException({ message: "El motivo es obligatorio" }, 422);
    }
    const res = await this.admin.setRestaurantSuspension({ restaurantId, userId, suspend, reason });
    if (res === "missing") {
      throw new NotFoundException();
    }
    if (res === "forbidden") {
      throw new ForbiddenException();
    }
    return res;
  }
}

function readReason(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const raw = (body as Record<string, unknown>)["reason"];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return null;
  }
  return trimmed;
}
