import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import { IdentityService } from "./identity.service.js";

export type RequestAuth = {
  userId: string;
  sessionId: string;
};

export type AuthenticatedRequest = Request & {
  auth?: RequestAuth;
};

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = await this.identity.authenticate(readHeaders(request));
    if (auth === null) {
      throw new UnauthorizedException();
    }
    request.auth = auth;
    return true;
  }
}

export function readHeaders(request: Request): { cookie?: string; authorization?: string } {
  const cookie = one(request.headers.cookie);
  const authorization = one(request.headers.authorization);
  return {
    ...(cookie === undefined ? {} : { cookie }),
    ...(authorization === undefined ? {} : { authorization }),
  };
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
