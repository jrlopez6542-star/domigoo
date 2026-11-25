DROP TRIGGER IF EXISTS consent_records_no_mutate ON consent_records;
DROP FUNCTION IF EXISTS consent_records_immutable();

DROP TRIGGER IF EXISTS legal_documents_no_mutate ON legal_documents;
DROP FUNCTION IF EXISTS legal_documents_immutable();

ALTER TABLE "legal_documents"
  DROP COLUMN IF EXISTS "content";
