import { ProxyError } from "./api-client";
import type { LoginPayload } from "./contracts";
import type { AccountRole } from "./role-session";

export type CurrentLegalDocument = {
  id: string;
  kind: string;
  version: string;
  contentHash?: string;
};

export type RegistrationDocumentKind = "TERMS" | "PRIVACY_NOTICE" | "DOCUMENT_PROCESSING";

export type RegistrationDocumentsMap = Partial<Record<RegistrationDocumentKind, string>>;

export const LEGAL_DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  TERMS: "Términos y Condiciones",
  PRIVACY_NOTICE: "Autorización de Tratamiento de Datos Personales",
  DOCUMENT_PROCESSING: "Tratamiento de datos sensibles",
  GEOLOCATION_CONSENT: "Consentimiento de geolocalización",
};

export const REGISTRATION_OUTDATED_MESSAGE =
  "Los documentos legales se actualizaron. Revisa la versión vigente y vuelve a aceptarlos.";

export const REGISTRATION_DOCS_LOAD_ERROR =
  "No pudimos cargar las versiones vigentes de los documentos legales. Intenta de nuevo.";

export const GEO_CONSENT_OUTDATED_MESSAGE =
  "El Consentimiento de geolocalización se actualizó. Revisa la versión vigente y vuelve a confirmarlo.";

export const GEO_CONSENT_UNAVAILABLE_MESSAGE =
  "El documento de autorización ya no está disponible. Recarga e inténtalo de nuevo.";

export const GEO_CONSENT_ALREADY_REVOKED_MESSAGE = "Esta autorización ya estaba revocada.";

export const SESSION_EXPIRED_MESSAGE = "Tu sesión no es válida o expiró. Inicia sesión nuevamente.";

const FORBIDDEN_TECHNICAL_PATTERN =
  /\b(Not Found|Unauthorized|Forbidden|Bad Request|Internal Server Error|Error\s+[45]\d{2}|currentLegalDocumentId|TERMS|PRIVACY_NOTICE|DOCUMENT_PROCESSING|GEOLOCATION_CONSENT|TERMS_ACCEPTANCE|DOCUMENT_STORAGE|ORDER_CONTACT)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function sanitizeUserFacingMessage(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed || FORBIDDEN_TECHNICAL_PATTERN.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function requiredRegistrationKindsForRole(role: AccountRole): RegistrationDocumentKind[] {
  return role === "COURIER"
    ? ["TERMS", "PRIVACY_NOTICE", "DOCUMENT_PROCESSING"]
    : ["TERMS", "PRIVACY_NOTICE"];
}

export function findCurrentDocumentByKind(
  documents: ReadonlyArray<CurrentLegalDocument> | undefined,
  kind: string,
): CurrentLegalDocument | null {
  if (!documents) {
    return null;
  }
  const found = documents.find(
    (doc) => doc.kind === kind && Boolean(doc.id) && Boolean(doc.version),
  );
  return found ?? null;
}

export function buildRegistrationDocumentsForRole(
  role: AccountRole,
  documents: ReadonlyArray<CurrentLegalDocument> | undefined,
):
  | { ok: true; documents: RegistrationDocumentsMap }
  | { ok: false; missingKinds: RegistrationDocumentKind[] } {
  const required = requiredRegistrationKindsForRole(role);
  const result: RegistrationDocumentsMap = {};
  const missingKinds: RegistrationDocumentKind[] = [];

  for (const kind of required) {
    const doc = findCurrentDocumentByKind(documents, kind);
    if (doc === null) {
      missingKinds.push(kind);
    } else {
      result[kind] = doc.id;
    }
  }

  if (missingKinds.length > 0) {
    return { ok: false, missingKinds };
  }
  return { ok: true, documents: result };
}

export function buildRegisterPayload(input: {
  credentials: LoginPayload;
  role: AccountRole;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  sensitiveDataAccepted: boolean;
  marketingAccepted: boolean;
  documents: RegistrationDocumentsMap;
}): LoginPayload & {
  role: AccountRole;
  consents: {
    termsAccepted: boolean;
    privacyAccepted: boolean;
    sensitiveDataAccepted?: boolean;
    marketingAccepted: boolean;
    documents: RegistrationDocumentsMap;
  };
} {
  const scopedDocuments: RegistrationDocumentsMap = {
    ...(input.documents.TERMS !== undefined ? { TERMS: input.documents.TERMS } : {}),
    ...(input.documents.PRIVACY_NOTICE !== undefined
      ? { PRIVACY_NOTICE: input.documents.PRIVACY_NOTICE }
      : {}),
    ...(input.role === "COURIER" && input.documents.DOCUMENT_PROCESSING !== undefined
      ? { DOCUMENT_PROCESSING: input.documents.DOCUMENT_PROCESSING }
      : {}),
  };

  return {
    ...input.credentials,
    role: input.role,
    consents: {
      termsAccepted: input.termsAccepted,
      privacyAccepted: input.privacyAccepted,
      ...(input.role === "COURIER" ? { sensitiveDataAccepted: input.sensitiveDataAccepted } : {}),
      marketingAccepted: input.marketingAccepted,
      documents: scopedDocuments,
    },
  };
}

export function isOutdatedLegalError(err: unknown): boolean {
  if (!(err instanceof ProxyError) || err.status !== 422) {
    return false;
  }
  if (typeof err.body === "object" && err.body !== null) {
    const body = err.body as Record<string, unknown>;
    if (
      Array.isArray(body["currentDocuments"]) ||
      typeof body["currentLegalDocumentId"] === "string"
    ) {
      return true;
    }
  }
  return err.message.toLowerCase().includes("desactualizada");
}

export function extractCurrentDocumentsFromError(err: unknown): CurrentLegalDocument[] {
  if (!(err instanceof ProxyError) || typeof err.body !== "object" || err.body === null) {
    return [];
  }
  const raw = (err.body as Record<string, unknown>)["currentDocuments"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const docs: CurrentLegalDocument[] = [];
  for (const item of raw) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>)["id"] === "string" &&
      typeof (item as Record<string, unknown>)["kind"] === "string" &&
      typeof (item as Record<string, unknown>)["version"] === "string"
    ) {
      docs.push({
        id: String((item as Record<string, unknown>)["id"]),
        kind: String((item as Record<string, unknown>)["kind"]),
        version: String((item as Record<string, unknown>)["version"]),
      });
    }
  }
  return docs;
}

export type RegistrationErrorResolution = {
  kind: "outdated" | "validation" | "other";
  shouldRefetchCurrent: boolean;
  shouldUncheckConsents: boolean;
  message: string;
};

export function resolveRegistrationError(err: unknown): RegistrationErrorResolution {
  if (isOutdatedLegalError(err)) {
    return {
      kind: "outdated",
      shouldRefetchCurrent: true,
      shouldUncheckConsents: true,
      message: REGISTRATION_OUTDATED_MESSAGE,
    };
  }
  if (err instanceof ProxyError && err.status === 422) {
    return {
      kind: "validation",
      shouldRefetchCurrent: false,
      shouldUncheckConsents: false,
      message: sanitizeUserFacingMessage(
        err.message,
        "Verifica los documentos legales y los datos ingresados e inténtalo de nuevo.",
      ),
    };
  }
  return {
    kind: "other",
    shouldRefetchCurrent: false,
    shouldUncheckConsents: false,
    message: sanitizeUserFacingMessage(
      err instanceof Error ? err.message : "",
      "No fue posible autenticar. Verifica tus datos e intenta de nuevo.",
    ),
  };
}

export type GeolocationConsentErrorResolution = {
  kind: "outdated" | "unavailable" | "unauthorized" | "other";
  shouldRefetchCurrent: boolean;
  shouldUncheckConsent: boolean;
  message: string;
};

export function resolveGeolocationConsentError(err: unknown): GeolocationConsentErrorResolution {
  if (isOutdatedLegalError(err)) {
    return {
      kind: "outdated",
      shouldRefetchCurrent: true,
      shouldUncheckConsent: true,
      message: GEO_CONSENT_OUTDATED_MESSAGE,
    };
  }
  if (err instanceof ProxyError) {
    if (err.status === 401) {
      return {
        kind: "unauthorized",
        shouldRefetchCurrent: false,
        shouldUncheckConsent: false,
        message: sanitizeUserFacingMessage(err.message, SESSION_EXPIRED_MESSAGE),
      };
    }
    if (err.status === 404 || err.status === 422) {
      return {
        kind: "unavailable",
        shouldRefetchCurrent: false,
        shouldUncheckConsent: false,
        message: GEO_CONSENT_UNAVAILABLE_MESSAGE,
      };
    }
  }
  return {
    kind: "other",
    shouldRefetchCurrent: false,
    shouldUncheckConsent: false,
    message: sanitizeUserFacingMessage(
      err instanceof Error ? err.message : "",
      "No se pudo guardar el Consentimiento de geolocalización. Inténtalo de nuevo.",
    ),
  };
}

export function resolveRevokeGeolocationError(err: unknown): {
  alreadyRevoked: boolean;
  message: string;
} {
  if (err instanceof ProxyError) {
    if (err.status === 404) {
      return {
        alreadyRevoked: true,
        message: GEO_CONSENT_ALREADY_REVOKED_MESSAGE,
      };
    }
    if (err.status === 401) {
      return {
        alreadyRevoked: false,
        message: sanitizeUserFacingMessage(err.message, SESSION_EXPIRED_MESSAGE),
      };
    }
  }
  return {
    alreadyRevoked: false,
    message: sanitizeUserFacingMessage(
      err instanceof Error ? err.message : "",
      "No se pudo revocar el Consentimiento de geolocalización.",
    ),
  };
}
