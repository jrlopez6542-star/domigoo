import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ReadinessService } from "./readiness.service.js";

@ApiTags("sistema")
@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get("health")
  @ApiOperation({ summary: "Viveza del proceso, sin consultar la base" })
  @ApiOkResponse({ schema: { example: { status: "ok" } } })
  health(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOperation({ summary: "Disponibilidad: la base PostGIS acepta una conexión" })
  @ApiOkResponse({ schema: { example: { status: "ok" } } })
  @ApiServiceUnavailableResponse({ schema: { example: { status: "unavailable" } } })
  async ready(): Promise<{ status: "ok" }> {
    const ready = await this.readiness.canConnect();
    if (!ready) {
      throw new ServiceUnavailableException({ status: "unavailable" });
    }
    return { status: "ok" };
  }
}
