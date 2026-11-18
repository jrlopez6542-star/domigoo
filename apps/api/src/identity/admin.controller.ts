import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditRecorder } from "../audit/audit.service.js";
import { Database } from "../database.js";
import { RestaurantRepository } from "../restaurants/restaurant.repository.js";
import { AdminGuard, type AdminRequest } from "./admin.guard.js";

const PLATFORM_ROLES = ["SUPERADMIN", "REVIEWER", "OPERATIONS", "SECURITY"] as const;
type PlatformRole = (typeof PLATFORM_ROLES)[number];

@ApiTags("admin")
@Controller("v1/admin")
export class AdminController {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditRecorder,
    private readonly restaurants: RestaurantRepository,
  ) {}

  @Get("me")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Confirma el papel de administración de la sesión" })
  me(@Req() request: AdminRequest): { role: string } {
    if (request.adminRole === undefined || request.auth === undefined) {
      throw new NotFoundException();
    }
    return { role: request.adminRole };
  }

  @Patch("profiles/:userId")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Cambia el papel de un administrador. Solo superadmin." })
  async changeRole(
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ): Promise<{ role: string }> {
    if (request.adminRole !== "SUPERADMIN" || request.auth === undefined) {
      throw new NotFoundException();
    }
    const role = readPlatformRole(body);
    if (role === null) {
      throw new NotFoundException();
    }
    const current = await this.database.pool.query<{ role: string }>(
      `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
      [userId],
    );
    const previous = current.rows[0]?.role;
    if (previous === undefined) {
      throw new NotFoundException();
    }
    await this.database.pool.query(
      `UPDATE admin_profiles SET role = $2::"PlatformRole", "updatedAt" = now() WHERE "userId" = $1`,
      [userId, role],
    );
    await this.audit.record({
      actorId: request.auth.userId,
      actorKind: "ADMIN",
      action: "admin.role_changed",
      entityType: "admin_profile",
      entityId: userId,
      diff: { role: { from: previous, to: role } },
    });
    return { role };
  }

  @Post("restaurants/:id/activate")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Activa un restaurante que está en revisión" })
  async activateRestaurant(
    @Param("id", ParseUUIDPipe) restaurantId: string,
    @Req() request: AdminRequest,
  ): Promise<{ status: "ACTIVE" }> {
    if (request.auth === undefined) {
      throw new NotFoundException();
    }
    const activated = await this.restaurants.activateRestaurant(restaurantId);
    if (!activated) {
      throw new NotFoundException();
    }
    await this.audit.record({
      actorId: request.auth.userId,
      actorKind: "ADMIN",
      action: "restaurant.activated",
      entityType: "restaurant",
      entityId: restaurantId,
      diff: { status: { from: "PENDING_REVIEW", to: "ACTIVE" } },
    });
    return { status: "ACTIVE" };
  }
}

function readPlatformRole(body: unknown): PlatformRole | null {
  if (typeof body !== "object" || body === null || !("role" in body)) {
    return null;
  }
  const role = body.role;
  return PLATFORM_ROLES.find((item) => item === role) ?? null;
}
