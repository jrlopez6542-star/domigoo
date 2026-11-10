import { Controller, NotFoundException, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { VerificationRepository } from "./verification.repository.js";

@ApiTags("verificacion")
@Controller("v1/couriers/me")
@UseGuards(SessionGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationRepository) {}

  @Post("verification-cases")
  @ApiOperation({ summary: "Ejecuta las reglas automáticas sin aprobar" })
  async submit(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; status: "NEEDS_CHANGES" | "PENDING_HUMAN" }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const result = await this.verification.submit(userId, new Date());
    if (result === null) {
      throw new NotFoundException();
    }
    return { id: result.id, status: result.status };
  }
}
