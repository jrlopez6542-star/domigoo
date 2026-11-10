import { Body, Controller, NotFoundException, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditRecorder } from "../audit/audit.service.js";
import { AdminGuard, type AdminRequest } from "../identity/admin.guard.js";
import { PolicyRepository, type PolicyDraft } from "./policy.repository.js";

@ApiTags("politica")
@Controller("v1/admin/policies")
@UseGuards(AdminGuard)
export class PoliciesController {
  constructor(
    private readonly policies: PolicyRepository,
    private readonly audit: AuditRecorder,
  ) {}

  @Post()
  @ApiOperation({ summary: "Crea una política operativa en borrador" })
  async create(@Body() body: unknown, @Req() request: AdminRequest): Promise<{ id: string }> {
    if (!canPublish(request.adminRole)) {
      throw new NotFoundException();
    }
    const draft = readDraft(body);
    if (draft === null) {
      throw new NotFoundException();
    }
    return { id: await this.policies.create(draft) };
  }

  @Post("publish")
  @ApiOperation({ summary: "Publica la política y retira la anterior" })
  async publish(@Body() body: unknown, @Req() request: AdminRequest): Promise<{ published: true }> {
    if (!canPublish(request.adminRole) || request.auth === undefined) {
      throw new NotFoundException();
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("id" in body) ||
      typeof body.id !== "string"
    ) {
      throw new NotFoundException();
    }
    const published = await this.policies.publish(body.id);
    if (!published) {
      throw new NotFoundException();
    }
    await this.audit.record({
      actorId: request.auth.userId,
      actorKind: "ADMIN",
      action: "operations_policy.published",
      entityType: "operations_policy",
      entityId: body.id,
    });
    return { published: true };
  }
}

function canPublish(role: string | undefined): boolean {
  return role === "OPERATIONS" || role === "SUPERADMIN";
}

function readDraft(body: unknown): PolicyDraft | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const keys = [
    "offerRadiusMeters",
    "directOfferTtlSeconds",
    "openOfferTtlSeconds",
    "seekingTtlSeconds",
    "maxOffersPerWave",
    "locationFreshnessSeconds",
  ] as const;
  if (typeof record["name"] !== "string" || record["name"].trim() === "") {
    return null;
  }
  const numbers: Record<(typeof keys)[number], number> = {
    offerRadiusMeters: 0,
    directOfferTtlSeconds: 0,
    openOfferTtlSeconds: 0,
    seekingTtlSeconds: 0,
    maxOffersPerWave: 0,
    locationFreshnessSeconds: 0,
  };
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return null;
    }
    numbers[key] = value;
  }
  return { name: record["name"].trim(), ...numbers };
}
