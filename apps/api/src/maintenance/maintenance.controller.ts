import { Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CronSecretGuard } from "./cron-secret.guard.js";
import { MaintenanceService, type MaintenanceSummary } from "./maintenance.service.js";

@ApiTags("mantenimiento")
@ApiExcludeController()
@Controller("v1/internal/cron")
@UseGuards(CronSecretGuard)
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get("maintenance")
  @ApiOperation({
    summary:
      "Ejecuta expiraciones y purgas de retención (Vercel Cron diario, protegido por CRON_SECRET)",
  })
  async runGet(): Promise<{ ok: true; summary: MaintenanceSummary }> {
    const summary = await this.maintenance.runMaintenance();
    return { ok: true, summary };
  }

  @Post("maintenance")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ejecuta expiraciones y purgas de retención bajo demanda (protegido por CRON_SECRET)",
  })
  async runPost(): Promise<{ ok: true; summary: MaintenanceSummary }> {
    const summary = await this.maintenance.runMaintenance();
    return { ok: true, summary };
  }
}
