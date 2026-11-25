DO $$
DECLARE
  has_trigger boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'legal_documents'::regclass
      AND t.tgname = 'legal_documents_no_mutate'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) INTO has_trigger;

  IF has_trigger THEN
    EXECUTE 'ALTER TABLE legal_documents DISABLE TRIGGER legal_documents_no_mutate';
  END IF;

  BEGIN
    DELETE FROM legal_documents WHERE version = '0.1-borrador';
  EXCEPTION WHEN OTHERS THEN
    IF has_trigger THEN
      EXECUTE 'ALTER TABLE legal_documents ENABLE TRIGGER legal_documents_no_mutate';
    END IF;
    RAISE;
  END;

  IF has_trigger THEN
    EXECUTE 'ALTER TABLE legal_documents ENABLE TRIGGER legal_documents_no_mutate';
  END IF;
END;
$$;
