import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module.js";
import { MaintenanceController } from "./maintenance.controller.js";
import { MaintenanceService } from "./maintenance.service.js";

@Module({
  imports: [OrdersModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
