import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { GeoRepository } from "./geo.repository.js";

@ApiTags("sucursales")
@Controller("v1/branches")
@UseGuards(SessionGuard)
export class BranchCandidatesController {
  constructor(private readonly geo: GeoRepository) {}

  @Get(":id/couriers")
  @ApiOperation({ summary: "Lista domiciliarios disponibles dentro del radio" })
  async list(
    @Param("id") branchId: string,
    @Query("radiusMeters") radiusRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string }[]> {
    const userId = request.auth?.userId;
    const radius = readRadius(radiusRaw);
    if (userId === undefined || radius === null) {
      throw new NotFoundException();
    }
    const found = await this.geo.candidates(branchId, userId, radius);
    if (found === "hidden") {
      throw new NotFoundException();
    }
    return found.ids.map((id) => ({ id }));
  }
}

function readRadius(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return null;
  }
  const radius = Number(raw);
  if (radius < 1 || radius > 50000) {
    return null;
  }
  return radius;
}
