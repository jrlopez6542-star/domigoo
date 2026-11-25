-- D19 parte 2 (ORDEN 024): copia inmutable del texto en legal_documents e inmutabilidad en BD
-- de legal_documents y consent_records (mismo patrón que audit_logs_immutable).

ALTER TABLE "legal_documents"
  ADD COLUMN IF NOT EXISTS "content" TEXT;

CREATE OR REPLACE FUNCTION legal_documents_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legal_documents es inmutable: no se permite % sobre versiones publicadas', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS legal_documents_no_mutate ON legal_documents;
CREATE TRIGGER legal_documents_no_mutate
  BEFORE UPDATE OR DELETE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION legal_documents_immutable();

CREATE OR REPLACE FUNCTION consent_records_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consent_records es inmutable: no se permite DELETE';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."revokedAt" IS NULL
       AND NEW."revokedAt" IS NOT NULL
       AND NEW."id" IS NOT DISTINCT FROM OLD."id"
       AND NEW."userId" IS NOT DISTINCT FROM OLD."userId"
       AND NEW."legalDocumentId" IS NOT DISTINCT FROM OLD."legalDocumentId"
       AND NEW."purpose" IS NOT DISTINCT FROM OLD."purpose"
       AND NEW."channel" IS NOT DISTINCT FROM OLD."channel"
       AND NEW."grantedAt" IS NOT DISTINCT FROM OLD."grantedAt"
       AND NEW."ip" IS NOT DISTINCT FROM OLD."ip"
       AND NEW."userAgent" IS NOT DISTINCT FROM OLD."userAgent"
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'consent_records es inmutable: solo se permite fijar revokedAt una vez desde NULL';
  END IF;

  RAISE EXCEPTION 'consent_records es inmutable: operación no permitida (%)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS consent_records_no_mutate ON consent_records;
CREATE TRIGGER consent_records_no_mutate
  BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION consent_records_immutable();
