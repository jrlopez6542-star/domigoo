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

@ApiTags("pedidos")
@Controller("v1/orders")
@UseGuards(SessionGuard)
export class OrdersController {
  constructor(private readonly orders: OrderRepository) {}

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

function money(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}
