import { Injectable, Optional } from "@nestjs/common";
import { AuditRecorder } from "../audit/audit.service.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { parseColombianPhone } from "./phone.js";
import {
  assertLoginAllowed,
  clearLoginFailures,
  LoginLimitedError,
  recordLoginFailure,
} from "./login-throttle.js";
import {
  IdentityRepository,
  MissingLegalVersionError,
  type PublicUser,
} from "./identity.repository.js";
import { createSessionToken, hashSessionToken } from "./session-token.js";
import { readSessionCookie } from "./session-cookie.js";

export type ClientKind = "WEB" | "MOBILE" | "ADMIN";

export type Credentials = {
  email: string | null;
  phoneE164: string | null;
  password: string;
  client: ClientKind;
};

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthError";
  }
}

const INVALID = "Credenciales inválidas";
const DUMMY_PASSWORD = hashPassword("marcador-interno-no-es-una-clave");

export type RegistrationRole = "CUSTOMER" | "RESTAURANT" | "COURIER";

export type RegistrationConsentsPayload = {
  version: string;
  requestedVersion?: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  sensitiveDataAccepted: boolean;
  marketingAccepted: boolean;
};

export type RegistrationInput = Credentials & {
  role: RegistrationRole;
  consents: RegistrationConsentsPayload;
};

export const CURRENT_LEGAL_VERSION = "0.1-borrador";

@Injectable()
export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly audit: AuditRecorder,
    @Optional() private readonly rateLimit?: RateLimitService,
  ) {}

  async register(
    input: RegistrationInput,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<{ user: PublicUser; token: string; legalVersion: string; consentPurposes: string[] }> {
    const passwordHash = hashPassword(input.password);
    try {
      const { user, consentPurposes, legalVersion } = await this.repository.insertUserWithConsents({
        email: input.email,
        phoneE164: input.phoneE164,
        passwordHash,
        consents: {
          ...input.consents,
          channel: input.client,
          ...(meta?.ip === undefined ? {} : { ip: meta.ip }),
          ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
        },
      });
      const token = await this.openSession(user.id, input.client);
      return { user, token, legalVersion, consentPurposes };
    } catch (error) {
      if (error instanceof MissingLegalVersionError) {
        throw new AuthError(422, error.message, { cause: error });
      }
      if (isUniqueViolation(error)) {
        throw new AuthError(409, "Ya existe una cuenta con esos datos", { cause: error });
      }
      throw error;
    }
  }

  async login(input: Credentials, ip = "unknown"): Promise<{ user: PublicUser; token: string }> {
    const key = loginKey(input);
    if (this.rateLimit !== undefined) {
      await this.rateLimit.assertLoginAllowed(key, ip);
    } else {
      assertLoginAllowed(key);
    }
    const stored =
      input.email !== null
        ? await this.repository.findByEmail(input.email)
        : await this.repository.findByPhone(input.phoneE164 ?? "");
    const hash = stored?.passwordHash ?? DUMMY_PASSWORD;
    const matches = verifyPassword(input.password, hash);
    if (stored === null || stored.passwordHash === null || !matches || stored.status !== "ACTIVE") {
      if (this.rateLimit !== undefined) {
        await this.rateLimit.recordLoginFailure(key, ip);
      } else {
        recordLoginFailure(key);
      }
      await this.audit.record({
        actorId: stored?.id ?? null,
        actorKind: "SYSTEM",
        action: "auth.login_failed",
        entityType: "user",
        entityId: stored?.id ?? "00000000-0000-0000-0000-000000000000",
        reason: "invalid_credentials",
      });
      throw new AuthError(401, INVALID);
    }
    if (this.rateLimit !== undefined) {
      await this.rateLimit.clearLoginFailures(key, ip);
    } else {
      clearLoginFailures(key);
    }
    const token = await this.openSession(stored.id, input.client);
    return {
      user: {
        id: stored.id,
        email: stored.email,
        phoneE164: stored.phoneE164,
        status: stored.status,
      },
      token,
    };
  }

  async me(headers: { cookie?: string; authorization?: string }): Promise<PublicUser> {
    const session = await this.sessionFromHeaders(headers);
    if (session === null) {
      throw new AuthError(401, "Sesión inválida");
    }
    const user = await this.repository.findById(session.userId);
    if (user === null || user.status !== "ACTIVE") {
      throw new AuthError(401, "Sesión inválida");
    }
    return user;
  }

  async logout(headers: { cookie?: string; authorization?: string }): Promise<void> {
    const session = await this.sessionFromHeaders(headers);
    if (session === null) {
      throw new AuthError(401, "Sesión inválida");
    }
    await this.repository.revokeSession(session.id);
  }

  async authenticate(headers: {
    cookie?: string;
    authorization?: string;
  }): Promise<{ userId: string; sessionId: string } | null> {
    const session = await this.sessionFromHeaders(headers);
    if (session === null) {
      return null;
    }
    return { userId: session.userId, sessionId: session.id };
  }

  private async openSession(userId: string, client: ClientKind): Promise<string> {
    const token = createSessionToken();
    await this.repository.insertSession({
      userId,
      tokenHash: token.hash,
      client,
    });
    return token.raw;
  }

  private async sessionFromHeaders(headers: { cookie?: string; authorization?: string }) {
    const raw = bearer(headers.authorization) ?? readSessionCookie(headers.cookie);
    if (raw === undefined) {
      return null;
    }
    const session = await this.repository.findSession(hashSessionToken(raw));
    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now() ||
      session.userStatus !== "ACTIVE"
    ) {
      return null;
    }
    return session;
  }
}

export function parseCredentials(body: unknown): Credentials {
  if (!isRecord(body)) {
    throw new AuthError(400, "El cuerpo debe ser un objeto");
  }
  const email = optionalString(body["email"]);
  const phone = optionalString(body["phoneE164"]);
  const password = optionalString(body["password"]);
  const client = optionalString(body["client"]);
  if (password === null || password.length < 12 || password.length > 72) {
    throw new AuthError(400, "La contraseña debe tener entre 12 y 72 caracteres");
  }
  if (client !== "WEB" && client !== "MOBILE" && client !== "ADMIN") {
    throw new AuthError(400, "El cliente debe ser WEB, MOBILE o ADMIN");
  }
  if (email === null && phone === null) {
    throw new AuthError(400, "Hace falta un correo o un teléfono");
  }
  let parsedPhone: string | null = null;
  if (phone !== null) {
    try {
      parsedPhone = parseColombianPhone(phone);
    } catch (error) {
      throw new AuthError(400, error instanceof Error ? error.message : "Teléfono inválido");
    }
  }
  const parsedEmail = email === null ? null : parseEmail(email);
  return { email: parsedEmail, phoneE164: parsedPhone, password, client };
}

export function parseRegistrationInput(body: unknown): RegistrationInput {
  const credentials = parseCredentials(body);
  if (!isRecord(body)) {
    throw new AuthError(400, "El cuerpo debe ser un objeto");
  }
  const rawRole = optionalString(body["role"]);
  const role: RegistrationRole =
    rawRole === "COURIER" || rawRole === "RESTAURANT" || rawRole === "CUSTOMER"
      ? rawRole
      : rawRole === null
        ? "CUSTOMER"
        : (() => {
            throw new AuthError(400, "El rol debe ser CUSTOMER, RESTAURANT o COURIER");
          })();

  const rawConsents = body["consents"];
  if (!isRecord(rawConsents)) {
    throw new AuthError(
      422,
      "Debes aceptar los Términos y Condiciones y la Autorización de Tratamiento de Datos Personales para registrarte",
    );
  }
  const termsAccepted = rawConsents["termsAccepted"] === true;
  const privacyAccepted = rawConsents["privacyAccepted"] === true;
  const sensitiveDataAccepted = rawConsents["sensitiveDataAccepted"] === true;
  const marketingAccepted = rawConsents["marketingAccepted"] === true;
  const rawVersion = optionalString(rawConsents["version"]);
  const version = rawVersion ?? CURRENT_LEGAL_VERSION;
  if (version.length > 20) {
    throw new AuthError(400, "La versión legal es inválida");
  }

  if (!termsAccepted || !privacyAccepted) {
    throw new AuthError(
      422,
      "Debes aceptar los Términos y Condiciones y la Autorización de Tratamiento de Datos Personales para registrarte",
    );
  }
  if (role === "COURIER" && !sensitiveDataAccepted) {
    throw new AuthError(
      422,
      "Los domiciliarios deben autorizar el tratamiento de datos sensibles para verificar su identidad",
    );
  }

  return {
    ...credentials,
    role,
    consents: {
      version,
      ...(rawVersion !== null ? { requestedVersion: rawVersion } : {}),
      termsAccepted,
      privacyAccepted,
      sensitiveDataAccepted,
      marketingAccepted,
    },
  };
}

export { LoginLimitedError };

function loginKey(input: Credentials): string {
  return input.email ?? input.phoneE164 ?? "sin-identificador";
}

function parseEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError(400, "El correo no es válido");
  }
  return email;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new AuthError(400, "Los campos de texto deben ser cadenas");
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bearer(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith("Bearer ")) {
    return undefined;
  }
  const token = header.slice("Bearer ".length).trim();
  return token === "" ? undefined : token;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
