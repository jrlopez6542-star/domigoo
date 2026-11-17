import { timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class CronSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env["CRON_SECRET"]?.trim();
    if (!expected) {
      throw new ServiceUnavailableException("CRON_SECRET no está configurado");
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = oneHeader(request.headers.authorization);
    const cronHeader = oneHeader(request.headers["x-cron-secret"]);

    const provided = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : cronHeader?.trim();

    if (!provided || !safeEquals(provided, expected)) {
      throw new UnauthorizedException("Token de cron inválido");
    }
    return true;
  }
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
