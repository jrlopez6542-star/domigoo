import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { RestaurantRepository, type MyBranchItem } from "./restaurant.repository.js";

type Slot = {
  weekday: number;
  opensMinute: number;
  closesMinute: number;
  closed: boolean;
};

@ApiTags("sucursales")
@Controller("v1/branches")
@UseGuards(SessionGuard)
export class BranchesController {
  constructor(private readonly restaurants: RestaurantRepository) {}

  @Get("mine")
  @ApiOperation({ summary: "Lista las sucursales de los restaurantes del usuario en sesión" })
  async mine(@Req() request: AuthenticatedRequest): Promise<{ branches: MyBranchItem[] }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const branches = await this.restaurants.listBranchesForUser(userId);
    if (branches === "forbidden") {
      throw new ForbiddenException();
    }
    return { branches };
  }

  @Put(":id/hours")
  @ApiOperation({ summary: "Reemplaza las franjas horarias de la sucursal" })
  async replaceHours(
    @Param("id") branchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ replaced: number }> {
    const userId = request.auth?.userId;
    const slots = readSlots(body);
    if (userId === undefined || slots === null) {
      throw new HttpException({ message: "Horario inválido" }, 422);
    }
    const replaced = await this.restaurants.replaceHours(branchId, userId, slots);
    if (!replaced) {
      throw new NotFoundException();
    }
    return { replaced: slots.length };
  }

  @Post(":id/activate")
  @ApiOperation({ summary: "Activa la sucursal si tiene punto y al menos una franja" })
  async activate(
    @Param("id") branchId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ status: "ACTIVE" }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const result = await this.restaurants.activateBranch(branchId, userId);
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "unready") {
      throw new HttpException({ message: "La sucursal necesita punto y horario" }, 422);
    }
    return { status: "ACTIVE" };
  }
}

function readSlots(body: unknown): Slot[] | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !("slots" in body) ||
    !Array.isArray(body.slots)
  ) {
    return null;
  }
  const slots: Slot[] = [];
  for (const item of body.slots) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const slot = item as Record<string, unknown>;
    const weekday = slot["weekday"];
    const opensMinute = slot["opensMinute"];
    const closesMinute = slot["closesMinute"];
    const closed = slot["closed"] === true;
    if (
      typeof weekday !== "number" ||
      typeof opensMinute !== "number" ||
      typeof closesMinute !== "number" ||
      !Number.isInteger(weekday) ||
      weekday < 1 ||
      weekday > 7 ||
      opensMinute < 0 ||
      opensMinute > 1439 ||
      closesMinute < 0 ||
      closesMinute > 1440
    ) {
      return null;
    }
    slots.push({ weekday, opensMinute, closesMinute, closed });
  }
  return slots;
}
