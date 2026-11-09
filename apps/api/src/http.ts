import type { INestApplication } from "@nestjs/common";

type SecurityResponse = {
  setHeader: (name: string, value: string) => void;
};

export function applyHttpSecurity(app: INestApplication): void {
  app.use((_request: unknown, response: SecurityResponse, next: () => void) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
}
