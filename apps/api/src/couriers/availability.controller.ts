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
import { GeoRepository } from "../geo/geo.repository.js";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";

@ApiTags("domiciliarios")
@Controller("v1/couriers/me")
@UseGuards(SessionGuard)
export class AvailabilityController {
  constructor(private readonly geo: GeoRepository) {}

  @Post("availability")
  @ApiOperation({ summary: "Pasa a disponible solo con consentimiento de geolocalización" })
  async availability(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ state: "AVAILABLE" | "OFFLINE" }> {
    const userId = request.auth?.userId;
    const state = readState(body);
    if (userId === undefined || state === null) {
      throw new NotFoundException();
    }
    const result = await this.geo.setAvailability(userId, state);
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "not-approved") {
      throw new HttpException(
        { message: "El domiciliario debe estar aprobado para ponerse disponible" },
        422,
      );
    }
    if (result === "needs-consent") {
      throw new HttpException({ message: "Hace falta el consentimiento de geolocalización" }, 422);
    }
    return { state };
  }

  @Post("location")
  @ApiOperation({ summary: "Actualiza la posición vigente y guarda un ping" })
  async location(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ recorded: true }> {
    const userId = request.auth?.userId;
    const point = readPoint(body);
    if (userId === undefined || point === null) {
      throw new NotFoundException();
    }
    const result = await this.geo.recordPing({ userId, ...point });
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "needs-consent") {
      throw new HttpException({ message: "Hace falta el consentimiento de geolocalización" }, 422);
    }
    if (result === "unavailable") {
      throw new HttpException({ message: "La disponibilidad no está activa" }, 422);
    }
    return { recorded: true };
  }
}

function readState(body: unknown): "AVAILABLE" | "OFFLINE" | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const state = (body as Record<string, unknown>)["state"];
  if (state === "AVAILABLE" || state === "OFFLINE") {
    return state;
  }
  return null;
}

function readPoint(body: unknown): {
  longitude: number;
  latitude: number;
  accuracyM: number | null;
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const longitude = record["longitude"];
  const latitude = record["latitude"];
  if (!isCoord(longitude, -180, 180) || !isCoord(latitude, -90, 90)) {
    return null;
  }
  const accuracy = record["accuracyM"];
  if (accuracy !== undefined && accuracy !== null && !isCoord(accuracy, 0, 10000)) {
    return null;
  }
  return {
    longitude,
    latitude,
    accuracyM: typeof accuracy === "number" ? Math.round(accuracy) : null,
  };
}

function isCoord(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
