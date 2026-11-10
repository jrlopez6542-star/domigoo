import { Controller, Get, NotFoundException, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard, type AdminRequest } from "./admin.guard.js";

@ApiTags("admin")
@Controller("v1/admin")
export class AdminController {
  @Get("me")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Confirma el papel de administración de la sesión" })
  me(@Req() request: AdminRequest): { role: string } {
    if (request.adminRole === undefined || request.auth === undefined) {
      throw new NotFoundException();
    }
    return { role: request.adminRole };
  }
}
