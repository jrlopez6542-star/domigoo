import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Database } from "../database.js";
import { IdentityService } from "./identity.service.js";
import { readHeaders, type AuthenticatedRequest } from "./session.guard.js";

export type AdminRequest = AuthenticatedRequest & {
  adminRole?: string;
};

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly database: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const auth = await this.identity.authenticate(readHeaders(request));
    if (auth === null) {
      throw new UnauthorizedException();
    }
    request.auth = auth;
    const result = await this.database.pool.query<{ role: string }>(
      `SELECT role::text AS role FROM admin_profiles WHERE "userId" = $1`,
      [auth.userId],
    );
    const role = result.rows[0]?.role;
    if (role === undefined) {
      throw new NotFoundException();
    }
    request.adminRole = role;
    return true;
  }
}
