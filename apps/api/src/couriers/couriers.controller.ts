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
    const draft = readDraft(body);
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

function readDraft(body: unknown): {
  documentType: "CC" | "CE";
  documentNumber: string;
  firstName: string;
  lastName: string;
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record["documentType"] !== "CC" && record["documentType"] !== "CE") {
    return null;
  }
  const documentNumber = normalizeDocument(record["documentNumber"]);
  const firstName = personName(record["firstName"]);
  const lastName = personName(record["lastName"]);
  if (documentNumber === null || firstName === null || lastName === null) {
    return null;
  }
  return { documentType: record["documentType"], documentNumber, firstName, lastName };
}

function normalizeDocument(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replaceAll(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function personName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const name = value.trim().replaceAll(/\s+/g, " ");
  if (name.length < 1 || name.length > 80) {
    return null;
  }
  return name;
}
