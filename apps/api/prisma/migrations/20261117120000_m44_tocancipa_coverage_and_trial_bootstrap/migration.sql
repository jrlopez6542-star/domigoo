-- M44: Bootstrap de cobertura oficial de Tocancipá (DIVIPOLA 25817) y plan de prueba gratuita de 15 días.
-- Fuente geográfica: DANE Marco Geoestadístico Nacional (MGN) Nivel Municipal (MPIO_CDPMP = '25817')
-- y OpenStreetMap relation 1346513 (wikidata Q1442348). Licencia: CC BY 4.0 / ODbL 1.0.

DO $$
DECLARE
  v_tariff_id uuid;
  v_zone_id uuid;
BEGIN
  -- 1. Asegurar versión de tarifa publicada por defecto si no existe ninguna publicada
  SELECT id INTO v_tariff_id
  FROM tariff_versions
  WHERE status = 'PUBLISHED'
  ORDER BY "publishedAt" DESC NULLS LAST
  LIMIT 1;

  IF v_tariff_id IS NULL THEN
    SELECT id INTO v_tariff_id
    FROM tariff_versions
    WHERE name = 'Tarifa Base Tocancipá 25817'
    LIMIT 1;

    IF v_tariff_id IS NOT NULL THEN
      UPDATE tariff_versions
      SET status = 'PUBLISHED', "publishedAt" = now()
      WHERE id = v_tariff_id;
    ELSE
      INSERT INTO tariff_versions (id, name, status, "publishedAt", "createdAt")
      VALUES (gen_random_uuid(), 'Tarifa Base Tocancipá 25817', 'PUBLISHED', now(), now())
      RETURNING id INTO v_tariff_id;
    END IF;
  END IF;

  -- 2. Asegurar zona de cobertura oficial del municipio de Tocancipá (DIVIPOLA 25817)
  SELECT id INTO v_zone_id
  FROM tariff_zones
  WHERE "versionId" = v_tariff_id AND code = 'TOCANCIPA_25817'
  LIMIT 1;

  IF v_zone_id IS NULL THEN
    INSERT INTO tariff_zones (id, "versionId", code, name, area, priority)
    VALUES (
      gen_random_uuid(),
      v_tariff_id,
      'TOCANCIPA_25817',
      'Municipio de Tocancipá (DIVIPOLA 25817)',
      ST_GeogFromText(
        'SRID=4326;MULTIPOLYGON(((-73.956 4.978,-73.952 4.962,-73.946 4.948,-73.938 4.938,-73.922 4.932,-73.904 4.928,-73.885 4.926,-73.868 4.932,-73.856 4.944,-73.858 4.956,-73.872 4.964,-73.888 4.97,-73.896 4.978,-73.902 4.992,-73.906 5.012,-73.918 5.02,-73.934 5.014,-73.946 4.998,-73.956 4.978)))'
      ),
      100
    )
    RETURNING id INTO v_zone_id;
  END IF;

  -- 3. Asegurar regla tarifaria placeholder para la versión publicada si aún no tiene reglas
  IF NOT EXISTS (
    SELECT 1 FROM tariff_rules WHERE "versionId" = v_tariff_id
  ) THEN
    INSERT INTO tariff_rules (
      id, "versionId", "zoneId", "baseFeeCop", "perKmCop", "minimumFeeCop",
      "nightMultiplierBps", "nightStartsMinute", "nightEndsMinute"
    ) VALUES (
      gen_random_uuid(), v_tariff_id, v_zone_id, 5500, 0, 5500, 10000, 0, 0
    );
  END IF;

  -- 4. Asegurar política operativa publicada por defecto si no existe ninguna publicada
  IF NOT EXISTS (
    SELECT 1 FROM operations_policies WHERE status = 'PUBLISHED'
  ) THEN
    INSERT INTO operations_policies (
      id, name, status, "offerRadiusMeters", "directOfferTtlSeconds", "openOfferTtlSeconds",
      "seekingTtlSeconds", "maxOffersPerWave", "locationFreshnessSeconds", "publishedAt", "createdAt"
    ) VALUES (
      gen_random_uuid(), 'Política Operativa Tocancipá 25817', 'PUBLISHED',
      5000, 120, 120, 600, 5, 120, now(), now()
    );
  END IF;

  -- 5. Asegurar plan de prueba gratuita de 15 días (priceCop=0, trialDays=15) y plan base placeholder
  INSERT INTO subscription_plans (
    id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", active, "createdAt"
  ) VALUES (
    gen_random_uuid(), 'TRIAL_15D', 'Prueba gratuita 15 días', 0, 30, 15, 5, 20, true, now()
  )
  ON CONFLICT (code) DO UPDATE
    SET "priceCop" = 0,
        "trialDays" = 15,
        active = true;

  INSERT INTO subscription_plans (
    id, code, name, "priceCop", "periodDays", "trialDays", "maxBranches", "maxConcurrentOrders", active, "createdAt"
  ) VALUES (
    gen_random_uuid(), 'PLAN_BASE_PLACEHOLDER', 'Plan Base Tocancipá (Placeholder)', 0, 30, 15, 5, 20, true, now()
  )
  ON CONFLICT (code) DO NOTHING;
END $$;

-- 6. Trigger para permitir reemplazar limpiamente la suscripción automática TRIAL_15D cuando se asigna un plan explícito
CREATE OR REPLACE FUNCTION replace_auto_trial_subscription()
RETURNS trigger AS $$
DECLARE
  auto_sub_id uuid;
BEGIN
  IF NEW."isCurrent" = true THEN
    SELECT s.id INTO auto_sub_id
    FROM restaurant_subscriptions s
    JOIN subscription_plans p ON p.id = s."planId"
    WHERE s."restaurantId" = NEW."restaurantId"
      AND s."isCurrent" = true
      AND p.code = 'TRIAL_15D'
      AND s."planId" <> NEW."planId"
      AND NOT EXISTS (
        SELECT 1 FROM subscription_payment_declarations d WHERE d."subscriptionId" = s.id
      )
    LIMIT 1;

    IF auto_sub_id IS NOT NULL THEN
      DELETE FROM subscription_events WHERE "subscriptionId" = auto_sub_id;
      DELETE FROM restaurant_subscriptions WHERE id = auto_sub_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS restaurant_subscriptions_replace_auto_trial ON restaurant_subscriptions;
CREATE TRIGGER restaurant_subscriptions_replace_auto_trial
  BEFORE INSERT ON restaurant_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION replace_auto_trial_subscription();
