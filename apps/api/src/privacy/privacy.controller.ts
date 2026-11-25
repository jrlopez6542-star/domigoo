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
import { denyReviewer } from "../identity/admin-roles.js";
import { AdminGuard, type AdminRequest } from "../identity/admin.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { PrivacyRepository } from "./privacy.repository.js";

const KINDS = ["PRIVACY_NOTICE", "TERMS", "GEOLOCATION_CONSENT", "DOCUMENT_PROCESSING"] as const;
const PURPOSES = [
  "ACCOUNT",
  "TERMS_ACCEPTANCE",
  "GEOLOCATION",
  "DOCUMENT_STORAGE",
  "ORDER_CONTACT",
  "MARKETING",
] as const;
const CHANNELS = ["WEB", "MOBILE", "ADMIN"] as const;
const DSR_TYPES = new Set(["ACCESS", "CORRECTION", "DELETION", "REVOCATION", "COMPLAINT"]);

@ApiTags("privacidad")
@Controller("v1")
export class PrivacyController {
  constructor(private readonly privacy: PrivacyRepository) {}

  @Get("legal-documents/current")
  @ApiOperation({ summary: "Devuelve las versiones vigentes de los documentos legales" })
  async currentDocuments(): Promise<{
    documents: Array<{ id: string; kind: string; version: string; contentHash: string }>;
  }> {
    return { documents: await this.privacy.listCurrentDocuments() };
  }

  @Post("legal-documents")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Publica una versión de un documento legal" })
  async publish(
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ): Promise<{ id: string; contentHash: string; version: string }> {
    denyReviewer(request.adminRole);
    const parsed = readDocument(body);
    if (parsed === null) {
      throw new NotFoundException();
    }
    const document = await this.privacy.insertDocument(parsed);
    if (document === "conflict") {
      throw new HttpException(
        { message: "Ya existe un documento legal con ese tipo y versión" },
        409,
      );
    }
    return { id: document.id, contentHash: document.contentHash, version: document.version };
  }

  @Post("consents")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Registra un consentimiento sobre una versión concreta" })
  async grant(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; legalDocumentId: string }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const parsed = readConsent(body);
    if (!parsed.ok) {
      if (parsed.reason === "invalid-document-id") {
        throw new HttpException(
          { message: "El identificador del documento legal es inválido" },
          422,
        );
      }
      throw new NotFoundException();
    }
    const ip = typeof request.ip === "string" ? request.ip.slice(0, 45) : undefined;
    const rawUa = request.headers["user-agent"];
    const userAgent = typeof rawUa === "string" ? rawUa.slice(0, 255) : undefined;
    const saved = await this.privacy.insertConsent({
      ...parsed.value,
      userId,
      ...(ip === undefined ? {} : { ip }),
      ...(userAgent === undefined ? {} : { userAgent }),
    });
    if (saved === "invalid") {
      throw new HttpException({ message: "El identificador del documento legal es inválido" }, 422);
    }
    if (saved === "missing") {
      throw new NotFoundException();
    }
    return saved;
  }

  @Post("consents/:id/revoke")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Revoca un consentimiento sin borrar el registro" })
  async revoke(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ revoked: true }> {
    const userId = request.auth?.userId;
    if (userId === undefined || !(await this.privacy.revoke(id, userId))) {
      throw new NotFoundException();
    }
    return { revoked: true };
  }

  @Get("consents/current")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Dice si hay un consentimiento vigente para el propósito" })
  async current(
    @Query("purpose") purpose: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ active: boolean }> {
    const userId = request.auth?.userId;
    if (userId === undefined || !isPurpose(purpose)) {
      throw new NotFoundException();
    }
    return { active: await this.privacy.isCurrent(userId, purpose) };
  }

  @Post("data-subject-requests")
  @UseGuards(SessionGuard)
  @ApiOperation({
    summary: "Crea una solicitud de habeas data (acceso, corrección, supresión o revocatoria)",
  })
  async createDsr(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; type: string; status: "OPEN" }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const parsed = readDsr(body);
    if (parsed === null) {
      throw new HttpException({ message: "Tipo de solicitud de habeas data inválido" }, 422);
    }
    return this.privacy.createDataSubjectRequest({ userId, ...parsed });
  }

  @Post("data-subject-requests/:id/process")
  @UseGuards(SessionGuard)
  @ApiOperation({
    summary:
      "Procesa una solicitud de habeas data (revoca geolocalización o anonimiza pedidos cerrados)",
  })
  async processDsr(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: string; anonymizedOrders: number }> {
    const actorUserId = request.auth?.userId;
    if (actorUserId === undefined) {
      throw new NotFoundException();
    }
    const action = readDsrAction(body);
    if (action === null) {
      throw new HttpException({ message: "Acción inválida (COMPLETE o DENY)" }, 422);
    }
    const result = await this.privacy.processDataSubjectRequest({ id, actorUserId, action });
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "forbidden") {
      throw new ForbiddenException();
    }
    return result;
  }
}

function readDocument(body: unknown): { kind: string; version: string; content: string } | null {
  if (
    !isRecord(body) ||
    typeof body["content"] !== "string" ||
    typeof body["version"] !== "string"
  ) {
    return null;
  }
  if (!isKind(body["kind"]) || body["version"].trim() === "" || body["content"].trim() === "") {
    return null;
  }
  return { kind: body["kind"], version: body["version"].trim(), content: body["content"] };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readConsent(
  body: unknown,
):
  | { ok: true; value: { legalDocumentId: string; purpose: string; channel: string } }
  | { ok: false; reason: "invalid-document-id" | "invalid-payload" } {
  if (!isRecord(body)) {
    return { ok: false, reason: "invalid-payload" };
  }
  const legalDocumentId = body["legalDocumentId"];
  if (typeof legalDocumentId !== "string" || !UUID_PATTERN.test(legalDocumentId)) {
    return { ok: false, reason: "invalid-document-id" };
  }
  if (!isPurpose(body["purpose"]) || !isChannel(body["channel"])) {
    return { ok: false, reason: "invalid-payload" };
  }
  return {
    ok: true,
    value: {
      legalDocumentId,
      purpose: body["purpose"],
      channel: body["channel"],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKind(value: unknown): value is (typeof KINDS)[number] {
  return KINDS.some((item) => item === value);
}

function isPurpose(value: unknown): value is (typeof PURPOSES)[number] {
  return PURPOSES.some((item) => item === value);
}

function isChannel(value: unknown): value is (typeof CHANNELS)[number] {
  return CHANNELS.some((item) => item === value);
}

function readDsr(body: unknown): { type: string; note?: string } | null {
  if (!isRecord(body) || typeof body["type"] !== "string" || !DSR_TYPES.has(body["type"])) {
    return null;
  }
  const note = typeof body["note"] === "string" ? body["note"].trim() : undefined;
  return {
    type: body["type"],
    ...(note !== undefined && note !== "" ? { note } : {}),
  };
}

function readDsrAction(body: unknown): "COMPLETE" | "DENY" | null {
  if (!isRecord(body)) {
    return null;
  }
  const action = body["action"];
  if (action === "COMPLETE" || action === "DENY") {
    return action;
  }
  return null;
}
