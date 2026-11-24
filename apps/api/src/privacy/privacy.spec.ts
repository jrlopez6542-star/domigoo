import { HttpException, NotFoundException } from "@nestjs/common";
import type { Database } from "../database.js";
import type { AuthenticatedRequest } from "../identity/session.guard.js";
import { PrivacyController, readConsent } from "./privacy.controller.js";
import { PrivacyRepository } from "./privacy.repository.js";

describe("validación de legalDocumentId en POST /v1/consents (ORDEN 019)", () => {
  const validUuid = "11111111-1111-4111-8111-111111111111";

  it("readConsent acepta UUID válido y rechaza mal formados con invalid-document-id", () => {
    expect(
      readConsent({
        legalDocumentId: validUuid,
        purpose: "GEOLOCATION",
        channel: "WEB",
      }),
    ).toEqual({
      ok: true,
      value: {
        legalDocumentId: validUuid,
        purpose: "GEOLOCATION",
        channel: "WEB",
      },
    });

    for (const badId of [
      "no-es-uuid",
      "",
      "   ",
      "12345",
      "11111111-1111-4111-8111-11111111111z",
      ` ${validUuid} `,
      123,
      null,
      undefined,
    ]) {
      expect(
        readConsent({
          legalDocumentId: badId,
          purpose: "GEOLOCATION",
          channel: "WEB",
        }),
      ).toEqual({ ok: false, reason: "invalid-document-id" });
    }
  });

  it("PrivacyRepository.insertConsent mapea PG 23503 a missing y PG 22P02 a invalid sin lanzar 500", async () => {
    const repoMissing = new PrivacyRepository({
      pool: {
        query: () => Promise.reject(Object.assign(new Error("fk"), { code: "23503" })),
      },
    } as unknown as Database);
    await expect(
      repoMissing.insertConsent({
        userId: "u-1",
        legalDocumentId: validUuid,
        purpose: "GEOLOCATION",
        channel: "WEB",
      }),
    ).resolves.toBe("missing");

    const repoInvalid = new PrivacyRepository({
      pool: {
        query: () => Promise.reject(Object.assign(new Error("uuid"), { code: "22P02" })),
      },
    } as unknown as Database);
    await expect(
      repoInvalid.insertConsent({
        userId: "u-1",
        legalDocumentId: "mal-formado",
        purpose: "GEOLOCATION",
        channel: "WEB",
      }),
    ).resolves.toBe("invalid");
  });

  it("PrivacyController.grant responde 422 en mal formado sin tocar BD, 404 en inexistente y 201 en válido", async () => {
    let calls = 0;
    const req = {
      auth: { userId: "user-1", sessionId: "sess-1" },
      headers: {},
    } as unknown as AuthenticatedRequest;

    const ctrl = new PrivacyController({
      insertConsent: (input: { legalDocumentId: string }) => {
        calls += 1;
        if (input.legalDocumentId === "00000000-0000-4000-8000-000000000000") {
          return Promise.resolve("missing");
        }
        return Promise.resolve({ id: "consent-1", legalDocumentId: input.legalDocumentId });
      },
    } as unknown as PrivacyRepository);

    let caught: unknown = null;
    try {
      await ctrl.grant({ legalDocumentId: "no-uuid", purpose: "GEOLOCATION", channel: "WEB" }, req);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(422);
    expect(calls).toBe(0);

    await expect(
      ctrl.grant(
        {
          legalDocumentId: "00000000-0000-4000-8000-000000000000",
          purpose: "GEOLOCATION",
          channel: "WEB",
        },
        req,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(calls).toBe(1);

    await expect(
      ctrl.grant({ legalDocumentId: validUuid, purpose: "GEOLOCATION", channel: "WEB" }, req),
    ).resolves.toEqual({ id: "consent-1", legalDocumentId: validUuid });
    expect(calls).toBe(2);
  });
});
