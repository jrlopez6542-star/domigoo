import { randomUUID } from "node:crypto";
import {
  type ArgumentsHost,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
type FilterRequest = {
  headers?: Record<string, string | string[] | undefined>;
};
type FilterResponse = {
  headersSent?: boolean;
  status: (code: number) => FilterResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
};
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/;
export class SafeHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FilterRequest>();
    const response = http.getResponse<FilterResponse>();
    if (response.headersSent) {
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status !== 500) {
        if (status >= 500) {
          const requestId = resolveRequestId(request);
          console.error(
            `[api] requestId=${requestId} status=${String(status)}`,
            formatSafeErrorLog(exception),
          );
          response.setHeader("x-request-id", requestId);
        }
        const body = exception.getResponse();
        response
          .status(status)
          .json(typeof body === "string" ? { statusCode: status, message: body } : body);
        return;
      }
      const requestId = resolveRequestId(request);
      console.error(
        `[api] requestId=${requestId} status=${String(status)}`,
        formatSafeErrorLog(exception),
      );
      response.setHeader("x-request-id", requestId);
      response.status(status).json({
        status: "error",
        message: "Error interno del servidor",
        requestId,
      });
      return;
    }
    const requestId = resolveRequestId(request);
    console.error(`[api] requestId=${requestId} status=500`, formatSafeErrorLog(exception));
    response.setHeader("x-request-id", requestId);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: "error",
      message: "Error interno del servidor",
      requestId,
    });
  }
}
function formatSafeErrorLog(exception: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  const isProd =
    process.env["NODE_ENV"] === "production" || process.env["VERCEL_ENV"] === "production";
  const name = exception instanceof Error ? exception.name : "UnknownError";
  const message = exception instanceof Error ? exception.message : String(exception);
  if (!isProd && exception instanceof Error && exception.stack) {
    return { name, message, stack: exception.stack };
  }
  return { name, message };
}
function resolveRequestId(request: FilterRequest | undefined): string {
  const raw = request?.headers?.["x-vercel-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string" && SAFE_REQUEST_ID_PATTERN.test(value)) {
    return value;
  }
  return randomUUID();
}
