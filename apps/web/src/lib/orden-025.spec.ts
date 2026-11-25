import fs from "node:fs";
import path from "node:path";
import { ProxyError } from "./api-client.js";
import { buildLoginPayload } from "./contracts.js";
import {
  buildRegisterPayload,
  buildRegistrationDocumentsForRole,
  GEO_CONSENT_ALREADY_REVOKED_MESSAGE,
  GEO_CONSENT_OUTDATED_MESSAGE,
  GEO_CONSENT_UNAVAILABLE_MESSAGE,
  LEGAL_DOCUMENT_LABELS,
  REGISTRATION_DOCS_LOAD_ERROR,
  REGISTRATION_OUTDATED_MESSAGE,
  resolveGeolocationConsentError,
  resolveRegistrationError,
  resolveRevokeGeolocationError,
  sanitizeUserFacingMessage,
  type CurrentLegalDocument,
} from "./legal-consents.js";

const TERMS_ID = "11111111-1111-4111-8111-111111111111";
const PRIVACY_ID = "22222222-2222-4222-8222-222222222222";
const SENSITIVE_ID = "33333333-3333-4333-8333-333333333333";
const GEO_ID = "44444444-4444-4444-8444-444444444444";

const SAMPLE_DOCS: CurrentLegalDocument[] = [
  { id: TERMS_ID, kind: "TERMS", version: "2026-02" },
  { id: PRIVACY_ID, kind: "PRIVACY_NOTICE", version: "2026-02" },
  { id: SENSITIVE_ID, kind: "DOCUMENT_PROCESSING", version: "0.1-borrador" },
  { id: GEO_ID, kind: "GEOLOCATION_CONSENT", version: "2026-02" },
];

const FORBIDDEN_OUTPUT =
  /\b(Not Found|Error 4|currentLegalDocumentId|TERMS|PRIVACY_NOTICE|DOCUMENT_PROCESSING|GEOLOCATION_CONSENT)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("ORDEN 025 - D19 parte 3 Web: versiones vigentes por rol, 422/404 amables y sin términos técnicos", () => {
  it("1) Construye consents.documents solo con los tipos requeridos por cada rol", () => {
    const customerDocs = buildRegistrationDocumentsForRole("CUSTOMER", SAMPLE_DOCS);
    expect(customerDocs).toEqual({
      ok: true,
      documents: { TERMS: TERMS_ID, PRIVACY_NOTICE: PRIVACY_ID },
    });

    const restaurantDocs = buildRegistrationDocumentsForRole("RESTAURANT", SAMPLE_DOCS);
    expect(restaurantDocs).toEqual({
      ok: true,
      documents: { TERMS: TERMS_ID, PRIVACY_NOTICE: PRIVACY_ID },
    });

    const courierDocs = buildRegistrationDocumentsForRole("COURIER", SAMPLE_DOCS);
    expect(courierDocs).toEqual({
      ok: true,
      documents: {
        TERMS: TERMS_ID,
        PRIVACY_NOTICE: PRIVACY_ID,
        DOCUMENT_PROCESSING: SENSITIVE_ID,
      },
    });

    const credentials = buildLoginPayload("persona@ejemplo.com", "ClaveSegura2026", "WEB");
    if (!customerDocs.ok || !courierDocs.ok) {
      throw new Error("Documentos válidos esperados");
    }

    const customerPayload = buildRegisterPayload({
      credentials,
      role: "CUSTOMER",
      termsAccepted: true,
      privacyAccepted: true,
      sensitiveDataAccepted: false,
      marketingAccepted: false,
      documents: {
        ...customerDocs.documents,
        DOCUMENT_PROCESSING: SENSITIVE_ID,
      },
    });
    expect(customerPayload.consents.documents).toEqual({
      TERMS: TERMS_ID,
      PRIVACY_NOTICE: PRIVACY_ID,
    });
    expect("sensitiveDataAccepted" in customerPayload.consents).toBe(false);

    const courierPayload = buildRegisterPayload({
      credentials,
      role: "COURIER",
      termsAccepted: true,
      privacyAccepted: true,
      sensitiveDataAccepted: true,
      marketingAccepted: true,
      documents: courierDocs.documents,
    });
    expect(courierPayload.consents).toEqual({
      termsAccepted: true,
      privacyAccepted: true,
      sensitiveDataAccepted: true,
      marketingAccepted: true,
      documents: {
        TERMS: TERMS_ID,
        PRIVACY_NOTICE: PRIVACY_ID,
        DOCUMENT_PROCESSING: SENSITIVE_ID,
      },
    });

    // Faltan documentos para COURIER si no viene DOCUMENT_PROCESSING
    const missingForCourier = buildRegistrationDocumentsForRole("COURIER", [
      { id: TERMS_ID, kind: "TERMS", version: "2026-02" },
      { id: PRIVACY_ID, kind: "PRIVACY_NOTICE", version: "2026-02" },
    ]);
    expect(missingForCourier).toEqual({ ok: false, missingKinds: ["DOCUMENT_PROCESSING"] });
  });

  it("2) Registro ante 422 desactualizada indica refetch + desmarcar casillas + texto exacto, y otros 422 muestran el mensaje en español", () => {
    const outdated = resolveRegistrationError(
      new ProxyError("La versión de los documentos legales está desactualizada", 422, undefined, {
        message: "La versión de los documentos legales está desactualizada",
        currentDocuments: [{ kind: "TERMS", id: TERMS_ID, version: "2026-03" }],
      }),
    );
    expect(outdated).toEqual({
      kind: "outdated",
      shouldRefetchCurrent: true,
      shouldUncheckConsents: true,
      message: REGISTRATION_OUTDATED_MESSAGE,
    });
    expect(outdated.message).toBe(
      "Los documentos legales se actualizaron. Revisa la versión vigente y vuelve a aceptarlos.",
    );

    const other422 = resolveRegistrationError(
      new ProxyError("Debes aceptar los Términos y Condiciones", 422),
    );
    expect(other422).toEqual({
      kind: "validation",
      shouldRefetchCurrent: false,
      shouldUncheckConsents: false,
      message: "Debes aceptar los Términos y Condiciones",
    });
  });

  it("3) Geolocalización maneja 422 desactualizada (refetch + desmarcar), 404/422 amable, 401 sesión y 404 revocar", () => {
    const outdatedGeo = resolveGeolocationConsentError(
      new ProxyError("La versión del documento está desactualizada", 422, undefined, {
        message: "La versión del documento está desactualizada",
        currentLegalDocumentId: GEO_ID,
      }),
    );
    expect(outdatedGeo).toEqual({
      kind: "outdated",
      shouldRefetchCurrent: true,
      shouldUncheckConsent: true,
      message: GEO_CONSENT_OUTDATED_MESSAGE,
    });

    const notFoundGeo = resolveGeolocationConsentError(new ProxyError("Not Found", 404));
    expect(notFoundGeo).toEqual({
      kind: "unavailable",
      shouldRefetchCurrent: false,
      shouldUncheckConsent: false,
      message: GEO_CONSENT_UNAVAILABLE_MESSAGE,
    });
    expect(notFoundGeo.message).toBe(
      "El documento de autorización ya no está disponible. Recarga e inténtalo de nuevo.",
    );

    const wrongKindGeo = resolveGeolocationConsentError(
      new ProxyError("El documento no corresponde al propósito del consentimiento", 422),
    );
    expect(wrongKindGeo.message).toBe(GEO_CONSENT_UNAVAILABLE_MESSAGE);

    const unauthorizedGeo = resolveGeolocationConsentError(new ProxyError("Unauthorized", 401));
    expect(unauthorizedGeo.kind).toBe("unauthorized");
    expect(unauthorizedGeo.message).not.toMatch(/Unauthorized|Error 4/i);

    const revoke404 = resolveRevokeGeolocationError(new ProxyError("Not Found", 404));
    expect(revoke404).toEqual({
      alreadyRevoked: true,
      message: GEO_CONSENT_ALREADY_REVOKED_MESSAGE,
    });
    expect(revoke404.message).toBe("Esta autorización ya estaba revocada.");
  });

  it("4) Ningún texto mostrado al usuario contiene UUID, Not Found, Error 4, currentLegalDocumentId ni nombres de enum", () => {
    const messages = [
      REGISTRATION_OUTDATED_MESSAGE,
      REGISTRATION_DOCS_LOAD_ERROR,
      GEO_CONSENT_OUTDATED_MESSAGE,
      GEO_CONSENT_UNAVAILABLE_MESSAGE,
      GEO_CONSENT_ALREADY_REVOKED_MESSAGE,
      ...Object.values(LEGAL_DOCUMENT_LABELS),
      sanitizeUserFacingMessage(`Error 404 Not Found ${TERMS_ID}`, REGISTRATION_DOCS_LOAD_ERROR),
      sanitizeUserFacingMessage(
        `currentLegalDocumentId GEOLOCATION_CONSENT`,
        GEO_CONSENT_UNAVAILABLE_MESSAGE,
      ),
      resolveRegistrationError(new ProxyError("Not Found", 404)).message,
      resolveGeolocationConsentError(new ProxyError("Error 404", 404)).message,
      resolveRevokeGeolocationError(new ProxyError("Not Found", 404)).message,
    ];

    for (const msg of messages) {
      expect(msg).not.toMatch(FORBIDDEN_OUTPUT);
    }
  });

  it("5) role-auth-card.tsx y restaurant-portal.tsx integran versiones vigentes, Reintentar y desmarcado en 422 desactualizada", () => {
    const authCard = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/role-auth-card.tsx"),
      "utf8",
    );
    expect(authCard).toContain('"legal-documents/current"');
    expect(authCard).toContain("Versión vigente:");
    expect(authCard).toContain('data-testid="legal-version-terms"');
    expect(authCard).toContain('data-testid="legal-version-privacy"');
    expect(authCard).toContain('data-testid="legal-version-sensitive"');
    expect(authCard).toContain('data-testid="retry-legal-docs"');
    expect(authCard).toContain("Reintentar");
    expect(authCard).toContain("buildRegisterPayload");
    expect(authCard).toContain("resolved.shouldUncheckConsents");
    expect(authCard).toContain("resolved.shouldRefetchCurrent");

    const restaurantPortal = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/restaurant-portal.tsx"),
      "utf8",
    );
    expect(restaurantPortal).toContain('data-testid="geo-consent-version"');
    expect(restaurantPortal).toContain("Consentimiento de geolocalización — Versión vigente:");
    expect(restaurantPortal).toContain("resolveGeolocationConsentError");
    expect(restaurantPortal).toContain("resolveRevokeGeolocationError");
  });
});
