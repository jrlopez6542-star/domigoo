import { HttpException, HttpStatus, NotFoundException, type ArgumentsHost } from "@nestjs/common";
import { SafeHttpExceptionFilter } from "./http-exception.filter.js";

type MockResponse = {
  headersSent: boolean;
  statusCode: number;
  headers: Record<string, string>;
  jsonBody: unknown;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => void;
};

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    headersSent: false,
    statusCode: 200,
    headers: {},
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
  };
  return res;
}

function createHost(res: MockResponse, headers: Record<string, string> = {}): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
}

describe("SafeHttpExceptionFilter - manejo de PG 22P02 (ORDEN 020)", () => {
  it("convierte error de pg con code 22P02 en 404 con el mismo cuerpo que NotFoundException sin log de 500", () => {
    const filter = new SafeHttpExceptionFilter();
    const res = createMockResponse();
    const origError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const pgError = Object.assign(new Error('invalid input syntax for type uuid: "abc"'), {
        code: "22P02",
      });
      filter.catch(pgError, createHost(res));
    } finally {
      console.error = origError;
    }
    const notFoundBody = new NotFoundException().getResponse();
    expect(res.statusCode).toBe(404);
    expect(res.jsonBody).toEqual({ message: "Not Found", statusCode: 404 });
    expect(res.jsonBody).toEqual(notFoundBody);
    expect(res.headers["x-request-id"]).toBeUndefined();
    expect(logged).toHaveLength(0);
  });

  it("mantiene 500 con requestId para otros errores de pg (distintos de 22P02) y errores genéricos", () => {
    const filter = new SafeHttpExceptionFilter();
    const res = createMockResponse();
    const origError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const pgError = Object.assign(new Error("duplicate key"), { code: "23505" });
      filter.catch(pgError, createHost(res, { "x-vercel-id": "iad1::pg23505" }));
    } finally {
      console.error = origError;
    }
    expect(res.statusCode).toBe(500);
    expect(res.headers["x-request-id"]).toBe("iad1::pg23505");
    expect(res.jsonBody).toEqual({
      status: "error",
      message: "Error interno del servidor",
      requestId: "iad1::pg23505",
    });
    expect(logged).toHaveLength(1);
  });

  it("no altera HttpException 422 ni 404 existentes", () => {
    const filter = new SafeHttpExceptionFilter();
    const res422 = createMockResponse();
    filter.catch(
      new HttpException({ message: "La versión de los documentos legales no existe" }, 422),
      createHost(res422),
    );
    expect(res422.statusCode).toBe(422);
    expect(res422.jsonBody).toEqual({ message: "La versión de los documentos legales no existe" });

    const res404 = createMockResponse();
    filter.catch(new HttpException("Recurso no existe", HttpStatus.NOT_FOUND), createHost(res404));
    expect(res404.statusCode).toBe(404);
    expect(res404.jsonBody).toEqual({ statusCode: 404, message: "Recurso no existe" });
  });
});
