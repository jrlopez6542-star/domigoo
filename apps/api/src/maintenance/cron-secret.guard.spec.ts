import {
  type ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { CronSecretGuard } from "./cron-secret.guard.js";

function mockContext(headers: Record<string, string | string[] | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe("CronSecretGuard", () => {
  const originalSecret = process.env["CRON_SECRET"];

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env["CRON_SECRET"];
    } else {
      process.env["CRON_SECRET"] = originalSecret;
    }
  });

  it("lanza 503 si CRON_SECRET no está configurado", () => {
    delete process.env["CRON_SECRET"];
    const guard = new CronSecretGuard();
    expect(() => guard.canActivate(mockContext({}))).toThrow(ServiceUnavailableException);
  });

  it("rechaza con 401 si falta el token o es incorrecto", () => {
    process.env["CRON_SECRET"] = "super-secreto-cron-123";
    const guard = new CronSecretGuard();

    expect(() => guard.canActivate(mockContext({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(mockContext({ authorization: "Bearer incorrecto" }))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(mockContext({ "x-cron-secret": "incorrecto" }))).toThrow(
      UnauthorizedException,
    );
  });

  it("permite acceso con Bearer o x-cron-secret válidos", () => {
    process.env["CRON_SECRET"] = "super-secreto-cron-123";
    const guard = new CronSecretGuard();

    expect(guard.canActivate(mockContext({ authorization: "Bearer super-secreto-cron-123" }))).toBe(
      true,
    );
    expect(guard.canActivate(mockContext({ "x-cron-secret": "super-secreto-cron-123" }))).toBe(
      true,
    );
  });
});
