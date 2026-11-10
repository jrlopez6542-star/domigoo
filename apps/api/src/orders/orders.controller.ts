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
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { OrderRepository, type DraftOrder } from "./order.repository.js";
import { PublishRepository, type PublishedOrder } from "./publish.repository.js";

@ApiTags("pedidos")
@Controller("v1/orders")
@UseGuards(SessionGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrderRepository,
    private readonly publisher: PublishRepository,
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
  ): Promise<PublishedOrder> {
    const userId = request.auth?.userId;
    const parsed = readPublish(body);
    if (userId === undefined || parsed === null) {
      throw new NotFoundException();
    }
    const published = await this.publisher.publishDirect({
      orderId: id,
      userId,
      ...parsed,
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
  @ApiOperation({ summary: "Lee el borrador, incluida la comida, para el restaurante" })
  async getOne(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<DraftOrder> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const order = await this.orders.findForMember(id, userId);
    if (order === null) {
      throw new NotFoundException();
    }
    return order;
  }
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
  if (
    typeof record["courierId"] !== "string" ||
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
    courierId: record["courierId"],
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
