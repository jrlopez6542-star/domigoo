import { HttpException, NotFoundException } from "@nestjs/common";
import { CourierRepository } from "./couriers/courier.repository.js";
import { CouriersController } from "./couriers/couriers.controller.js";
import type { Database } from "./database.js";
import type { AdminRequest } from "./identity/admin.guard.js";
import type { AuthenticatedRequest } from "./identity/session.guard.js";
import type { PrivacyRepository } from "./privacy/privacy.repository.js";
import { isValidZonePolygonWkt } from "./tariffs/polygon-wkt.js";
import { TariffRepository } from "./tariffs/tariff.repository.js";
import { TariffsController } from "./tariffs/tariffs.controller.js";
import { VerificationAdminController } from "./verification/verification-admin.controller.js";
import { VerificationRepository } from "./verification/verification.repository.js";

function fkError(constraint: string): Error {
  return Object.assign(new Error(`insert or update violates foreign key "${constraint}"`), {
    code: "23503",
  });
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

describe("ORDEN 022 - API unitarios: WKT, 23503 -> 404, verification-cases enriquecido y GET /v1/couriers/me", () => {
  it("isValidZonePolygonWkt acepta POLYGON y SRID=4326;MULTIPOLYGON válidos y rechaza polígonos inválidos", () => {
    expect(
      isValidZonePolygonWkt(
        "POLYGON((-73.92 4.96, -73.90 4.96, -73.90 4.98, -73.92 4.98, -73.92 4.96))",
      ),
    ).toBe(true);
    expect(
      isValidZonePolygonWkt(
        "SRID=4326;MULTIPOLYGON(((-73.95 4.94,-73.88 4.94,-73.88 4.99,-73.95 4.99,-73.95 4.94)))",
      ),
    ).toBe(true);

    const invalidCases = [
      "",
      "not-a-polygon",
      "POINT(-73.91 4.96)",
      "POLYGON((1 2, 3 4))",
      "POLYGON((1 2, 3 4, 1 2))",
      "POLYGON((-73.92 4.96, -73.90 4.96, -73.90 4.98, -73.92 4.98))",
      "POLYGON((0 0, 0 0, 0 0, 0 0))",
      "POLYGON((-181 4.96, -73.90 4.96, -73.90 4.98, -181 4.96))",
      "POLYGON((-73.92 91, -73.90 4.96, -73.90 4.98, -73.92 91))",
      "POLYGON((NaN 4.96, -73.90 4.96, -73.90 4.98, NaN 4.96))",
      "SRID=3857;POLYGON((-73.92 4.96, -73.90 4.96, -73.90 4.98, -73.92 4.96))",
      "POLYGON((-73.92 4.96 0, -73.90 4.96 0, -73.90 4.98 0, -73.92 4.96 0))",
    ];
    for (const wkt of invalidCases) {
      expect(isValidZonePolygonWkt(wkt)).toBe(false);
    }
  });

  it("TariffsController.addZone valida polygonWkt -> 422 sin consultar la BD y mapea 23503 -> 404", async () => {
    let dbCalls = 0;
    const repo = new TariffRepository({
      pool: {
        query: () => {
          dbCalls += 1;
          return Promise.reject(fkError("tariff_zones_versionId_fkey"));
        },
      },
    } as unknown as Database);
    const ctrl = new TariffsController(repo);
    const req = { adminRole: "SUPERADMIN" } as AdminRequest;

    const badWkt = await catchHttp(() =>
      ctrl.addZone(
        {
          versionId: "00000000-0000-4000-8000-000000000001",
          code: "BAD",
          name: "Inválida",
          polygonWkt: "POLYGON((1 2, 3 4))",
          priority: 1,
        },
        req,
      ),
    );
    expect(badWkt.getStatus()).toBe(422);
    expect(badWkt.getResponse()).toEqual({ message: "El polígono de la zona no es válido" });
    expect(dbCalls).toBe(0);

    const missingVersion = await catchHttp(() =>
      ctrl.addZone(
        {
          versionId: "00000000-0000-4000-8000-000000000001",
          code: "CENTRO",
          name: "Centro",
          polygonWkt: "POLYGON((-73.92 4.96, -73.90 4.96, -73.90 4.98, -73.92 4.98, -73.92 4.96))",
          priority: 1,
        },
        req,
      ),
    );
    expect(missingVersion).toBeInstanceOf(NotFoundException);
    expect(missingVersion.getStatus()).toBe(404);
    expect(dbCalls).toBe(1);
  });

  it("TariffRepository.addRule mapea 23503 -> not_found y TariffsController.addRule responde 404", async () => {
    const repo = new TariffRepository({
      pool: {
        query: () => Promise.reject(fkError("tariff_rules_versionId_fkey")),
      },
    } as unknown as Database);

    await expect(
      repo.addRule({
        versionId: "00000000-0000-4000-8000-000000000001",
        zoneId: null,
        baseFeeCop: 4000,
        perKmCop: 1000,
        minimumFeeCop: 4000,
        nightMultiplierBps: 10000,
        nightStartsMinute: 0,
        nightEndsMinute: 0,
      }),
    ).resolves.toBe("not_found");

    const ctrl = new TariffsController(repo);
    const req = { adminRole: "OPERATIONS" } as AdminRequest;
    const ex = await catchHttp(() =>
      ctrl.addRule(
        {
          versionId: "00000000-0000-4000-8000-000000000001",
          zoneId: "00000000-0000-4000-8000-000000000002",
          baseFeeCop: 4000,
          perKmCop: 1000,
          minimumFeeCop: 4000,
          nightMultiplierBps: 10000,
          nightStartsMinute: 0,
          nightEndsMinute: 0,
        },
        req,
      ),
    );
    expect(ex).toBeInstanceOf(NotFoundException);
    expect(ex.getStatus()).toBe(404);
  });

  it("VerificationRepository.listPending une couriers y devuelve courierName y submittedAt ISO sin datos sensibles", async () => {
    const executedSql: string[] = [];
    const submitted = new Date("2026-11-24T15:30:00.000Z");
    const repo = new VerificationRepository({
      pool: {
        query: (sql: string) => {
          executedSql.push(sql);
          if (sql.includes("admin_profiles")) {
            return Promise.resolve({ rows: [{ role: "REVIEWER" }], rowCount: 1 });
          }
          return Promise.resolve({
            rows: [
              {
                id: "case-1",
                courierId: "cour-1",
                courierName: "Camila Torres",
                submittedAt: submitted,
              },
            ],
            rowCount: 1,
          });
        },
      },
    } as unknown as Database);

    const ctrl = new VerificationAdminController(repo);
    const cases = await ctrl.list({
      auth: { userId: "reviewer-1", sessionId: "s-1" },
    } as AuthenticatedRequest);

    expect(cases).toEqual([
      {
        id: "case-1",
        courierId: "cour-1",
        status: "PENDING_HUMAN",
        courierName: "Camila Torres",
        submittedAt: "2026-11-24T15:30:00.000Z",
      },
    ]);
    const listSql = executedSql.find((sql) => sql.includes("FROM verification_cases"));
    expect(listSql).toContain('JOIN couriers c ON c.id = vc."courierId"');
    expect(listSql).not.toContain("documentNumber");
  });

  it("CouriersController.me devuelve { id, status, firstName, lastName } o 404 si no hay perfil", async () => {
    let executedSql = "";
    const repo = new CourierRepository({
      pool: {
        query: (sql: string, params: unknown[]) => {
          executedSql = sql;
          if (params[0] === "user-with-profile") {
            return Promise.resolve({
              rows: [
                {
                  id: "courier-1",
                  status: "APPROVED",
                  firstName: "Mateo",
                  lastName: "Pérez",
                },
              ],
              rowCount: 1,
            });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
      },
    } as unknown as Database);
    const ctrl = new CouriersController(repo, {} as PrivacyRepository);

    const profile = await ctrl.me({
      auth: { userId: "user-with-profile", sessionId: "s-1" },
    } as AuthenticatedRequest);
    expect(profile).toEqual({
      id: "courier-1",
      status: "APPROVED",
      firstName: "Mateo",
      lastName: "Pérez",
    });
    expect(Object.keys(profile).sort()).toEqual(["firstName", "id", "lastName", "status"]);
    expect(executedSql).not.toContain("documentNumber");

    const missing = await catchHttp(() =>
      ctrl.me({
        auth: { userId: "user-without-profile", sessionId: "s-2" },
      } as AuthenticatedRequest),
    );
    expect(missing).toBeInstanceOf(NotFoundException);
    expect(missing.getStatus()).toBe(404);
  });
});
