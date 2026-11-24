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
import { validateTocancipaCoverage } from "../geo/tocancipa-coverage.js";
import { denyReviewer } from "../identity/admin-roles.js";
import { AdminGuard, type AdminRequest } from "../identity/admin.guard.js";
import { SessionGuard } from "../identity/session.guard.js";
import { TariffRepository, type TariffQuote } from "./tariff.repository.js";

@ApiTags("tarifas")
@Controller("v1/tariffs")
@UseGuards(SessionGuard)
export class TariffQuoteController {
  constructor(private readonly tariffs: TariffRepository) {}

  @Post("quote")
  @ApiOperation({ summary: "Cotiza el domicilio con la tarifa publicada para sesión autenticada" })
  async quote(@Body() body: unknown): Promise<TariffQuote> {
    const parsed = readQuote(body);
    if (parsed === null) {
      throw new NotFoundException();
    }
    const originCheck = validateTocancipaCoverage(parsed.origin);
    if (!originCheck.ok) {
      throw new HttpException({ code: originCheck.code, message: originCheck.message }, 422);
    }
    const destinationCheck = validateTocancipaCoverage(parsed.destination);
    if (!destinationCheck.ok) {
      throw new HttpException(
        { code: destinationCheck.code, message: destinationCheck.message },
        422,
      );
    }
    const quote = await this.tariffs.quote(parsed);
    if (quote === null) {
      throw new NotFoundException();
    }
    return quote;
  }
}

@ApiTags("tarifas")
@Controller("v1/admin/tariffs")
@UseGuards(AdminGuard)
export class TariffsController {
  constructor(private readonly tariffs: TariffRepository) {}

  @Post("versions")
  @ApiOperation({ summary: "Crea una versión de tarifa en borrador" })
  async createVersion(
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ): Promise<{ id: string }> {
    denyReviewer(request.adminRole);
    const name = readName(body);
    if (name === null) {
      throw new NotFoundException();
    }
    return { id: await this.tariffs.createVersion(name) };
  }

  @Post("zones")
  @ApiOperation({ summary: "Agrega un polígono a una versión" })
  async addZone(@Body() body: unknown, @Req() request: AdminRequest): Promise<{ id: string }> {
    denyReviewer(request.adminRole);
    const parsed = readZone(body);
    if (parsed === null) {
      throw new NotFoundException();
    }
    return { id: await this.tariffs.addZone(parsed) };
  }

  @Post("rules")
  @ApiOperation({ summary: "Agrega una regla en pesos enteros" })
  async addRule(@Body() body: unknown, @Req() request: AdminRequest): Promise<{ created: true }> {
    denyReviewer(request.adminRole);
    const parsed = readRule(body);
    if (parsed === null) {
      throw new NotFoundException();
    }
    await this.tariffs.addRule(parsed);
    return { created: true };
  }

  @Post("publish")
  @ApiOperation({ summary: "Publica una versión y retira la anterior" })
  async publish(@Body() body: unknown, @Req() request: AdminRequest): Promise<{ published: true }> {
    denyReviewer(request.adminRole);
    const versionId = readId(body, "versionId");
    if (versionId === null || !(await this.tariffs.publish(versionId))) {
      throw new NotFoundException();
    }
    return { published: true };
  }

  @Post("quote")
  @ApiOperation({ summary: "Cotiza el domicilio con la tarifa publicada" })
  async quote(@Body() body: unknown, @Req() request: AdminRequest): Promise<TariffQuote> {
    denyReviewer(request.adminRole);
    const parsed = readQuote(body);
    if (parsed === null) {
      throw new NotFoundException();
    }
    const quote = await this.tariffs.quote(parsed);
    if (quote === null) {
      throw new NotFoundException();
    }
    return quote;
  }
}

function readName(body: unknown): string | null {
  if (!isRecord(body) || typeof body["name"] !== "string" || body["name"].trim() === "") {
    return null;
  }
  return body["name"].trim();
}

function readId(body: unknown, key: string): string | null {
  if (!isRecord(body) || typeof body[key] !== "string") {
    return null;
  }
  return body[key];
}

function readZone(body: unknown): {
  versionId: string;
  code: string;
  name: string;
  polygonWkt: string;
  priority: number;
} | null {
  if (!isRecord(body)) {
    return null;
  }
  const versionId = body["versionId"];
  const code = body["code"];
  const name = body["name"];
  const polygonWkt = body["polygonWkt"];
  const priority = body["priority"];
  if (
    typeof versionId !== "string" ||
    typeof code !== "string" ||
    typeof name !== "string" ||
    typeof polygonWkt !== "string" ||
    typeof priority !== "number"
  ) {
    return null;
  }
  return { versionId, code, name, polygonWkt, priority };
}

function readRule(body: unknown): {
  versionId: string;
  zoneId: string | null;
  baseFeeCop: number;
  perKmCop: number;
  minimumFeeCop: number;
  nightMultiplierBps: number;
  nightStartsMinute: number;
  nightEndsMinute: number;
} | null {
  if (!isRecord(body)) {
    return null;
  }
  const numbers = [
    "baseFeeCop",
    "perKmCop",
    "minimumFeeCop",
    "nightMultiplierBps",
    "nightStartsMinute",
    "nightEndsMinute",
  ] as const;
  if (typeof body["versionId"] !== "string") {
    return null;
  }
  for (const key of numbers) {
    if (typeof body[key] !== "number" || !Number.isInteger(body[key])) {
      return null;
    }
  }
  const zoneId = body["zoneId"];
  if (zoneId !== null && typeof zoneId !== "string") {
    return null;
  }
  return {
    versionId: body["versionId"],
    zoneId,
    baseFeeCop: body["baseFeeCop"] as number,
    perKmCop: body["perKmCop"] as number,
    minimumFeeCop: body["minimumFeeCop"] as number,
    nightMultiplierBps: body["nightMultiplierBps"] as number,
    nightStartsMinute: body["nightStartsMinute"] as number,
    nightEndsMinute: body["nightEndsMinute"] as number,
  };
}

function readQuote(body: unknown): {
  origin: { longitude: number; latitude: number };
  destination: { longitude: number; latitude: number };
  at: Date;
} | null {
  if (!isRecord(body) || typeof body["at"] !== "string") {
    return null;
  }
  const origin = readPoint(body["origin"]);
  const destination = readPoint(body["destination"]);
  const at = new Date(body["at"]);
  if (origin === null || destination === null || Number.isNaN(at.getTime())) {
    return null;
  }
  return { origin, destination, at };
}

export function readPoint(value: unknown): { longitude: number; latitude: number } | null {
  if (
    !isRecord(value) ||
    typeof value["longitude"] !== "number" ||
    typeof value["latitude"] !== "number"
  ) {
    return null;
  }
  const longitude = value["longitude"];
  const latitude = value["latitude"];
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }
  return { longitude, latitude };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
