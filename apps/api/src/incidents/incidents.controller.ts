import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { IncidentsRepository, type IncidentView } from "./incidents.repository.js";

@ApiTags("incidentes")
@Controller("v1/incidents")
@UseGuards(SessionGuard)
export class IncidentsController {
  constructor(private readonly incidents: IncidentsRepository) {}

  @Post()
  @ApiOperation({ summary: "Crea un incidente operativo y su evento inicial" })
  async create(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: "OPEN"; severity: string; type: string }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const parsed = readCreate(body);
    if (parsed === null) {
      throw new HttpException({ message: "Datos de incidente inválidos" }, 422);
    }
    const result = await this.incidents.createIncident({ userId, ...parsed });
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "forbidden") {
      throw new ForbiddenException();
    }
    if (result === "invalid") {
      throw new HttpException({ message: "Tipo o severidad de incidente inválidos" }, 422);
    }
    return result;
  }

  @Get(":id")
  @ApiOperation({ summary: "Consulta un incidente y su historial de eventos" })
  async getOne(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<IncidentView> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const inc = await this.incidents.getIncident(id, userId);
    if (inc === "missing") {
      throw new NotFoundException();
    }
    return inc;
  }

  @Post(":id/comments")
  @ApiOperation({ summary: "Agrega un comentario al historial del incidente" })
  async addComment(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; incidentId: string }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const comment = readNonEmpty(body, "comment", 1000);
    if (comment === null) {
      throw new HttpException({ message: "El comentario es obligatorio" }, 422);
    }
    const added = await this.incidents.addComment(id, userId, comment);
    if (added === "missing") {
      throw new NotFoundException();
    }
    return added;
  }

  @Post(":id/status")
  @ApiOperation({ summary: "Cambia el estado de un incidente como operaciones o superadmin" })
  async changeStatus(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: string }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const status = readNonEmpty(body, "status", 40);
    const reason = readNonEmpty(body, "reason", 200);
    if (status === null || reason === null) {
      throw new HttpException({ message: "Estado y motivo son obligatorios" }, 422);
    }
    const result = await this.incidents.changeStatus(id, userId, status, reason);
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "forbidden") {
      throw new ForbiddenException();
    }
    if (result === "invalid") {
      throw new HttpException({ message: "Estado de incidente inválido" }, 422);
    }
    return result;
  }
}

function readCreate(body: unknown): {
  orderId?: string;
  type: string;
  severity: string;
  summary: string;
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const rec = body as Record<string, unknown>;
  const type = rec["type"];
  const severity = rec["severity"];
  const summary = readNonEmpty(body, "summary", 500);
  if (typeof type !== "string" || typeof severity !== "string" || summary === null) {
    return null;
  }
  const orderId = typeof rec["orderId"] === "string" ? rec["orderId"] : undefined;
  return {
    ...(orderId !== undefined ? { orderId } : {}),
    type,
    severity,
    summary,
  };
}

function readNonEmpty(body: unknown, field: string, maxLen: number): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const val = (body as Record<string, unknown>)[field];
  if (typeof val !== "string") {
    return null;
  }
  const trimmed = val.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) {
    return null;
  }
  return trimmed;
}
