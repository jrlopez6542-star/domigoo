import {
  Body,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditRecorder } from "../audit/audit.service.js";
import { validateTocancipaCoverage } from "../geo/tocancipa-coverage.js";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import {
  AllowOnboardingRestaurant,
  RestaurantMemberGuard,
  type RestaurantRequest,
} from "./restaurant.guard.js";
import { RestaurantRepository } from "./restaurant.repository.js";

@ApiTags("restaurantes")
@Controller("v1/restaurants")
export class RestaurantsController {
  constructor(
    private readonly restaurants: RestaurantRepository,
    private readonly audit: AuditRecorder,
  ) {}

  @Post()
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Crea restaurante, establecimiento y sucursal con punto" })
  async create(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{
    id: string;
    establishmentId: string;
    branchId: string;
    longitude: number;
    latitude: number;
    status: "DRAFT";
  }> {
    const ownerId = request.auth?.userId;
    const parsed = readSite(body);
    if (ownerId === undefined || parsed === null) {
      throw new NotFoundException();
    }
    const coverage = validateTocancipaCoverage({
      longitude: parsed.longitude,
      latitude: parsed.latitude,
    });
    if (!coverage.ok) {
      throw new HttpException({ code: coverage.code, message: coverage.message }, 422);
    }
    const created = await this.restaurants.createSite({ ...parsed, ownerId });
    return { ...created, status: "DRAFT" };
  }

  @Get(":id/site")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Lee la sede y el punto de la sucursal" })
  async site(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{
    id: string;
    establishmentId: string;
    branchId: string;
    longitude: number;
    latitude: number;
  }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const site = await this.restaurants.findSiteForMember(id, userId);
    if (site === null) {
      throw new NotFoundException();
    }
    return site;
  }

  @Get(":id")
  @AllowOnboardingRestaurant()
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

  @Post(":id/submit")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Pasa el restaurante de borrador a revisión" })
  async submit(
    @Param("id") restaurantId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ status: "PENDING_REVIEW" }> {
    const userId = request.auth?.userId;
    if (userId === undefined || !(await this.restaurants.submitRestaurant(restaurantId, userId))) {
      throw new NotFoundException();
    }
    return { status: "PENDING_REVIEW" };
  }
}

function readSite(body: unknown): {
  legalName: string;
  tradeName: string;
  nit: string;
  email: string;
  phoneE164: string;
  establishmentName: string;
  branchName: string;
  addressLine: string;
  longitude: number;
  latitude: number;
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const text = (key: string): string | null =>
    typeof record[key] === "string" && record[key].trim() !== "" ? record[key].trim() : null;
  const legalName = text("legalName");
  const tradeName = text("tradeName");
  const nit = text("nit");
  const email = text("email");
  const phoneE164 = text("phoneE164");
  const establishmentName = text("establishmentName");
  const branchName = text("branchName");
  const addressLine = text("addressLine");
  const longitude = record["longitude"];
  const latitude = record["latitude"];
  if (
    legalName === null ||
    tradeName === null ||
    nit === null ||
    email === null ||
    phoneE164 === null ||
    establishmentName === null ||
    branchName === null ||
    addressLine === null ||
    typeof longitude !== "number" ||
    typeof latitude !== "number" ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }
  return {
    legalName,
    tradeName,
    nit,
    email,
    phoneE164,
    establishmentName,
    branchName,
    addressLine,
    longitude,
    latitude,
  };
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
