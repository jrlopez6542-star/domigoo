-- M44: Bootstrap de cobertura oficial de Tocancipá (DIVIPOLA 25817) y plan de prueba gratuita de 15 días.
-- Fuente geográfica: "© OpenStreetMap contributors, ODbL 1.0, relation 1346513, simplificado tolerancia 0.0002°"
-- (descargado el 2026-11-17 desde Nominatim R1346513 polygon_geojson=1, simplificado con Douglas-Peucker 0.0002°: 131 vértices, 70.42 km² EPSG:3116).

DO $$
DECLARE
  v_tariff_id uuid;
  v_zone_id uuid;
  v_wkt text := 'SRID=4326;MULTIPOLYGON(((-73.99112 4.972057,-73.985839 4.969568,-73.980884 4.966533,-73.974485 4.964074,-73.972146 4.964967,-73.970714 4.964851,-73.970146 4.962462,-73.969857 4.958999,-73.969986 4.953493,-73.969691 4.950025,-73.968962 4.946629,-73.967201 4.944379,-73.965475 4.943393,-73.963327 4.943258,-73.960511 4.943806,-73.958018 4.94375,-73.957054 4.942924,-73.951534 4.940312,-73.943715 4.934136,-73.941385 4.933246,-73.940254 4.9319,-73.938757 4.93118,-73.937741 4.929998,-73.937626 4.928756,-73.936603 4.928114,-73.935941 4.9269,-73.935039 4.926653,-73.935055 4.925469,-73.934033 4.924539,-73.932108 4.924207,-73.931382 4.922329,-73.929708 4.920193,-73.927401 4.919745,-73.925447 4.918738,-73.925047 4.917821,-73.923482 4.917174,-73.92085 4.916359,-73.918474 4.916101,-73.917307 4.915139,-73.91527 4.914732,-73.912545 4.919592,-73.910859 4.920938,-73.907847 4.924176,-73.905979 4.926718,-73.905287 4.928504,-73.904039 4.934466,-73.90347 4.935661,-73.902363 4.937028,-73.899531 4.939118,-73.897582 4.942685,-73.895913 4.944835,-73.891569 4.948435,-73.890372 4.951007,-73.888006 4.951525,-73.886377 4.952863,-73.884077 4.954103,-73.881797 4.956221,-73.876739 4.958899,-73.874639 4.960526,-73.87405 4.961482,-73.875497 4.961196,-73.87836 4.961484,-73.882654 4.962729,-73.893626 4.967709,-73.89687 4.971921,-73.898396 4.974984,-73.898452 4.976425,-73.895497 4.978003,-73.892817 4.980013,-73.888534 4.984846,-73.890083 4.988566,-73.894044 4.994304,-73.897 4.999618,-73.897143 5.000505,-73.895701 5.002872,-73.895603 5.00397,-73.896455 5.005714,-73.899119 5.00885,-73.899338 5.009931,-73.899122 5.012373,-73.899435 5.013649,-73.904038 5.02173,-73.904005 5.023368,-73.902554 5.027084,-73.902296 5.028635,-73.903036 5.030231,-73.905778 5.032947,-73.905623 5.029748,-73.90686 5.027312,-73.909259 5.024342,-73.913694 5.019907,-73.915369 5.018651,-73.921327 5.015605,-73.926315 5.015015,-73.930217 5.013016,-73.933525 5.012211,-73.937118 5.010045,-73.938654 5.009749,-73.941677 5.010288,-73.943062 5.0094,-73.93981 5.003836,-73.937745 4.998009,-73.93707 4.993325,-73.937514 4.987606,-73.939321 4.981849,-73.942249 4.976686,-73.945027 4.973211,-73.950136 4.969265,-73.952621 4.96787,-73.955699 4.967327,-73.959088 4.96805,-73.962228 4.969951,-73.963646 4.971818,-73.964304 4.97385,-73.964513 4.98289,-73.964998 4.984918,-73.966016 4.987076,-73.968155 4.989762,-73.970434 4.991642,-73.972984 4.992929,-73.975959 4.993569,-73.978134 4.993568,-73.980276 4.993142,-73.981884 4.992391,-73.983058 4.991319,-73.983859 4.98962,-73.984577 4.982022,-73.985984 4.977372,-73.988101 4.973965,-73.989741 4.972592,-73.99112 4.972057)))';
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
      ST_GeogFromText(v_wkt),
      100
    )
    RETURNING id INTO v_zone_id;
  ELSE
    UPDATE tariff_zones
    SET name = 'Municipio de Tocancipá (DIVIPOLA 25817)',
        area = ST_GeogFromText(v_wkt),
        priority = 100
    WHERE id = v_zone_id;
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
