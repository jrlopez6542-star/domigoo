import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditRecorder } from "../audit/audit.service.js";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { RestaurantMemberGuard, type RestaurantRequest } from "./restaurant.guard.js";
import { RestaurantRepository } from "./restaurant.repository.js";

@ApiTags("restaurantes")
@Controller("v1/restaurants")
export class RestaurantsController {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly audit: AuditRecorder,
  ) {}

  @Get(":id")
  @UseGuards(RestaurantMemberGuard)
  @ApiOperation({ summary: "Lee un restaurante si la sesión tiene una membresía activa" })
  getOne(@Req() request: RestaurantRequest): { id: string; tradeName: string } {
    const restaurant = request.restaurant;
    if (restaurant === undefined) {
      throw new NotFoundException();
    }
    return restaurant;
  }

  @Patch(":id/members/:userId")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Cambia el papel de una membresía. Solo el dueño." })
  async changeRole(
    @Param("id") restaurantId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ role: string }> {
    const role = readRole(body);
    const actorId = request.auth?.userId;
    if (actorId === undefined || role === null) {
      throw new NotFoundException();
    }
    const changed = await this.restaurants.changeRole({
      restaurantId,
      actorId,
      targetUserId: userId,
      role,
    });
    if (changed === null) {
      throw new NotFoundException();
    }
    await this.audit.record({
      actorId,
      actorKind: "RESTAURANT",
      action: "membership.role_changed",
      entityType: "restaurant_membership",
      entityId: changed.membershipId,
      diff: { role: { from: changed.from, to: changed.to } },
    });
    return { role: changed.to };
  }
}

function readRole(body: unknown): "OWNER" | "MANAGER" | "OPERATOR" | null {
  if (typeof body !== "object" || body === null || !("role" in body)) {
    return null;
  }
  const role = body.role;
  if (role === "OWNER" || role === "MANAGER" || role === "OPERATOR") {
    return role;
  }
  return null;
}
