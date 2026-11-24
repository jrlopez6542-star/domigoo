import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import {
  TrackingRepository,
  type PublicTrackingView,
  type TrackingLinkIssued,
} from "./tracking.repository.js";

@ApiTags("tracking")
@Controller("v1")
export class TrackingController {
  constructor(private readonly tracking: TrackingRepository) {}

  @Post("orders/:id/tracking-link")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Emite o recupera el enlace público de tracking del pedido" })
  async issueLink(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<TrackingLinkIssued> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const issued = await this.tracking.issueOrGetLink(id, userId);
    if (issued === "missing") {
      throw new NotFoundException();
    }
    return issued;
  }

  @Post("orders/:id/tracking-link/revoke")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "Revoca los enlaces públicos de tracking activos del pedido" })
  async revokeLink(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ revoked: true }> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const result = await this.tracking.revokeLinks(id, userId);
    if (result === "missing") {
      throw new NotFoundException();
    }
    return { revoked: true };
  }

  @Get("tracking/:token")
  @ApiOperation({ summary: "Consulta pública de seguimiento sin sesión" })
  async getPublic(
    @Param("token") token: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicTrackingView> {
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store, private");

    const userAgent = request.headers["user-agent"];
    const view = await this.tracking.resolvePublic(token, {
      ...(request.ip !== undefined ? { ip: request.ip } : {}),
      ...(typeof userAgent === "string" ? { userAgent } : {}),
    });
    if (view === "missing") {
      throw new NotFoundException();
    }
    return view;
  }
}
