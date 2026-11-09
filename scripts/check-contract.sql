DO $$
DECLARE
  table_count integer;
  gist_count integer;
  accepted_unique boolean;
  dentro boolean;
  metros double precision;
BEGIN
  SELECT count(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name <> 'spatial_ref_sys'
    AND table_name <> '_prisma_migrations';
  IF table_count <> 42 THEN
    RAISE EXCEPTION 'Se esperaban 42 tablas y hay %', table_count;
  END IF;

  SELECT count(*) INTO gist_count
  FROM pg_class index_rel
  JOIN pg_am access_method ON access_method.oid = index_rel.relam
  WHERE index_rel.relname IN (
    'branches_location_gist',
    'courier_availability_location_gist',
    'location_pings_location_gist',
    'tariff_zones_area_gist',
    'orders_pickup_location_gist',
    'orders_dropoff_location_gist'
  )
    AND access_method.amname = 'gist';
  IF gist_count <> 6 THEN
    RAISE EXCEPTION 'Se esperaban 6 índices GiST y hay %', gist_count;
  END IF;

  SELECT index_def.indisunique INTO accepted_unique
  FROM pg_class index_rel
  JOIN pg_index index_def ON index_def.indexrelid = index_rel.oid
  WHERE index_rel.relname = 'dispatch_offers_one_accepted';
  IF accepted_unique IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Falta el índice único de una oferta aceptada';
  END IF;

  INSERT INTO restaurants (
    id, "legalName", "tradeName", nit, email, "phoneE164", "createdAt", "updatedAt"
  )
  VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Prueba geo',
    'Prueba geo',
    '900000001',
    'geo@example.invalid',
    '+570000000000',
    now(),
    now()
  );
  INSERT INTO establishments (id, "restaurantId", name, "createdAt", "updatedAt")
  VALUES (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'Prueba',
    now(),
    now()
  );
  INSERT INTO branches (id, "establishmentId", name, "addressLine", location, "createdAt", "updatedAt")
  VALUES
    (
      '33333333-3333-3333-3333-333333333333',
      '22222222-2222-2222-2222-222222222222',
      'punto-a',
      'sintetica',
      ST_GeogFromText('SRID=4326;POINT(-73.9132 4.9655)'),
      now(),
      now()
    ),
    (
      '44444444-4444-4444-4444-444444444444',
      '22222222-2222-2222-2222-222222222222',
      'punto-b',
      'sintetica',
      ST_GeogFromText('SRID=4326;POINT(-73.9200 4.9700)'),
      now(),
      now()
    );

  SELECT ST_DWithin(a.location, b.location, 2000), ST_Distance(a.location, b.location)
  INTO dentro, metros
  FROM branches a
  JOIN branches b ON a.name = 'punto-a' AND b.name = 'punto-b';
  IF NOT dentro OR metros < 500 OR metros > 2000 THEN
    RAISE EXCEPTION 'ST_DWithin de 2 km no está en metros (dentro=%, metros=%)', dentro, metros;
  END IF;
  RAISE NOTICE 'ST_DWithin 2000 m = %, distancia = % m', dentro, metros;

  INSERT INTO audit_logs (id, "actorKind", action, "entityType", "entityId")
  VALUES (gen_random_uuid(), 'SYSTEM', 'probe', 'probe', gen_random_uuid());
  BEGIN
    UPDATE audit_logs SET action = 'changed';
    RAISE EXCEPTION 'UPDATE de audit_logs no fue rechazado';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%append-only%' THEN
        RAISE;
      END IF;
  END;
  RAISE NOTICE 'UPDATE de audit_logs rechazado';
END $$;
