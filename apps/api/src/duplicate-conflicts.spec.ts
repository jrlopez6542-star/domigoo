import { HttpException } from "@nestjs/common";
import type { AuditRecorder } from "./audit/audit.service.js";
import type { Database } from "./database.js";
import type { AdminRequest } from "./identity/admin.guard.js";
import type { AuthenticatedRequest } from "./identity/session.guard.js";
import { DevicesController } from "./notifications/devices.controller.js";
import { OutboxRepository } from "./notifications/outbox.repository.js";
import type { PushSender } from "./notifications/push-sender.port.js";
import { PrivacyController } from "./privacy/privacy.controller.js";
import { PrivacyRepository } from "./privacy/privacy.repository.js";
import { RestaurantRepository } from "./restaurants/restaurant.repository.js";
import { RestaurantsController } from "./restaurants/restaurants.controller.js";
import { TariffRepository } from "./tariffs/tariff.repository.js";
import { TariffsController } from "./tariffs/tariffs.controller.js";

function uniqueError(constraint: string): Error {
  return Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint}"`),
    {
      code: "23505",
    },
  );
}

async function catchHttp(fn: () => Promise<unknown>): Promise<HttpException> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return err as HttpException;
  }
  throw new Error("Se esperaba HttpException");
}

describe("ORDEN 021 - Duplicados PG 23505 -> 409 y hours en listBranchesForUser", () => {
  it("RestaurantRepository.createSite hace ROLLBACK y devuelve conflict en 23505; RestaurantsController responde 409", async () => {
    const queries: string[] = [];
    const client = {
      query: (sql: string) => {
        queries.push(sql.trim());
        if (sql.includes("INSERT INTO restaurants")) {
          return Promise.reject(uniqueError("restaurants_nit_key"));
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release: () => {},
    };
    const repo = new RestaurantRepository({
      pool: { connect: () => Promise.resolve(client) },
    } as unknown as Database);

    await expect(
      repo.createSite({
        ownerId: "user-1",
        legalName: "Restaurante Uno SAS",
        tradeName: "Restaurante Uno",
        nit: "900111222-1",
        email: "uno@example.invalid",
        phoneE164: "+573001112233",
        establishmentName: "Principal",
        branchName: "Centro",
        addressLine: "Calle 8 # 5-10",
        longitude: -73.9125,
        latitude: 4.9652,
      }),
    ).resolves.toBe("conflict");
    expect(queries).toContain("BEGIN");
    expect(queries).toContain("ROLLBACK");

    const ctrl = new RestaurantsController(
      { createSite: () => Promise.resolve("conflict") } as unknown as RestaurantRepository,
      {} as AuditRecorder,
    );
    const req = { auth: { userId: "user-1", sessionId: "s-1" } } as AuthenticatedRequest;
    const ex = await catchHttp(() =>
      ctrl.create(
        {
          legalName: "Restaurante Uno SAS",
          tradeName: "Restaurante Uno",
          nit: "900111222-1",
          email: "uno@example.invalid",
          phoneE164: "+573001112233",
          establishmentName: "Principal",
          branchName: "Centro",
          addressLine: "Calle 8 # 5-10",
          longitude: -73.9125,
          latitude: 4.9652,
        },
        req,
      ),
    );
    expect(ex.getStatus()).toBe(409);
    expect(ex.getResponse()).toEqual({ message: "Ya existe un restaurante con ese NIT" });
  });

  it("PrivacyRepository.insertDocument devuelve conflict en 23505; PrivacyController.publish responde 409", async () => {
    const repo = new PrivacyRepository({
      pool: { query: () => Promise.reject(uniqueError("legal_documents_kind_version_key")) },
    } as unknown as Database);
    await expect(
      repo.insertDocument({ kind: "TERMS", version: "2026-02", content: "Texto" }),
    ).resolves.toBe("conflict");

    const ctrl = new PrivacyController({
      insertDocument: () => Promise.resolve("conflict"),
    } as unknown as PrivacyRepository);
    const req = { adminRole: "SUPERADMIN" } as AdminRequest;
    const ex = await catchHttp(() =>
      ctrl.publish({ kind: "TERMS", version: "2026-02", content: "Texto" }, req),
    );
    expect(ex.getStatus()).toBe(409);
    expect(ex.getResponse()).toEqual({
      message: "Ya existe un documento legal con ese tipo y versión",
    });
  });

  it("TariffRepository.addZone devuelve conflict en 23505; TariffsController.addZone responde 409", async () => {
    const repo = new TariffRepository({
      pool: { query: () => Promise.reject(uniqueError("tariff_zones_versionId_code_key")) },
    } as unknown as Database);
    await expect(
      repo.addZone({
        versionId: "ver-1",
        code: "CENTRO",
        name: "Centro",
        polygonWkt: "POLYGON((-73.92 4.96, -73.90 4.96, -73.90 4.98, -73.92 4.98, -73.92 4.96))",
        priority: 1,
      }),
    ).resolves.toBe("conflict");

    const ctrl = new TariffsController({
      addZone: () => Promise.resolve("conflict"),
    } as unknown as TariffRepository);
    const req = { adminRole: "SUPERADMIN" } as AdminRequest;
    const ex = await catchHttp(() =>
      ctrl.addZone(
        {
          versionId: "ver-1",
          code: "CENTRO",
          name: "Centro",
          polygonWkt: "POLYGON((-73.92 4.96, -73.90 4.96, -73.90 4.98, -73.92 4.98, -73.92 4.96))",
          priority: 1,
        },
        req,
      ),
    );
    expect(ex.getStatus()).toBe(409);
    expect(ex.getResponse()).toEqual({
      message: "Ya existe una zona con ese código en esta versión",
    });
  });

  it("OutboxRepository.registerPushToken devuelve conflict en 23505; DevicesController responde 409", async () => {
    let call = 0;
    const repo = new OutboxRepository(
      {
        pool: {
          query: () => {
            call += 1;
            if (call === 1) {
              return Promise.resolve({ rows: [], rowCount: 0 });
            }
            return Promise.reject(uniqueError("device_push_tokens_token_key"));
          },
        },
      } as unknown as Database,
      {} as PushSender,
    );
    await expect(repo.registerPushToken("user-2", "token-duplicado-123456")).resolves.toBe(
      "conflict",
    );

    const ctrl = new DevicesController({
      registerPushToken: () => Promise.resolve("conflict"),
    } as unknown as OutboxRepository);
    const req = { auth: { userId: "user-2", sessionId: "s-2" } } as AuthenticatedRequest;
    const ex = await catchHttp(() =>
      ctrl.registerPushToken({ token: "token-duplicado-123456" }, req),
    );
    expect(ex.getStatus()).toBe(409);
    expect(ex.getResponse()).toEqual({ message: "Ese token push ya está registrado" });
  });

  it("RestaurantRepository.listBranchesForUser selecciona hours ordenadas por weekday desde branch_hours", async () => {
    const executedSql: string[] = [];
    let call = 0;
    const repo = new RestaurantRepository({
      pool: {
        query: (sql: string) => {
          executedSql.push(sql);
          call += 1;
          if (call === 1) {
            return Promise.resolve({ rows: [{ id: "mem-1" }], rowCount: 1 });
          }
          return Promise.resolve({
            rows: [
              {
                id: "b-1",
                restaurantId: "r-1",
                restaurantName: "Sabores",
                restaurantStatus: "DRAFT",
                establishmentName: "Sede",
                name: "Principal",
                addressLine: "Calle 8",
                status: "DRAFT",
                hours: [{ weekday: 1, opensMinute: 480, closesMinute: 1200, closed: false }],
              },
            ],
            rowCount: 1,
          });
        },
      },
    } as unknown as Database);

    const branches = await repo.listBranchesForUser("user-1");
    expect(Array.isArray(branches)).toBe(true);
    expect(executedSql[1]).toContain("FROM branch_hours h");
    expect(executedSql[1]).toContain("ORDER BY h.weekday ASC");
    expect(executedSql[1]).toContain("AS hours");
  });
});
