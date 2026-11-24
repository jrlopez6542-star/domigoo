import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  ServiceUnavailableException,
  type ArgumentsHost,
} from "@nestjs/common";
import { SafeHttpExceptionFilter } from "./http-exception.filter.js";
type MockResponse = {
  headersSent: boolean;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  jsonBody: unknown;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => void;
  end: (chunk?: string) => void;
};
function createMockResponse(headersSent = false): MockResponse {
  const res: MockResponse = {
    headersSent,
    statusCode: 200,
    headers: {},
    body: "",
    jsonBody: undefined,
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.jsonBody = payload;
    },
    end(chunk = "") {
      res.body = chunk;
    },
  };
  return res;
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
describe("ORDEN 005 PARTE A: hardening de errores 5xx en api/index.mjs y SafeHttpExceptionFilter", () => {
  describe("api/index.mjs", () => {
    let tempRoot: string;
    let entryCopyPath: string;
    beforeAll(() => {
      tempRoot = mkdtempSync(join(tmpdir(), "domigoo-api-entry-test-"));
      mkdirSync(join(tempRoot, "api"), { recursive: true });
      mkdirSync(join(tempRoot, "apps", "api", "dist"), { recursive: true });
      const originalEntry = readFileSync(
        resolve(process.cwd(), "..", "..", "api", "index.mjs"),
        "utf8",
      );
      entryCopyPath = join(tempRoot, "api", "index.mjs");
      writeFileSync(entryCopyPath, originalEntry);
      writeFileSync(
        join(tempRoot, "apps", "api", "dist", "vercel.js"),
        `export function createVercelHandler() { return Promise.reject(new Error("postgresql://secret_user:secret_pass@internal.db/prod")); }`,
      );
      writeFileSync(
        join(tempRoot, "apps", "api", "dist", "vercel-build-meta.js"),
        `export const vercelBuildMeta = { vercelEnv: "preview", commitSha: "abc", deploymentId: "dpl_1", migrateDeploy: "ok", seedStaging: "ok" };`,
      );
    });
    afterAll(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });
    it("responde 500 genérico con x-vercel-id en requestId y x-request-id sin filtrar error.message", async () => {
      const mod = (await import(`${pathToFileURL(entryCopyPath).href}?t=1`)) as {
        default: (req: unknown, res: unknown) => Promise<void>;
      };
      const origError = console.error;
      const logged: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        logged.push(args);
      };
      const res = createMockResponse();
      try {
        await mod.default({ headers: { "x-vercel-id": "iad1::abc123" } }, res);
      } finally {
        console.error = origError;
      }
      expect(res.statusCode).toBe(500);
      expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(res.headers["x-request-id"]).toBe("iad1::abc123");
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      expect(parsed).toEqual({
        status: "error",
        message: "Error interno del servidor",
        requestId: "iad1::abc123",
      });
      expect(res.body).not.toContain("secret_pass");
      expect(res.body).not.toContain("postgresql://");
      expect(logged.length).toBe(1);
    });
    it("genera UUID para requestId y x-request-id cuando falta x-vercel-id y registra error en servidor", async () => {
      const mod = (await import(`${pathToFileURL(entryCopyPath).href}?t=2`)) as {
        default: (req: unknown, res: unknown) => Promise<void>;
      };
      const origError = console.error;
      const logged: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        logged.push(args);
      };
      const res = createMockResponse();
      try {
        await mod.default({ headers: {} }, res);
        expect(logged.length).toBe(1);
        expect(String(logged[0]?.[0])).toContain(res.headers["x-request-id"]);
      } finally {
        console.error = origError;
      }
      expect(res.statusCode).toBe(500);
      expect(res.headers["x-request-id"]).toMatch(UUID_PATTERN);
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      expect(parsed["status"]).toBe("error");
      expect(parsed["message"]).toBe("Error interno del servidor");
      expect(parsed["requestId"]).toBe(res.headers["x-request-id"]);
    });
    it("ignora x-vercel-id inválido (largo o con caracteres no permitidos) y genera UUID", async () => {
      const mod = (await import(`${pathToFileURL(entryCopyPath).href}?t=3`)) as {
        default: (req: unknown, res: unknown) => Promise<void>;
      };
      const origError = console.error;
      console.error = () => {};
      try {
        for (const badHeader of ["bad id!\r\n", "a".repeat(129)]) {
          const res = createMockResponse();
          await mod.default({ headers: { "x-vercel-id": badHeader } }, res);
          expect(res.statusCode).toBe(500);
          expect(res.headers["x-request-id"]).toMatch(UUID_PATTERN);
          expect(res.headers["x-request-id"]).not.toBe(badHeader);
        }
      } finally {
        console.error = origError;
      }
    });
  });
  describe("SafeHttpExceptionFilter", () => {
    function createHost(reqHeaders: Record<string, string>, res: MockResponse): ArgumentsHost {
      return {
        switchToHttp: () => ({
          getRequest: () => ({ headers: reqHeaders }),
          getResponse: () => res,
        }),
      } as unknown as ArgumentsHost;
    }
    it("oculta detalles internos en 500 de HttpException con requestId y x-request-id", () => {
      const filter = new SafeHttpExceptionFilter();
      const res = createMockResponse();
      const origError = console.error;
      const logged: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        logged.push(args);
      };
      try {
        filter.catch(
          new InternalServerErrorException("Fuga de postgres://user:pass@host/db"),
          createHost({ "x-vercel-id": "sfo1::xyz" }, res),
        );
      } finally {
        console.error = origError;
      }
      expect(logged.length).toBe(1);
      expect(res.statusCode).toBe(500);
      expect(res.headers["x-request-id"]).toBe("sfo1::xyz");
      expect(res.jsonBody).toEqual({
        status: "error",
        message: "Error interno del servidor",
        requestId: "sfo1::xyz",
      });
    });
    it("conserva status 503 y body {status:'unavailable'} de ServiceUnavailableException mientras registra requestId", () => {
      const filter = new SafeHttpExceptionFilter();
      const res = createMockResponse();
      const origError = console.error;
      const logged: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        logged.push(args);
      };
      try {
        filter.catch(
          new ServiceUnavailableException({ status: "unavailable" }),
          createHost({ "x-vercel-id": "iad1::503" }, res),
        );
      } finally {
        console.error = origError;
      }
      expect(logged.length).toBe(1);
      expect(String(logged[0]?.[0])).toContain("iad1::503");
      expect(res.statusCode).toBe(503);
      expect(res.headers["x-request-id"]).toBe("iad1::503");
      expect(res.jsonBody).toEqual({ status: "unavailable" });
    });
    it("enmascara InternalServerErrorException('detalle') con 500 genérico y requestId", () => {
      const filter = new SafeHttpExceptionFilter();
      const res = createMockResponse();
      const origError = console.error;
      console.error = () => {};
      try {
        filter.catch(new InternalServerErrorException("detalle"), createHost({}, res));
      } finally {
        console.error = origError;
      }
      expect(res.statusCode).toBe(500);
      expect(res.headers["x-request-id"]).toMatch(UUID_PATTERN);
      expect(res.jsonBody).toEqual({
        status: "error",
        message: "Error interno del servidor",
        requestId: res.headers["x-request-id"],
      });
    });
    it("devuelve 500 con mensaje genérico y requestId ante un error no HttpException", () => {
      const filter = new SafeHttpExceptionFilter();
      const res = createMockResponse();
      const origError = console.error;
      console.error = () => {};
      try {
        filter.catch(new Error("Fallo inesperado en pg.Pool"), createHost({}, res));
      } finally {
        console.error = origError;
      }
      expect(res.statusCode).toBe(500);
      expect(res.headers["x-request-id"]).toMatch(UUID_PATTERN);
      expect(res.jsonBody).toEqual({
        status: "error",
        message: "Error interno del servidor",
        requestId: res.headers["x-request-id"],
      });
    });
    it("ignora x-vercel-id inválido en el filtro y genera UUID", () => {
      const filter = new SafeHttpExceptionFilter();
      const res = createMockResponse();
      const origError = console.error;
      console.error = () => {};
      try {
        filter.catch(
          new Error("boom"),
          createHost({ "x-vercel-id": "invalido con espacios!" }, res),
        );
      } finally {
        console.error = origError;
      }
      expect(res.statusCode).toBe(500);
      expect(res.headers["x-request-id"]).toMatch(UUID_PATTERN);
    });
    it("preserva exactamente body y status de 4xx como el comportamiento por defecto de Nest", () => {
      const filter = new SafeHttpExceptionFilter();
      const resObj = createMockResponse();
      const objEx = new BadRequestException({ message: "Campo inválido", code: "INVALID_FIELD" });
      filter.catch(objEx, createHost({}, resObj));
      expect(resObj.statusCode).toBe(objEx.getStatus());
      expect(resObj.jsonBody).toEqual(objEx.getResponse());
      const resStr = createMockResponse();
      const strEx = new HttpException("No autorizado", HttpStatus.FORBIDDEN);
      filter.catch(strEx, createHost({}, resStr));
      expect(resStr.statusCode).toBe(403);
      expect(resStr.jsonBody).toEqual({ statusCode: 403, message: "No autorizado" });
    });
    it("no intenta responder si los headers ya fueron enviados (headersSent=true)", () => {
      const filter = new SafeHttpExceptionFilter();
      const res = createMockResponse(true);
      filter.catch(new Error("error tardío"), createHost({}, res));
      expect(res.statusCode).toBe(200);
      expect(res.jsonBody).toBeUndefined();
      expect(res.headers["x-request-id"]).toBeUndefined();
    });
  });
});
