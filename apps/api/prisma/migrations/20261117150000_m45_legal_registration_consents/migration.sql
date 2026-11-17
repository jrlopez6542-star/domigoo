-- M45: Propósitos de consentimiento para registro (TERMS_ACCEPTANCE, MARKETING) y versiones iniciales 0.1-borrador de documentos legales.

ALTER TYPE "ConsentPurpose" ADD VALUE IF NOT EXISTS 'TERMS_ACCEPTANCE';
ALTER TYPE "ConsentPurpose" ADD VALUE IF NOT EXISTS 'MARKETING';

INSERT INTO legal_documents (id, kind, version, "contentHash", "publishedAt")
VALUES
  (
    gen_random_uuid(),
    'TERMS'::"LegalDocumentKind",
    '0.1-borrador',
    'fdb4df73fe68e0fb046efb0780f820fc259736bfaa63eb8287139eba27db33ae',
    now()
  ),
  (
    gen_random_uuid(),
    'PRIVACY_NOTICE'::"LegalDocumentKind",
    '0.1-borrador',
    '1fbf6783816887d20674fdd01fd70c70ce58bc4ee20d9e21a7b923e611bc6061',
    now()
  ),
  (
    gen_random_uuid(),
    'DOCUMENT_PROCESSING'::"LegalDocumentKind",
    '0.1-borrador',
    '634f193272c15d53a869db7ee8c462da4b70f3f7fb43695f5355202f203f2892',
    now()
  ),
  (
    gen_random_uuid(),
    'GEOLOCATION_CONSENT'::"LegalDocumentKind",
    '0.1-borrador',
    '476c963e342e36633923f5c68c54ddda7d202982e7c5d7d9ae53720418be3255',
    now()
  )
ON CONFLICT (kind, version) DO NOTHING;
