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
import { validateTocancipaCoverage } from "../geo/tocancipa-coverage.js";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import {
  JourneyRepository,
  type JourneyStatus,
  type JourneyTransitionResult,
} from "./journey.repository.js";
import {
  OrderRepository,
  type CourierOrderView,
  type DraftOrder,
  type OrderEventItem,
  type RestaurantOrderView,
} from "./order.repository.js";
import { PublishRepository, type OpenWave, type PublishedOrder } from "./publish.repository.js";

@ApiTags("pedidos")
@Controller("v1/orders")
@UseGuards(SessionGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrderRepository,
    private readonly publisher: PublishRepository,
    private readonly journey: JourneyRepository,
  ) {}

  @Post()
  @ApiOperation({ summary: "Crea un borrador con comida y domicilio separados" })
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<DraftOrder> {
    const userId = request.auth?.userId;
    const parsed = readDraft(body);
    if (userId === undefined || parsed === null) {
      throw new NotFoundException();
    }
    const created = await this.orders.createDraft({ userId, ...parsed });
    if (created === "missing") {
      throw new NotFoundException();
    }
    if (created === "invalid") {
      throw new HttpException({ message: "El borrador necesita montos y medio de pago" }, 422);
    }
    return created;
  }

  @Post(":id/publish")
  @ApiOperation({ summary: "Publica en directo a un domiciliario elegible del radio" })
  async publish(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<PublishedOrder | OpenWave> {
    const userId = request.auth?.userId;
    const parsed = readPublish(body);
    if (userId === undefined || parsed === null) {
      throw new NotFoundException();
    }
    const coverage = validateTocancipaCoverage({
      longitude: parsed.longitude,
      latitude: parsed.latitude,
    });
    if (!coverage.ok) {
      throw new HttpException({ code: coverage.code, message: coverage.message }, 422);
    }
    const published =
      parsed.mode === "OPEN"
        ? await this.publisher.publishOpen({
            orderId: id,
            userId,
            customerName: parsed.customerName,
            customerPhone: parsed.customerPhone,
            dropoffAddress: parsed.dropoffAddress,
            longitude: parsed.longitude,
            latitude: parsed.latitude,
            at: new Date(),
          })
        : await this.publisher.publishDirect({
            orderId: id,
            userId,
            courierId: parsed.courierId,
            customerName: parsed.customerName,
            customerPhone: parsed.customerPhone,
            dropoffAddress: parsed.dropoffAddress,
            longitude: parsed.longitude,
            latitude: parsed.latitude,
            at: new Date(),
          });
    if (published === "missing") {
      throw new NotFoundException();
    }
    if (published === "blocked") {
      throw new HttpException({ message: "La suscripción no permite publicar" }, 422);
    }
    if (published === "quote") {
      throw new HttpException({ message: "La cotización no coincide con el domicilio" }, 422);
    }
    if (published === "ineligible") {
      throw new HttpException({ message: "El domiciliario no está disponible en el radio" }, 422);
    }
    if (published === "unpriced") {
      throw new HttpException({ message: "No hay tarifa o política publicada" }, 422);
    }
    return published;
  }

  @Get(":id")
  @ApiOperation({
    summary: "Lee el pedido con proyección diferenciada para restaurante o domiciliario",
  })
  async getOne(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RestaurantOrderView | CourierOrderView> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const view = await this.orders.findOrderView(id, userId);
    if (view.kind === "missing") {
      throw new NotFoundException();
    }
    if (view.kind === "forbidden") {
      throw new ForbiddenException();
    }
    return view.order;
  }

  @Get(":id/events")
  @ApiOperation({
    summary: "Historial de eventos del pedido para restaurante o domiciliario asignado",
  })
  async getEvents(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ events: OrderEventItem[] }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const view = await this.orders.findOrderView(id, userId);
    if (view.kind === "missing") {
      throw new NotFoundException();
    }
    if (view.kind === "forbidden") {
      throw new ForbiddenException();
    }
    return { events: view.order.events };
  }

  @Post(":id/arrive-pickup")
  @ApiOperation({ summary: "El domiciliario asignado informa que va camino a la sucursal" })
  async arrivePickup(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<JourneyTransitionResult> {
    return this.runJourneyStep(id, request, "ARRIVING_PICKUP");
  }

  @Post(":id/at-pickup")
  @ApiOperation({ summary: "El domiciliario asignado informa que llegó a la sucursal" })
  async atPickup(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<JourneyTransitionResult> {
    return this.runJourneyStep(id, request, "AT_PICKUP");
  }

  @Post(":id/at-dropoff")
  @ApiOperation({ summary: "El domiciliario asignado informa que llegó al destino" })
  async atDropoff(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<JourneyTransitionResult> {
    return this.runJourneyStep(id, request, "AT_DROPOFF");
  }

  @Post(":id/pickup-pin")
  @ApiOperation({ summary: "El domiciliario verifica el PIN de recogida para pasar a PICKED_UP" })
  async verifyPickupPin(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<JourneyTransitionResult> {
    return this.runPinVerification(id, body, request, "PICKUP");
  }

  @Post(":id/delivery-pin")
  @ApiOperation({ summary: "El domiciliario verifica el PIN de entrega para pasar a DELIVERED" })
  async verifyDeliveryPin(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<JourneyTransitionResult> {
    return this.runPinVerification(id, body, request, "DELIVERY");
  }

  @Post(":id/cancel")
  @ApiOperation({
    summary: "Cancela un pedido según las reglas de la máquina de estados y libera al domiciliario",
  })
  async cancel(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<JourneyTransitionResult> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const reason = readCancelReason(body);
    if (reason === null) {
      throw new HttpException({ message: "El motivo de cancelación es obligatorio" }, 422);
    }
    const result = await this.journey.cancelOrder({ orderId: id, userId, reason });
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "forbidden") {
      throw new ForbiddenException();
    }
    if (result === "invalid_transition") {
      throw new HttpException({ message: "No se puede cancelar el pedido en este estado" }, 422);
    }
    return result;
  }

  @Post(":id/fail")
  @ApiOperation({
    summary: "Pasa un pedido a FAILED si existe un incidente CRITICAL ligado al pedido",
  })
  async fail(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<JourneyTransitionResult> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const reason = readCancelReason(body);
    if (reason === null) {
      throw new HttpException({ message: "El motivo es obligatorio" }, 422);
    }
    const result = await this.journey.failOrder({ orderId: id, userId, reason });
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "forbidden") {
      throw new ForbiddenException();
    }
    if (result === "needs_critical") {
      throw new HttpException(
        { message: "Se requiere un incidente CRITICAL ligado al pedido" },
        422,
      );
    }
    if (result === "invalid_transition") {
      throw new HttpException({ message: "No se puede marcar como fallido en este estado" }, 422);
    }
    return result;
  }

  private async runJourneyStep(
    orderId: string,
    request: AuthenticatedRequest,
    targetStatus: JourneyStatus,
  ): Promise<JourneyTransitionResult> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const result = await this.journey.transitionByCourier({
      orderId,
      userId,
      targetStatus,
    });
    if (result === "missing") {
      throw new NotFoundException();
    }
    if (result === "forbidden") {
      throw new ForbiddenException();
    }
    if (result === "invalid_transition") {
      throw new HttpException({ message: "Transición de estado no permitida" }, 422);
    }
    return result;
  }

  private async runPinVerification(
    orderId: string,
    body: unknown,
    request: AuthenticatedRequest,
    kind: "PICKUP" | "DELIVERY",
  ): Promise<JourneyTransitionResult> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const pin = readPin(body);
    if (pin === null) {
      throw new HttpException({ message: "El PIN debe ser numérico" }, 422);
    }
    const result = await this.journey.verifyPinByCourier({
      orderId,
      userId,
      kind,
      pin,
    });
    if (result.kind === "missing") {
      throw new NotFoundException();
    }
    if (result.kind === "forbidden") {
      throw new ForbiddenException();
    }
    if (result.kind === "invalid_transition") {
      throw new HttpException({ message: "Transición de estado no permitida" }, 422);
    }
    if (result.kind === "locked") {
      throw new HttpException(
        {
          message: "PIN bloqueado por límite de intentos",
          attempts: result.attempts,
          maxAttempts: result.maxAttempts,
          lockedOut: true,
        },
        422,
      );
    }
    if (result.kind === "invalid_pin") {
      throw new HttpException(
        {
          message: "PIN incorrecto",
          attempts: result.attempts,
          maxAttempts: result.maxAttempts,
          lockedOut: result.lockedOut,
        },
        422,
      );
    }
    return {
      id: result.id,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      status: result.status,
    };
  }
}

function readPin(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const pin = (body as Record<string, unknown>)["pin"];
  if (typeof pin !== "string" || !/^\d{4,12}$/.test(pin)) {
    return null;
  }
  return pin;
}

function readCancelReason(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const raw = (body as Record<string, unknown>)["reason"];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return null;
  }
  return trimmed;
}

function readDraft(body: unknown): {
  branchId: string;
  foodAmountCop: number;
  deliveryFeeCop: number;
  paymentMethod: string;
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record["branchId"] !== "string" || typeof record["paymentMethod"] !== "string") {
    return null;
  }
  const foodAmountCop = money(record["foodAmountCop"]);
  const deliveryFeeCop = money(record["deliveryFeeCop"]);
  if (foodAmountCop === null || deliveryFeeCop === null) {
    return null;
  }
  return {
    branchId: record["branchId"],
    foodAmountCop,
    deliveryFeeCop,
    paymentMethod: record["paymentMethod"],
  };
}

function readPublish(body: unknown): {
  mode: "DIRECT" | "OPEN";
  courierId: string;
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  longitude: number;
  latitude: number;
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const mode = record["mode"] === "OPEN" ? "OPEN" : "DIRECT";
  if (
    (mode === "DIRECT" && typeof record["courierId"] !== "string") ||
    typeof record["customerName"] !== "string" ||
    record["customerName"].trim() === "" ||
    typeof record["customerPhone"] !== "string" ||
    !/^\+57\d{10}$/.test(record["customerPhone"]) ||
    typeof record["dropoffAddress"] !== "string" ||
    record["dropoffAddress"].trim() === ""
  ) {
    return null;
  }
  const longitude = record["longitude"];
  const latitude = record["latitude"];
  if (
    typeof longitude !== "number" ||
    typeof latitude !== "number" ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }
  return {
    mode,
    courierId:
      mode === "DIRECT" && typeof record["courierId"] === "string" ? record["courierId"] : "",
    customerName: record["customerName"].trim(),
    customerPhone: record["customerPhone"],
    dropoffAddress: record["dropoffAddress"].trim(),
    longitude,
    latitude,
  };
}

function money(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}
