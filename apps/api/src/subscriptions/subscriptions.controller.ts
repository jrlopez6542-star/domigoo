import {
  Body,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuditRecorder } from "../audit/audit.service.js";
import { AdminGuard, type AdminRequest } from "../identity/admin.guard.js";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { SubscriptionRepository, type PlanInput } from "./subscription.repository.js";

@ApiTags("suscripcion")
@Controller("v1/admin")
@UseGuards(AdminGuard)
export class SubscriptionAdminController {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly audit: AuditRecorder,
  ) {}

  @Post("plans")
  @ApiOperation({ summary: "Crea un plan de suscripción" })
  async createPlan(@Body() body: unknown): Promise<{ id: string }> {
    const plan = readPlan(body);
    if (plan === null) {
      throw new NotFoundException();
    }
    const id = await this.subscriptions.createPlan(plan);
    if (id === null) {
      throw new NotFoundException();
    }
    return { id };
  }

  @Post("subscriptions")
  @ApiOperation({ summary: "Abre una suscripción de prueba o activa y copia el precio" })
  async open(
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ): Promise<{ id: string; priceCop: number; status: string }> {
    const actorId = request.auth?.userId;
    const parsed = readOpen(body);
    if (actorId === undefined || parsed === null) {
      throw new NotFoundException();
    }
    const opened = await this.subscriptions.open({ ...parsed, actorId });
    if (opened === null) {
      throw new NotFoundException();
    }
    await this.audit.record({
      actorId,
      actorKind: "ADMIN",
      action: "subscription.opened",
      entityType: "restaurant_subscription",
      entityId: opened.id,
    });
    return opened;
  }

  @Post("declarations/:id/acknowledge")
  @ApiOperation({ summary: "Reconoce una declaración y renueva el periodo" })
  async acknowledge(
    @Param("id") id: string,
    @Req() request: AdminRequest,
  ): Promise<{ acknowledged: true }> {
    const actorId = request.auth?.userId;
    if (actorId === undefined) {
      throw new NotFoundException();
    }
    const ok = await this.subscriptions.acknowledge(id, actorId);
    if (!ok) {
      throw new NotFoundException();
    }
    await this.audit.record({
      actorId,
      actorKind: "ADMIN",
      action: "subscription.payment_acknowledged",
      entityType: "subscription_payment_declaration",
      entityId: id,
    });
    return { acknowledged: true };
  }

  @Post("subscriptions/advance")
  @ApiOperation({ summary: "Avanza las suscripciones con periodo vencido" })
  async advance(): Promise<{ changed: number }> {
    return { changed: await this.subscriptions.advance(new Date()) };
  }
}

@ApiTags("suscripcion")
@Controller("v1/restaurants")
@UseGuards(SessionGuard)
export class SubscriptionRestaurantController {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  @Post(":id/subscription/declarations")
  @ApiOperation({ summary: "Declara un pago manual de la suscripción" })
  async declare(
    @Param("id") restaurantId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string }> {
    const userId = request.auth?.userId;
    const parsed = readDeclaration(body);
    if (userId === undefined || parsed === null) {
      throw new NotFoundException();
    }
    const id = await this.subscriptions.declare({ restaurantId, userId, ...parsed });
    if (id === null) {
      throw new NotFoundException();
    }
    return { id };
  }

  @Get(":id/dispatch-gate")
  @ApiOperation({ summary: "Comprueba si la suscripción permite despachar" })
  async gate(
    @Param("id") restaurantId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ allowed: true }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const verdict = await this.subscriptions.memberCanDispatch(restaurantId, userId, new Date());
    if (verdict === "hidden") {
      throw new NotFoundException();
    }
    if (verdict === "blocked") {
      throw new HttpException({ message: "La suscripción no permite despachar" }, 422);
    }
    return { allowed: true };
  }
}

function readPlan(body: unknown): PlanInput | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record["code"] !== "string" || record["code"].trim() === "") {
    return null;
  }
  if (typeof record["name"] !== "string" || record["name"].trim() === "") {
    return null;
  }
  const priceCop = integerAtLeast(record["priceCop"], 0);
  const periodDays = integerAtLeast(record["periodDays"], 1);
  const trialDays = integerAtLeast(record["trialDays"], 0);
  const maxBranches = integerAtLeast(record["maxBranches"], 1);
  const maxConcurrentOrders = integerAtLeast(record["maxConcurrentOrders"], 1);
  if (
    priceCop === null ||
    periodDays === null ||
    trialDays === null ||
    maxBranches === null ||
    maxConcurrentOrders === null
  ) {
    return null;
  }
  return {
    code: record["code"].trim(),
    name: record["name"].trim(),
    priceCop,
    periodDays,
    trialDays,
    maxBranches,
    maxConcurrentOrders,
  };
}

function readOpen(body: unknown): {
  restaurantId: string;
  planId: string;
  status: "TRIAL" | "ACTIVE";
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record["restaurantId"] !== "string" || typeof record["planId"] !== "string") {
    return null;
  }
  if (record["status"] !== "TRIAL" && record["status"] !== "ACTIVE") {
    return null;
  }
  return {
    restaurantId: record["restaurantId"],
    planId: record["planId"],
    status: record["status"],
  };
}

function readDeclaration(body: unknown): {
  amountCop: number;
  method: string;
  reference: string | null;
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const amountCop = integerAtLeast(record["amountCop"], 1);
  if (amountCop === null || typeof record["method"] !== "string") {
    return null;
  }
  const reference = record["reference"];
  if (reference !== undefined && reference !== null && typeof reference !== "string") {
    return null;
  }
  return {
    amountCop,
    method: record["method"],
    reference: typeof reference === "string" ? reference : null,
  };
}

function integerAtLeast(value: unknown, minimum: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    return null;
  }
  return value;
}
