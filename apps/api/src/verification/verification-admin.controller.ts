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
import { VerificationRepository } from "./verification.repository.js";

const OUTCOMES = ["APPROVED", "REJECTED", "NEEDS_CHANGES"] as const;

type DecisionOutcome = (typeof OUTCOMES)[number];

@ApiTags("verificacion")
@Controller("v1/admin/verification-cases")
@UseGuards(SessionGuard)
export class VerificationAdminController {
  constructor(private readonly verification: VerificationRepository) {}

  @Get()
  @ApiOperation({ summary: "Lista los casos que esperan a una persona" })
  async list(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; courierId: string; status: "PENDING_HUMAN" }[]> {
    await this.assertReviewer(request.auth?.userId);
    return this.verification.listPending();
  }

  @Post(":id/decision")
  @ApiOperation({ summary: "Escribe la decisión humana y audita al revisor" })
  async decide(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ decided: true }> {
    const reviewerId = await this.assertReviewer(request.auth?.userId);
    const parsed = readDecision(body);
    if (parsed === null) {
      throw new HttpException({ message: "Falta el motivo de la decisión" }, 422);
    }
    const saved = await this.verification.decide({ caseId: id, reviewerId, ...parsed });
    if (!saved) {
      throw new NotFoundException();
    }
    return { decided: true };
  }

  private async assertReviewer(userId: string | undefined): Promise<string> {
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const role = await this.verification.platformRole(userId);
    if (role !== "REVIEWER" && role !== "SUPERADMIN") {
      throw new ForbiddenException();
    }
    return userId;
  }
}

function readDecision(body: unknown): {
  outcome: DecisionOutcome;
  reasonCode: string;
  comment: string;
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (!isOutcome(record["outcome"])) {
    return null;
  }
  if (typeof record["reasonCode"] !== "string" || typeof record["comment"] !== "string") {
    return null;
  }
  const reasonCode = record["reasonCode"].trim();
  const comment = record["comment"].trim();
  if (!/^[A-Z0-9_]{1,64}$/.test(reasonCode) || comment.length === 0 || comment.length > 2000) {
    return null;
  }
  return { outcome: record["outcome"], reasonCode, comment };
}

function isOutcome(value: unknown): value is DecisionOutcome {
  return OUTCOMES.some((item) => item === value);
}
