import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../identity/admin.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { PrivacyRepository } from "./privacy.repository.js";

const KINDS = ["PRIVACY_NOTICE", "TERMS", "GEOLOCATION_CONSENT", "DOCUMENT_PROCESSING"] as const;
const PURPOSES = ["ACCOUNT", "GEOLOCATION", "DOCUMENT_STORAGE", "ORDER_CONTACT"] as const;
const CHANNELS = ["WEB", "MOBILE", "ADMIN"] as const;

@ApiTags("privacidad")
@Controller("v1")
export class PrivacyController {
  constructor(private readonly privacy: PrivacyRepository) {}

  @Post("legal-documents")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Publica una versión de un documento legal" })
  async publish(
    @Body() body: unknown,
  ): Promise<{ id: string; contentHash: string; version: string }> {
    const parsed = readDocument(body);
    if (parsed === null) {
      throw new NotFoundException();
    }
    const document = await this.privacy.insertDocument(parsed);
    return { id: document.id, contentHash: document.contentHash, version: document.version };
  }

  @Post("consents")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Registra un consentimiento sobre una versión concreta" })
  async grant(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; legalDocumentId: string }> {
    const parsed = readConsent(body);
    const userId = request.auth?.userId;
    if (parsed === null || userId === undefined) {
      throw new NotFoundException();
    }
    return this.privacy.insertConsent({ ...parsed, userId });
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

function readConsent(
  body: unknown,
): { legalDocumentId: string; purpose: string; channel: string } | null {
  if (!isRecord(body) || typeof body["legalDocumentId"] !== "string") {
    return null;
  }
  if (!isPurpose(body["purpose"]) || !isChannel(body["channel"])) {
    return null;
  }
  return {
    legalDocumentId: body["legalDocumentId"],
    purpose: body["purpose"],
    channel: body["channel"],
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
