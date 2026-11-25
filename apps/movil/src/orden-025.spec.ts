import fs from "node:fs";
import path from "node:path";
import {
  buildCourierRegistrationDocuments,
  CourierApiClient,
  CourierApiError,
  MOBILE_GEO_ALREADY_REVOKED_MESSAGE,
  MOBILE_GEO_CONSENT_OUTDATED_MESSAGE,
  MOBILE_GEO_CONSENT_UNAVAILABLE_MESSAGE,
  MOBILE_REGISTRATION_OUTDATED_MESSAGE,
  OutdatedLegalDocumentsError,
} from "./api/client.js";

const TERMS_V1 = "11111111-1111-4111-8111-111111111111";
const TERMS_V2 = "22222222-2222-4222-8222-222222222222";
const PRIV_V2 = "33333333-3333-4333-8333-333333333333";
const DOC_PROC_V1 = "44444444-4444-4444-8444-444444444444";
const GEO_V1 = "55555555-5555-4555-8555-555555555555";
const GEO_V2 = "66666666-6666-4666-8666-666666666666";

const FORBIDDEN_OUTPUT =
  /\b(Not Found|Error 4|currentLegalDocumentId|TERMS|PRIVACY_NOTICE|DOCUMENT_PROCESSING|GEOLOCATION_CONSENT)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("ORDEN 025 - D19 parte 3 Móvil: consents.documents, 422 desactualizada y 404 amables", () => {
  it("1) registerCourier envía consents.documents obtenidos de current", async () => {
    const calls: Array<{ input: string; method: string | undefined; body: string | undefined }> =
      [];
    const client = new CourierApiClient("http://127.0.0.1:3001", (input, init) => {
      calls.push({ input, method: init?.method, body: init?.body });
      if (input.endsWith("/v1/legal-documents/current")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              documents: [
                { id: TERMS_V2, kind: "TERMS", version: "2026-02" },
                { id: PRIV_V2, kind: "PRIVACY_NOTICE", version: "2026-02" },
                { id: DOC_PROC_V1, kind: "DOCUMENT_PROCESSING", version: "0.1-borrador" },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ token: "tok-domi-025" }),
      });
    });

    const currentDocs = await client.getCurrentLegalDocuments();
    const documents = buildCourierRegistrationDocuments(currentDocs);
    expect(documents).toEqual({
      TERMS: TERMS_V2,
      PRIVACY_NOTICE: PRIV_V2,
      DOCUMENT_PROCESSING: DOC_PROC_V1,
    });

    await client.registerCourier({
      identifier: "+573001112233",
      password: "ClaveSegura2026",
      consents: {
        termsAccepted: true,
        privacyAccepted: true,
        sensitiveDataAccepted: true,
        ...(documents !== null ? { documents } : {}),
      },
    });

    expect(calls[1]?.input).toBe("http://127.0.0.1:3001/v1/auth/register");
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      phoneE164: "+573001112233",
      password: "ClaveSegura2026",
      client: "MOBILE",
      role: "COURIER",
      consents: {
        termsAccepted: true,
        privacyAccepted: true,
        sensitiveDataAccepted: true,
        documents: {
          TERMS: TERMS_V2,
          PRIVACY_NOTICE: PRIV_V2,
          DOCUMENT_PROCESSING: DOC_PROC_V1,
        },
      },
    });
  });

  it("2) registerCourier en 422 desactualizada refetchea current y expone los vigentes nuevos con mensaje amable", async () => {
    const fetchedPaths: string[] = [];
    const client = new CourierApiClient("http://127.0.0.1:3001", (input) => {
      fetchedPaths.push(input);
      if (input.endsWith("/v1/auth/register")) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              message: "La versión de los documentos legales está desactualizada",
              currentDocuments: [
                { kind: "TERMS", id: TERMS_V2, version: "2026-02" },
                { kind: "PRIVACY_NOTICE", id: PRIV_V2, version: "2026-02" },
                { kind: "DOCUMENT_PROCESSING", id: DOC_PROC_V1, version: "0.1-borrador" },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            documents: [
              { id: TERMS_V2, kind: "TERMS", version: "2026-02" },
              { id: PRIV_V2, kind: "PRIVACY_NOTICE", version: "2026-02" },
              { id: DOC_PROC_V1, kind: "DOCUMENT_PROCESSING", version: "0.1-borrador" },
            ],
          }),
      });
    });

    let caught: unknown = null;
    try {
      await client.registerCourier({
        identifier: "+573001112233",
        password: "ClaveSegura2026",
        consents: {
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: true,
          documents: {
            TERMS: TERMS_V1,
            PRIVACY_NOTICE: PRIV_V2,
            DOCUMENT_PROCESSING: DOC_PROC_V1,
          },
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(OutdatedLegalDocumentsError);
    const outdated = caught as OutdatedLegalDocumentsError;
    expect(outdated.message).toBe(MOBILE_REGISTRATION_OUTDATED_MESSAGE);
    expect(outdated.message).not.toMatch(FORBIDDEN_OUTPUT);
    expect(outdated.currentDocuments).toEqual([
      { id: TERMS_V2, kind: "TERMS", version: "2026-02" },
      { id: PRIV_V2, kind: "PRIVACY_NOTICE", version: "2026-02" },
      { id: DOC_PROC_V1, kind: "DOCUMENT_PROCESSING", version: "0.1-borrador" },
    ]);
    expect(fetchedPaths).toEqual([
      "http://127.0.0.1:3001/v1/auth/register",
      "http://127.0.0.1:3001/v1/legal-documents/current",
    ]);
  });

  it("3) grantGeolocationConsent maneja 422 desactualizada sin reenviar en silencio, 404/422 amable, 401 sesión y 404 revocar", async () => {
    const outdatedCalls: string[] = [];
    const outdatedClient = new CourierApiClient("http://127.0.0.1:3001", (input) => {
      outdatedCalls.push(input);
      if (input.endsWith("/v1/consents")) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              message: "La versión del documento está desactualizada",
              currentLegalDocumentId: GEO_V2,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            documents: [{ id: GEO_V2, kind: "GEOLOCATION_CONSENT", version: "2026-03" }],
          }),
      });
    });

    let caughtOutdated: unknown = null;
    try {
      await outdatedClient.grantGeolocationConsent(GEO_V1);
    } catch (err) {
      caughtOutdated = err;
    }
    expect(caughtOutdated).toBeInstanceOf(OutdatedLegalDocumentsError);
    expect((caughtOutdated as OutdatedLegalDocumentsError).message).toBe(
      MOBILE_GEO_CONSENT_OUTDATED_MESSAGE,
    );
    expect((caughtOutdated as OutdatedLegalDocumentsError).message).not.toMatch(FORBIDDEN_OUTPUT);
    expect((caughtOutdated as OutdatedLegalDocumentsError).currentDocuments).toEqual([
      { id: GEO_V2, kind: "GEOLOCATION_CONSENT", version: "2026-03" },
    ]);
    // Nunca reenvía POST /v1/consents en silencio
    expect(outdatedCalls.filter((url) => url.endsWith("/v1/consents"))).toHaveLength(1);

    // 404 -> texto amable
    const notFoundClient = new CourierApiClient("http://127.0.0.1:3001", () =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ statusCode: 404, message: "Not Found" }),
      }),
    );
    await expect(notFoundClient.grantGeolocationConsent(GEO_V1)).rejects.toThrow(
      MOBILE_GEO_CONSENT_UNAVAILABLE_MESSAGE,
    );

    // 422 de tipo incorrecto -> texto amable
    const wrongKindClient = new CourierApiClient("http://127.0.0.1:3001", () =>
      Promise.resolve({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            message: "El documento no corresponde al propósito del consentimiento",
          }),
      }),
    );
    await expect(wrongKindClient.grantGeolocationConsent(TERMS_V2)).rejects.toThrow(
      MOBILE_GEO_CONSENT_UNAVAILABLE_MESSAGE,
    );

    // 401 -> mensaje de sesión amable
    const unauthClient = new CourierApiClient("http://127.0.0.1:3001", () =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ statusCode: 401, message: "Unauthorized" }),
      }),
    );
    let caughtUnauth: unknown = null;
    try {
      await unauthClient.grantGeolocationConsent(GEO_V2);
    } catch (err) {
      caughtUnauth = err;
    }
    expect(caughtUnauth).toBeInstanceOf(CourierApiError);
    expect((caughtUnauth as CourierApiError).status).toBe(401);
    expect((caughtUnauth as CourierApiError).message).not.toMatch(FORBIDDEN_OUTPUT);
    expect((caughtUnauth as CourierApiError).message).not.toContain("Unauthorized");

    // 404 al revocar -> texto amable exacto
    await expect(notFoundClient.revokeGeolocationConsent("con-1")).rejects.toThrow(
      MOBILE_GEO_ALREADY_REVOKED_MESSAGE,
    );
  });

  it("4) App.tsx muestra versión vigente de geolocalización, desmarca en desactualizada y maneja 404 de revocación", () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(appSource).toContain("Consentimiento de geolocalización — Versión vigente:");
    expect(appSource).toContain("OutdatedLegalDocumentsError");
    expect(appSource).toContain("setGeoConsentBox(false)");
    expect(appSource).toContain("MOBILE_GEO_ALREADY_REVOKED_MESSAGE");
  });
});
