import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { APP_ENV, type AppEnv } from "../config/env.js";
import { extractClientIp } from "../rate-limit/rate-limit.guard.js";
import {
  AuthError,
  IdentityService,
  LoginLimitedError,
  parseCredentials,
  parseRegistrationInput,
  type Credentials,
  type RegistrationInput,
} from "./identity.service.js";
import { clearSessionCookie, sessionCookieHeader } from "./session-cookie.js";

@ApiTags("auth")
@Controller("v1/auth")
export class AuthController {
  constructor(
    private readonly identity: IdentityService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  @Post("register")
  @ApiOperation({ summary: "Crea una cuenta con correo o teléfono y abre sesión" })
  async register(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const registration = this.registration(body);
    const extractedIp = extractClientIp(request);
    const ip = extractedIp !== "unknown" ? extractedIp.slice(0, 45) : undefined;
    const rawUa = request.headers["user-agent"];
    const userAgent = typeof rawUa === "string" ? rawUa.slice(0, 255) : undefined;
    const result = await this.run(() =>
      this.identity.register(registration, {
        ...(ip === undefined ? {} : { ip }),
        ...(userAgent === undefined ? {} : { userAgent }),
      }),
    );
    this.presentSession(response, registration, result.token);
    return {
      ...this.publicBody(result.user, registration.client, result.token),
      legalVersion: result.legalVersion,
      consentPurposes: result.consentPurposes,
    };
  }

  @Post("login")
  @HttpCode(200)
  @ApiOperation({
    summary: "Inicia sesión. Una contraseña incorrecta no revela si la cuenta existe",
  })
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, string | null>> {
    const credentials = this.credentials(body);
    const ip = extractClientIp(request);
    const result = await this.run(() => this.identity.login(credentials, ip), response);
    this.presentSession(response, credentials, result.token);
    return this.publicBody(result.user, credentials.client, result.token);
  }

  @Post("logout")
  @HttpCode(204)
  @ApiOperation({ summary: "Revoca la sesión actual" })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.run(() => this.identity.logout(headerValues(request)));
    response.setHeader("Set-Cookie", clearSessionCookie(this.env.cookieSecure));
  }

  @Get("me")
  @ApiOperation({ summary: "Devuelve la cuenta de la sesión, sin secreto" })
  @ApiOkResponse({
    schema: { example: { id: "uuid", email: null, phoneE164: null, status: "ACTIVE" } },
  })
  async me(@Req() request: Request): Promise<Record<string, string | null>> {
    const user = await this.run(() => this.identity.me(headerValues(request)));
    return {
      id: user.id,
      email: user.email,
      phoneE164: user.phoneE164,
      status: user.status,
    };
  }

  private credentials(body: unknown): Credentials {
    try {
      return parseCredentials(body);
    } catch (error) {
      if (error instanceof AuthError) {
        throw httpError(error);
      }
      throw error;
    }
  }

  private registration(body: unknown): RegistrationInput {
    try {
      return parseRegistrationInput(body);
    } catch (error) {
      if (error instanceof AuthError) {
        throw httpError(error);
      }
      throw error;
    }
  }

  private async run<T>(action: () => Promise<T>, response?: Response): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof LoginLimitedError) {
        if (response !== undefined) {
          response.setHeader("Retry-After", String(error.retryAfterSeconds));
        }
        throw httpError(new AuthError(429, error.message));
      }
      if (error instanceof AuthError) {
        throw httpError(error);
      }
      throw error;
    }
  }

  private presentSession(response: Response, credentials: Credentials, token: string): void {
    if (credentials.client === "MOBILE") {
      return;
    }
    response.setHeader("Set-Cookie", sessionCookieHeader(token, this.env.cookieSecure));
  }

  private publicBody(
    user: { id: string; email: string | null; phoneE164: string | null; status: string },
    client: Credentials["client"],
    token: string,
  ): Record<string, string | null> {
    const body: Record<string, string | null> = {
      id: user.id,
      email: user.email,
      phoneE164: user.phoneE164,
      status: user.status,
    };
    if (client === "MOBILE") {
      body["token"] = token;
    }
    return body;
  }
}

function headerValues(request: Request): { cookie?: string; authorization?: string } {
  const cookie = oneHeader(request.headers.cookie);
  const authorization = oneHeader(request.headers.authorization);
  return {
    ...(cookie === undefined ? {} : { cookie }),
    ...(authorization === undefined ? {} : { authorization }),
  };
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function httpError(error: AuthError): HttpException {
  return new HttpException({ message: error.message }, error.status);
}
