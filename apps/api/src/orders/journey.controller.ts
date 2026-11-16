import {
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
import { JourneyRepository, type CourierOrderView, type OrderStep } from "./journey.repository.js";
import type { OrderStatus } from "./order-machine.js";

@ApiTags("pedidos")
@Controller("v1/orders")
@UseGuards(SessionGuard)
export class JourneyController {
  constructor(private readonly journey: JourneyRepository) {}

  @Post(":id/arrive-pickup")
  @ApiOperation({ summary: "El domiciliario asignado va hacia la sucursal" })
  arrive(@Param("id") id: string, @Req() request: AuthenticatedRequest): Promise<CourierOrderView> {
    return this.move(id, request, "ACCEPTED", "ARRIVING_PICKUP");
  }

  @Post(":id/at-pickup")
  @ApiOperation({ summary: "El domiciliario asignado llegó a la sucursal" })
  atPickup(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CourierOrderView> {
    return this.move(id, request, "ARRIVING_PICKUP", "AT_PICKUP");
  }

  @Post(":id/at-dropoff")
  @ApiOperation({ summary: "El domiciliario asignado va hacia el destino" })
  atDropoff(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CourierOrderView> {
    return this.move(id, request, "PICKED_UP", "AT_DROPOFF");
  }

  @Get(":id/courier")
  @ApiOperation({ summary: "Vista del pedido para el domiciliario asignado" })
  async courier(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CourierOrderView> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const view = await this.journey.courierView(id, userId);
    if (view === "missing") {
      throw new NotFoundException();
    }
    if (view === "forbidden") {
      throw new ForbiddenException();
    }
    return view;
  }

  @Get(":id/events")
  @ApiOperation({ summary: "Historial del pedido para el restaurante o el asignado" })
  async events(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<OrderStep[]> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const steps = await this.journey.events(id, userId);
    if (steps === "missing") {
      throw new NotFoundException();
    }
    if (steps === "forbidden") {
      throw new ForbiddenException();
    }
    return steps;
  }

  private async move(
    id: string,
    request: AuthenticatedRequest,
    from: OrderStatus,
    to: OrderStatus,
  ): Promise<CourierOrderView> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const moved = await this.journey.step(id, userId, from, to);
    if (moved === "missing") {
      throw new NotFoundException();
    }
    if (moved === "forbidden") {
      throw new ForbiddenException();
    }
    if (moved === "invalid") {
      throw new HttpException({ message: "Ese paso no corresponde al estado del pedido" }, 422);
    }
    return moved;
  }
}
