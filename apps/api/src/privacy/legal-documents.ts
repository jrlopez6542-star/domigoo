export type LegalDocumentKind =
  "PRIVACY_NOTICE" | "TERMS" | "GEOLOCATION_CONSENT" | "DOCUMENT_PROCESSING";

export type MappedConsentPurpose =
  "TERMS_ACCEPTANCE" | "ACCOUNT" | "MARKETING" | "DOCUMENT_STORAGE" | "GEOLOCATION";

/**
 * Mapa único propósito -> tipo de documento legal (D19 parte 1).
 * ORDER_CONTACT no tiene tipo de documento asignado y queda fuera del mapa.
 */
export const PURPOSE_TO_LEGAL_DOCUMENT_KIND: Readonly<
  Record<MappedConsentPurpose, LegalDocumentKind>
> = {
  TERMS_ACCEPTANCE: "TERMS",
  ACCOUNT: "PRIVACY_NOTICE",
  MARKETING: "PRIVACY_NOTICE",
  DOCUMENT_STORAGE: "DOCUMENT_PROCESSING",
  GEOLOCATION: "GEOLOCATION_CONSENT",
};

export function expectedLegalDocumentKindForPurpose(purpose: string): LegalDocumentKind | null {
  if (Object.prototype.hasOwnProperty.call(PURPOSE_TO_LEGAL_DOCUMENT_KIND, purpose)) {
    return PURPOSE_TO_LEGAL_DOCUMENT_KIND[purpose as MappedConsentPurpose];
  }
  return null;
}

/**
 * Regla única de vigencia en SQL: documento más reciente por "publishedAt" DESC,
 * desempatado determinísticamente por id DESC.
 */
export const CURRENT_LEGAL_DOCUMENT_ORDER_BY = `"publishedAt" DESC, id DESC`;

export const SELECT_ALL_CURRENT_LEGAL_DOCUMENTS_SQL = `SELECT DISTINCT ON (kind) id, kind::text AS kind, version, "contentHash"
FROM legal_documents
ORDER BY kind, ${CURRENT_LEGAL_DOCUMENT_ORDER_BY}`;

export const SELECT_CURRENT_LEGAL_DOCUMENT_BY_KIND_SQL = `SELECT id, kind::text AS kind, version, "contentHash"
FROM legal_documents
WHERE kind = $1::"LegalDocumentKind"
ORDER BY ${CURRENT_LEGAL_DOCUMENT_ORDER_BY}
LIMIT 1`;
