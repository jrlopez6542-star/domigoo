# Auditoría de Preparación para Producción (M43 → M44 Production Bootstrap)

**Fecha:** 2026-11-17  
**Rama base auditada:** `Contabilidad` (commits `f5e8d41` PR #34, `d3f082f` PR #35, `55a45ec` PR #36)  
**Rama de bootstrap de producción (M44):** `feat/m44-production-bootstrap`

> **Convención de estados del checklist:**
> - **`OK`**: Control implementado, verificado en código/infraestructura y cubierto por pruebas automáticas o contrato SQL.
> - **`FALTA`**: Brecha técnica u operativa pendiente antes de exponer tráfico real de producción a escala.
> - **`DUEÑO`**: Decisión de negocio, insumo jurídico/comercial o aprovisionamiento externo exclusivo del propietario del proyecto.

---

## 1. Resumen Ejecutivo de Conteo (Actualizado tras M44)

| Categoría | `OK` | `FALTA` | `DUEÑO` | Total ítems |
| --- | :---: | :---: | :---: | :---: |
| 1. Seguridad | 10 | 3 | 0 | 13 |
| 2. Datos | 7 | 2 | 0 | 9 |
| 3. Operación | 5 | 3 | 0 | 8 |
| 4. Legal (sin redactar textos) | 2 | 0 | 5 | 7 |
| 5. Negocio | 3 | 0 | 2 | 5 |
| **Total General** | **27** | **8** | **7** | **42** |

### Ítems `DUEÑO` y `FALTA` Resueltos en M44 (2026-11-17)

1. **`S-13` (`DUEÑO` → `OK`)**: Secretos de Production (`PIN_PEPPER`, `APP_ENCRYPTION_KEY`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) creados en Vercel Production.
2. **`D-08` (`FALTA` → `OK`)**: `scripts/vercel-build.sh` ejecuta en `VERCEL_ENV=production` únicamente `prisma migrate deploy` (usando `DATABASE_URL_UNPOOLED` si existe) y `seed-admin` idempotente, sin ejecutar jamás `seed:staging`, y expone el resultado en la cabecera `x-domigoo-vercel-build`.
3. **`D-09` (`DUEÑO` → `OK`)**: Base de datos de producción nueva y vacía `"domigoo-production"` (Neon Free, región `iad1`) aprovisionada y conectada exclusivamente a Vercel Production (`DATABASE_URL` y `DATABASE_URL_UNPOOLED`).
4. **`O-08` (`DUEÑO` → `OK`)**: Definida URL oficial de producción sin dominio propio: `https://domigoo.vercel.app`.
5. **`N-01` (`DUEÑO` → `OK` en bootstrap con trial de 15 días gratis)**: Plan `TRIAL_15D` (`trialDays=15, priceCop=0`) asignado automáticamente al registrar restaurante; al vencer, con `BILLING_ENABLED=false` (por defecto), no se bloquea ni se cobra y el servicio sigue gratis. Precios futuros quedan como placeholders configurables (`PLAN_BASE_PLACEHOLDER`, `SUBSCRIPTION_PLACEHOLDER_PRICE_COP`).
6. **`N-03` (`DUEÑO` → `OK`)**: Polígono del límite municipal de Tocancipá (`DIVIPOLA 25817`, `© OpenStreetMap contributors, ODbL 1.0, relation 1346513, simplificado tolerancia 0.0002°`, 131 vértices, `70.42 km²` EPSG:3116) versionado en `apps/api/src/geo/tocancipa-25817.geojson`, sembrado idempotentemente en la migración `20261117120000_m44_tocancipa_coverage_and_trial_bootstrap` y validado en registro de restaurantes, cotización y publicación de pedidos.
7. **`N-04` (`DUEÑO` → `OK` en bootstrap inicial)**: Política operativa base `Política Operativa Tocancipá 25817` publicada de forma idempotente en cualquier entorno.

---

## 2. Checklist Verificable por Dominio

### 2.1 Seguridad

| # | Ítem | Estado | Evidencia (archivo o comando) | Riesgo |
| --- | --- | --- | --- | --- |
| S-01 | **Autenticación y hash de contraseñas (`Argon2id`)**: parámetros fijos en servidor (`m=19456 KiB, t=2, p=1`, sal CSPRNG de 16 bytes, comparación en tiempo constante `timingSafeEqual`). | `OK` | `apps/api/src/identity/password.ts` (`L4-L33`), `apps/api/test/auth.e2e-spec.ts` | **BAJO** — Mitiga fuerza bruta offline y ataques de temporización. |
| S-02 | **Sesiones revocables y cookies seguras**: tokens aleatorios de 32 bytes almacenados como SHA-256 (`sessions.tokenHash`); cookie `domigoo_session` con `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` activo cuando `NODE_ENV=production`. | `OK` | `apps/api/src/identity/session-token.ts`, `apps/api/src/identity/session-cookie.ts` (`L27-L39`), `apps/api/src/config/env.ts` (`L29-L35`) | **BAJO** — Evita robo de sesión por XSS y exposición de tokens en base de datos. |
| S-03 | **Control de acceso basado en roles (RBAC) y pertenencia (IDOR)**: guardas `SessionGuard`, `AdminGuard` (`SUPERADMIN`, `REVIEWER`, `OPERATIONS`, `SECURITY`) y `RestaurantGuard` (`OWNER`, `MANAGER`, `OPERATOR`); objetos ajenos devuelven `403`/`404` sin filtrar existencia. | `OK` | `apps/api/src/identity/session.guard.ts`, `apps/api/src/identity/admin.guard.ts`, `apps/api/src/restaurants/restaurant.guard.ts`, `apps/api/test/authorization.e2e-spec.ts` | **BAJO** — Cubierto por suite E2E de autorización cruzada. |
| S-04 | **Rate limit en login y bloqueo de PIN**: throttle de login (5 fallos / 15 min) y bloqueo de PIN (`maxPinAttempts`, incidente `PIN_LOCKOUT`). | `OK` | `apps/api/src/identity/login-throttle.ts` (`L1-L32`), `apps/api/src/orders/journey.repository.ts`, `apps/api/test/pins.e2e-spec.ts` | **MEDIO** — Suficiente para 1 réplica; ver S-05 para despliegue multi-réplica/serverless. |
| S-05 | **Rate limit distribuido (PostgreSQL/Redis) para múltiples instancias o serverless**: el limitador de login actual reside en un `Map` en memoria de proceso y el endpoint público `/v1/tracking/:token` no tiene rate limit distribuido por IP. | `FALTA` | `apps/api/src/identity/login-throttle.ts` (`L9`), `apps/api/src/tracking/tracking.controller.ts` (`L61-L81`), `docs/decisiones/riesgos.md` (`R10`) | **ALTO** — En funciones serverless (Vercel) o >1 réplica, los contadores en memoria no se comparten entre instancias. |
| S-06 | **CORS por lista blanca (`CORS_ORIGINS`) y aislamiento de `/v1/tracking`**: middleware `applyHttpSecurity` aplica `Access-Control-Allow-Origin` solo a orígenes explícitamente listados en `CORS_ORIGINS` y nunca refleja origen en `/v1/tracking/*`. | `OK` | `apps/api/src/http.ts` (`L17-L66`), `apps/api/src/http.spec.ts` | **BAJO** — Para `https://domigoo.vercel.app` usar `CORS_ORIGINS=https://domigoo.vercel.app` (ver §3.2). |
| S-07 | **Cabeceras HTTP de endurecimiento**: eliminación de `X-Powered-By`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, y en tracking público `X-Robots-Tag: noindex, nofollow` + `Cache-Control: no-store`. | `OK` | `apps/api/src/http.ts` (`L30-L43`), `apps/api/src/tracking/tracking.controller.ts` (`L68-L70`), `apps/api/src/http.spec.ts` | **BAJO** — Cumple el estándar de cabeceras de `docs/pruebas-y-seguridad.md`. |
| S-08 | **Cifrado de PIN y tokens de tracking (`PIN_PEPPER`, `APP_ENCRYPTION_KEY` / `DATA_ENCRYPTION_KEY`)**: CSPRNG con rejection sampling, `HMAC-SHA-256` con pepper y `AES-256-GCM` con AAD (`orderId:kind`) y clave de 32 bytes obligatoria en `NODE_ENV=production`. | `OK` | `apps/api/src/orders/pin-crypto.ts` (`L15-L90`), `apps/api/src/config/env.ts` (`L37-L79`), `apps/api/src/config/env.spec.ts` | **BAJO** — El proceso aborta en arranque si faltan `PIN_PEPPER` o `APP_ENCRYPTION_KEY`/`DATA_ENCRYPTION_KEY` en producción. |
| S-09 | **Anulación de ciphertexts en estado terminal**: al pasar el pedido a estado terminal (`DELIVERED`, `CANCELLED_*`, `EXPIRED`, `FAILED`), `pickupPinCiphertext` y `deliveryPinCiphertext` se limpian en la base de datos. | `OK` | `apps/api/src/orders/journey.repository.ts`, `apps/api/src/orders/expiration.repository.ts`, `apps/api/test/pins.e2e-spec.ts` | **BAJO** — Minimiza exposición criptográfica post-entrega. |
| S-10 | **Manejo y redacción de secretos en código, logs y auditoría**: cero secretos reales en el árbol Git; `.gitignore` excluye `.env*`; `redact` y `redactDiff` enmascaran `password`, `passwordHash`, `token`, `tokenHash`, `tokenCiphertext`, `pushToken`, `pin`, `ciphertext`, `pickupPinCiphertext`, `deliveryPinCiphertext`, `documentNumber`, `authorization` y `cookie`. | `OK` | `.gitignore`, `apps/api/src/identity/redact.ts`, `apps/api/src/audit/redact-diff.ts`, `apps/api/src/identity/redact.spec.ts` | **BAJO** — Verificado con pruebas unitarias y E2E (`apps/api/test/audit.e2e-spec.ts`). |
| S-11 | **Validación de entrada y firma binaria de documentos**: tope de 10 MB (`MAX_DOCUMENT_BYTES`), verificación de magic bytes (`%PDF-`, JPEG, PNG, WebP) además de MIME, claves UUID opacas con validación de path traversal y coordenadas WGS84 acotadas a `[-180, 180]` / `[-90, 90]`. | `OK` | `apps/api/src/storage/object-storage.ts`, `apps/api/src/storage/local-object-storage.ts` (`L28-L38`), `apps/api/src/tariffs/tariffs.controller.ts` (`L193-L213`) | **BAJO** — Impide subida de ejecutables disfrazados, lectura arbitraria de disco y errores SQL por coordenadas inválidas. |
| S-12 | **Vulnerabilidades en dependencias (`pnpm audit`)**: el escaneo actual reporta hallazgos concentrados principalmente en `next@15.5.12` (parcheado en `>=15.5.28`), `sharp` (`<0.35.5`), `postcss` y dependencias de build/test (`@playwright/test`, `expo`, `glob`, `minimatch`). | `FALTA` | Comando: `pnpm audit` / `pnpm audit --prod` (`package.json`, `pnpm-lock.yaml`) | **ALTO** — Antes de abrir tráfico público en `@domigoo/web` y `@domigoo/admin`, actualizar `next` a `>=15.5.28` y regenerar `pnpm-lock.yaml`. |
| S-13 | **Generación y carga de secretos de Production en plataforma destino**: valores exclusivos de Production (`PIN_PEPPER`, `APP_ENCRYPTION_KEY`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) aprovisionados en Vercel Production (2026-11-17). | `OK` | Configuración de Vercel Production confirmada por el dueño (2026-11-17), `scripts/vercel-build.sh` | **BAJO** — Secretos aislados por entorno en Vercel Production. |

---

### 2.2 Datos

| # | Ítem | Estado | Evidencia (archivo o comando) | Riesgo |
| --- | --- | --- | --- | --- |
| D-01 | **Migraciones reproducibles e integridad de esquema (PostgreSQL 17 + PostGIS 3.5)**: 42 tablas, 6 índices GiST geoespaciales, índices únicos parciales de concurrencia (`dispatch_offers_one_accepted`, `orders_one_active_per_courier`) y restricciones `CHECK` verificadas con `prisma migrate deploy`. | `OK` | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/`, `./scripts/check-contract.sh` | **BAJO** — Validado en cada corrida de CI (job `Contrato`). |
| D-02 | **Inmutabilidad de bitácora de auditoría (`audit_logs`)**: trigger PL/pgSQL `audit_logs_no_update` rechaza cualquier `UPDATE` o `DELETE` sobre `audit_logs`. | `OK` | `apps/api/prisma/migrations/20261109232000_init/migration.sql`, `scripts/check-contract.sql`, `apps/api/test/audit.e2e-spec.ts` (`L89`) | **BAJO** — Garantiza trazabilidad forense append-only. |
| D-03 | **Minimización de PII por canal y rol**: respuestas al domiciliario excluyen `foodAmountCop`, PIN y teléfono del cliente mientras la oferta está `PENDING`; el tracking público oculta documento, teléfono, dirección exacta y montos; las estadísticas de admin carecen de PII. | `OK` | `apps/api/src/orders/offers.repository.ts`, `apps/api/src/tracking/tracking.repository.ts`, `apps/api/src/admin/admin.repository.ts`, `apps/api/test/flujo-completo.e2e-spec.ts` | **BAJO** — Cumple la matriz de visibilidad de `docs/pruebas-y-seguridad.md` (§7). |
| D-04 | **Registro versionado y revocación de consentimientos**: `legal_documents` guarda `contentHash` SHA-256 por versión; `consent_records` registra otorgamiento y revocación (`revokedAt`) sin sobrescribir historial; sin consentimiento vigente se rechazan subida de documentos y pings GPS (`422`). | `OK` | `apps/api/src/privacy/privacy.controller.ts` (`L29-L84`), `apps/api/src/couriers/courier-files.controller.ts` (`L134-L136`), `apps/api/src/couriers/availability.controller.ts` | **BAJO** — Cubierto por `apps/api/test/privacy.e2e-spec.ts` y `apps/api/test/habeas-data.e2e-spec.ts`. |
| D-05 | **Conducto de Habeas Data y anonimización bajo demanda**: endpoints `POST /v1/data-subject-requests` y `POST /v1/data-subject-requests/:id/process` revocan consentimiento GPS y anonimizan `customerName`, `customerPhoneE164`, `dropoffAddressLine` y `dropoffNotes` en pedidos cerrados conservando montos contables. | `OK` | `apps/api/src/privacy/privacy.repository.ts`, `apps/api/test/habeas-data.e2e-spec.ts` | **BAJO** — Preserva integridad contable mientras suprime PII de contacto. |
| D-06 | **Almacenamiento privado de objetos (S3/R2/GCS) para documentos de identidad**: actualmente `StorageModule` inyecta `LocalObjectStorage` (sistema de archivos local / `/tmp/domigoo-storage`), el cual es efímero en serverless y no apto para producción. | `FALTA` | `apps/api/src/storage/storage.module.ts`, `apps/api/src/storage/local-object-storage.ts`, `docs/decisiones/riesgos.md` (`R12`) | **CRÍTICO** — En producción debe implementarse un adaptador `ObjectStorage` contra un bucket privado con cifrado en reposo antes de recibir documentos reales. |
| D-07 | **Job programado de purga y retención automática**: los plazos de retención de `docs/modelo-datos.md` (§7: pings GPS 30 días, `tracking_accesses` 90 días, PII de pedidos 24 meses, documentos 12 meses post-cierre, push tokens 180 días) no tienen aún un cron/worker automático que los ejecute periódicamente. | `FALTA` | `docs/modelo-datos.md` (`L238-L251`), `docs/decisiones/riesgos.md` (`R18`) | **MEDIO** — Requiere tarea programada (pg_cron o job periódico) una vez el área jurídica confirme los plazos definitivos. |
| D-08 | **Ejecución controlada de migraciones y `seed-admin` hacia base de Production**: cuando `VERCEL_ENV=production`, `scripts/vercel-build.sh` ejecuta únicamente `prisma migrate deploy` (usando `DATABASE_URL_UNPOOLED` si existe) y `seed-admin` idempotente, nunca `seed:staging`, e inyecta la evidencia en `x-domigoo-vercel-build`. | `OK` | `scripts/vercel-build.sh` (`L8-L31`), `api/index.mjs` (`L15-L19`), `apps/api/src/identity/seed-admin.ts` | **BAJO** — Si `prisma migrate deploy` falla, el build de Vercel aborta inmediatamente. |
| D-09 | **Aprovisionamiento de base PostgreSQL 17 + PostGIS 3.5 de Production (`domigoo-production`)**: base nueva y vacía `"domigoo-production"` en Neon Free (`iad1`, PITR nativo de Neon) conectada exclusivamente a Vercel Production (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`). | `OK` | Infraestructura Neon `domigoo-production` + variables en Vercel Production confirmadas por el dueño (2026-11-17) | **BAJO** — Base de producción separada físicamente de `domigoo-preview`. |

---

### 2.3 Operación

| # | Ítem | Estado | Evidencia (archivo o comando) | Riesgo |
| --- | --- | --- | --- | --- |
| O-01 | **Sondas de viveza (`/health`) y disponibilidad (`/ready`)**: `/health` verifica el proceso sin tocar base de datos (`200`); `/ready` abre conexión con timeout de 2000 ms y ejecuta `SELECT PostGIS_Version()`, devolviendo `200` o `503 Service Unavailable`. | `OK` | `apps/api/src/health/health.controller.ts` (`L15-L32`), `apps/api/src/health/readiness.service.ts` (`L9-L27`), `apps/api/test/system.e2e-spec.ts` | **BAJO** — Listo para balanceadores de carga y monitores de uptime. |
| O-02 | **Protección de fallo de arranque sin filtrar cadena de conexión**: `main.ts` intercepta errores de bootstrap y, si el mensaje contiene `postgres://` o `postgresql://`, escribe únicamente `"No se pudo arrancar la API"` en `stderr`. | `OK` | `apps/api/src/main.ts` (`L16-L24`), `apps/api/src/vercel.ts` (`L9`) | **BAJO** — Previene fuga de credenciales de BD en logs de caída. |
| O-03 | **CI/CD automatizado y smoke test E2E de 12 pasos**: workflow `.github/workflows/ci.yml` valida `lint`, `typecheck`, pruebas unitarias, `PostGIS`, `API`, `Contrato` (`check-contract.sh`), `Playwright Web y Admin`, idempotencia de `seed:staging`, `Smoke staging` local y `Smoke Vercel Preview` real. | `OK` | `.github/workflows/ci.yml`, `scripts/smoke-staging.mjs` | **BAJO** — Compuerta completa en verde antes de cualquier merge a `Contabilidad`. |
| O-04 | **Manejo consistente de errores HTTP y filtros de subida**: `DocumentUploadFilter` convierte excesos de tamaño (`LIMIT_FILE_SIZE`) en `422` limpio y oculta trazas internas en errores `500`. | `OK` | `apps/api/src/couriers/courier-files.controller.ts` (`L48-L65`) | **BAJO** — No expone stacktraces ni rutas internas al cliente. |
| O-05 | **Trabajador de despacho de `notification_outbox` y adaptador FCM real**: el sistema encola notificaciones minimizadas en `notification_outbox`, pero en V1 utiliza `InMemoryPushSender` y no cuenta con el adaptador real de Firebase Cloud Messaging ni worker de drenaje en background. | `FALTA` | `apps/api/src/notifications/push-sender.port.ts`, `apps/api/src/notifications/outbox.repository.ts`, `docs/decisiones/riesgos.md` (`R05`) | **ALTO** — Sin este adaptador y su credencial FCM, los domiciliarios no reciben notificaciones push reales en segundo plano. |
| O-06 | **Trabajador programado de expiración de ofertas y pedidos (`SEEKING_COURIER`)**: la lógica de expiración idempotente existe en `ExpirationRepository`, pero requiere un cron/scheduler en producción que invoque periódicamente el barrido de ofertas y pedidos vencidos. | `FALTA` | `apps/api/src/orders/expiration.repository.ts`, `apps/api/test/cancel-expiration.e2e-spec.ts` | **MEDIO** — Sin invocación periódica, las olas vencidas dependen de llamadas explícitas al endpoint de barrido. |
| O-07 | **Observabilidad centralizada, alertas y procedimiento de rollback**: falta integración con agregador de logs estructurados / APM (ej. Sentry, Datadog, OpenTelemetry) y runbook de rollback de base de datos para migraciones en producción. | `FALTA` | `apps/api/src/main.ts`, `apps/api/src/vercel.ts`, `vercel.json` | **MEDIO** — El rollback de código en Vercel es inmediato, pero las migraciones SQL hacia adelante requieren plan de contingencia y alertas de error 5xx. |
| O-08 | **URL oficial de producción en Vercel (`https://domigoo.vercel.app`)**: decisión del dueño (2026-11-17) de operar en `https://domigoo.vercel.app` sin dominio personalizado por ahora. | `OK` | `vercel.json`, `api/index.mjs`, decisión del dueño (2026-11-17) | **BAJO** — HTTPS gestionado automáticamente por Vercel en `https://domigoo.vercel.app`. |

---

### 2.4 Legal (Colombia — Ley 1581 de 2012 y Decreto 1074 de 2015)

> **Nota de alcance:** Esta sección **únicamente lista qué está implementado en ingeniería y qué falta por parte del área jurídica/dueño**, sin redactar textos legales.

| # | Ítem | Estado | Evidencia (archivo o comando) | Riesgo |
| --- | --- | --- | --- | --- |
| L-01 | **Soporte técnico para versionado de textos legales y hash de integridad**: tabla `legal_documents` (`PRIVACY_NOTICE`, `TERMS`, `GEOLOCATION_CONSENT`, `DOCUMENT_PROCESSING`) con `contentHash` SHA-256 y `consent_records` trazables por usuario, canal y fecha. | `OK` | `apps/api/src/privacy/privacy.controller.ts` (`L19-L70`), `apps/api/prisma/schema.prisma` | **BAJO** — Infraestructura técnica lista para cargar los textos definitivos. |
| L-02 | **Soporte técnico para solicitudes ARCO / Habeas Data**: registro y procesamiento de solicitudes `ACCESS`, `CORRECTION`, `DELETION`, `REVOCATION` y `COMPLAINT` en `data_subject_requests`. | `OK` | `apps/api/src/privacy/privacy.controller.ts` (`L86-L133`), `apps/api/test/habeas-data.e2e-spec.ts` | **BAJO** — Mecanismo técnico operativo y probado. |
| L-03 | **Textos definitivos de Términos y Condiciones (`TERMS`) y Aviso de Privacidad (`PRIVACY_NOTICE`)**: los textos actuales en pruebas y staging son marcadores sintéticos; falta cargar los documentos jurídicos definitivos redactados y aprobados para Colombia. | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L85-L109`), `apps/api/src/staging/seed-staging.ts` | **CRÍTICO** — Obligatorio antes de recolectar datos personales reales. |
| L-04 | **Textos definitivos de autorización de tratamiento de documentos (`DOCUMENT_PROCESSING`) y geolocalización (`GEOLOCATION_CONSENT`)**: falta el texto jurídico real que aceptan los domiciliarios al subir cédula/licencia/SOAT/tecnomecánica y al activar el GPS. | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L93-L98`) | **CRÍTICO** — Exigido por la Ley 1581 de 2012 para datos sensibles/ubicación. |
| L-05 | **Validación jurídica del reparto Responsable / Encargado frente a datos del destinatario final**: confirmar en el aviso de privacidad y contrato con restaurantes el supuesto de trabajo (restaurante como Responsable del dato del cliente final y DOMIGOO como Encargado para la entrega y enlace de tracking). | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L100`), `docs/decisiones/riesgos.md` (`R06`) | **ALTO** — Riesgo regulatorio ante la SIC si el contrato con restaurantes no lo estipula. |
| L-06 | **Cláusula de transmisión internacional de datos (Firebase / proveedores cloud) y validación de plazos de retención**: incluir en la política de tratamiento la transmisión a encargados en el exterior (FCM/cloud) y validar jurídicamente los plazos de retención de `docs/modelo-datos.md` (§7). | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L102`, `L106`), `docs/decisiones/riesgos.md` (`R16`, `R18`) | **ALTO** — Requisito del Decreto 1074 de 2015. |
| L-07 | **Evaluación de inscripción en el RNBD (Superintendencia de Industria y Comercio) y contrato con domiciliarios independientes**: determinar si la sociedad está obligada a inscribir bases en el RNBD y validar el texto contractual para evitar riesgo laboral. | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L104`), `docs/decisiones/riesgos.md` (`R14`) | **ALTO** — Obligación societaria y laboral del propietario. |

---

### 2.5 Negocio

| # | Ítem | Estado | Evidencia (archivo o comando) | Riesgo |
| --- | --- | --- | --- | --- |
| N-01 | **Suscripción de prueba gratuita de 15 días (`TRIAL_15D`, `trialDays=15, priceCop=0`) y servicio gratuito al vencer (`BILLING_ENABLED=false`)**: asignada automáticamente al registrarse un restaurante; al vencer no bloquea ni cobra mientras `BILLING_ENABLED=false` (por defecto). Precios comerciales definitivos quedan como placeholders configurables (`PLAN_BASE_PLACEHOLDER`, `SUBSCRIPTION_PLACEHOLDER_PRICE_COP`). | `OK` | `apps/api/src/restaurants/restaurant.repository.ts`, `apps/api/src/subscriptions/subscription.repository.ts`, `apps/api/src/subscriptions/subscription.spec.ts`, `apps/api/test/subscription.e2e-spec.ts` | **BAJO** — Permite operar el lanzamiento gratuito de 15 días sin bloqueos ni cobros; activar `BILLING_ENABLED=true` cuando el dueño fije precios definitivos. |
| N-02 | **Tarifario comercial definitivo de domicilios (`tariff_versions` / `tariff_rules`)**: la migración M44 carga una tarifa base placeholder (`5500 COP`) para Tocancipá; falta que el dueño defina los valores comerciales definitivos (`baseFeeCop`, `perKmCop`, `minimumFeeCop`, `nightMultiplierBps`). | `DUEÑO` | `apps/api/prisma/migrations/20261117120000_m44_tocancipa_coverage_and_trial_bootstrap/migration.sql`, `apps/api/src/geo/tocancipa-coverage.ts` | **MEDIO** — Configurable en caliente desde el panel/endpoints de admin (`/v1/admin/tariffs/*`). |
| N-03 | **Polígono geográfico del municipio de Tocancipá (`DIVIPOLA 25817`)**: límite municipal derivado de `© OpenStreetMap contributors, ODbL 1.0, relation 1346513, simplificado tolerancia 0.0002°` (131 vértices, `70.42 km²` proyectados en EPSG:3116, generado con `scripts/geo/build-tocancipa-polygon.mjs`), versionado como GeoJSON, cargado de forma idempotente en PostGIS (`TOCANCIPA_25817`) y validado con mensaje claro en direcciones fuera de zona (`422`). | `OK` | `apps/api/src/geo/tocancipa-25817.geojson`, `scripts/geo/build-tocancipa-polygon.mjs`, `apps/api/src/geo/tocancipa-coverage.ts`, `apps/api/src/geo/tocancipa-coverage.spec.ts` | **BAJO** — Cubierto por pruebas unitarias (Parque Principal, occidente real y veredas dentro; Gachancipá, Sopó, Zipaquirá, Bogotá y oriente externo fuera) y E2E. |
| N-04 | **Política operativa inicial de despacho en Tocancipá (`Política Operativa Tocancipá 25817`)**: sembrada de forma idempotente con radio de 5000 m, TTL de 120 s y frescura GPS de 120 s. | `OK` | `apps/api/prisma/migrations/20261117120000_m44_tocancipa_coverage_and_trial_bootstrap/migration.sql`, `apps/api/src/geo/tocancipa-coverage.ts` | **BAJO** — Ajustable por el dueño mediante nuevas versiones en `/v1/admin/policies/*`. |
| N-05 | **Recaudo futuro de suscripciones, precios definitivos y conciliación contable**: mientras `BILLING_ENABLED=false` el servicio es gratuito; antes de activar `BILLING_ENABLED=true`, el dueño debe fijar precios definitivos y cuenta recaudadora. | `DUEÑO` | `apps/api/src/config/env.ts` (`BILLING_ENABLED`), `docs/modelo-datos.md` (`L84`) | **BAJO** — Desacoplado detrás del feature flag `BILLING_ENABLED=false`. |

---

## 3. Variables de Entorno de Production y Valores para `https://domigoo.vercel.app`

> **Regla de seguridad:** Nunca se deben almacenar ni imprimir valores de secretos o cadenas de conexión en el repositorio. Solo se documentan valores públicos no sensibles (como la URL pública `https://domigoo.vercel.app` y flags booleanos/numéricos por defecto).

### 3.1 API (`@domigoo/api` — Runtime y Build en Vercel Production)

| Nombre de Variable | Obligatoria en Production | Estado en Vercel Production | Propósito / Valor público recomendado | Dónde se lee |
| --- | :---: | :---: | --- | --- |
| `NODE_ENV` | Sí (`production`) | Configurada por Vercel | Activa exigencia de secretos (`PIN_PEPPER`, `APP_ENCRYPTION_KEY`) y flag `Secure` en cookie `domigoo_session`. | `apps/api/src/config/env.ts` |
| `DATABASE_URL` | Sí | Ya creada (`domigoo-production`) | Cadena de conexión PostgreSQL 17 + PostGIS 3.5 (pooled) en Neon `iad1`. | `apps/api/src/config/env.ts` |
| `DATABASE_URL_UNPOOLED` | Sí | Ya creada (`domigoo-production`) | Cadena de conexión directa (unpooled) usada por `scripts/vercel-build.sh` para `prisma migrate deploy` y `seed-admin`. | `scripts/vercel-build.sh` |
| `PIN_PEPPER` | Sí | Ya creada | Secreto criptográfico para `HMAC-SHA-256` de PIN de recogida y entrega. | `apps/api/src/config/env.ts` |
| `APP_ENCRYPTION_KEY` | Sí (o `DATA_ENCRYPTION_KEY`) | Ya creada | Clave simétrica de 32 bytes para cifrado `AES-256-GCM` de PINs activos y tokens de tracking. | `apps/api/src/config/env.ts` |
| `SEED_ADMIN_EMAIL` | Bootstrap inicial | Ya creada | Correo del primer `SUPERADMIN` sembrado de forma idempotente por `seed-admin.ts`. | `apps/api/src/identity/seed-admin.ts` |
| `SEED_ADMIN_PASSWORD` | Bootstrap inicial | Ya creada | Contraseña (12–72 caracteres) del primer `SUPERADMIN` en `seed-admin.ts`. | `apps/api/src/identity/seed-admin.ts` |
| `CORS_ORIGINS` | Recomendada | Configurar valor público | Valor exacto para producción en `https://domigoo.vercel.app`: `https://domigoo.vercel.app` (si Web/Admin se despliegan en orígenes adicionales, separarlos por comas sin barra final). | `apps/api/src/http.ts` |
| `BILLING_ENABLED` | Opcional (default `false`) | Default `false` en código | Feature flag de cobro/bloqueo de suscripción al vencer los 15 días de prueba (`false` mantiene el servicio gratis sin bloquear ni cobrar). | `apps/api/src/config/env.ts` |
| `SUBSCRIPTION_TRIAL_DAYS` | Opcional (default `15`) | Default `15` en código | Días de prueba gratuita asignados automáticamente al registrarse (`15`). | `apps/api/src/config/env.ts` |
| `SUBSCRIPTION_PLACEHOLDER_PRICE_COP` | Opcional (default `0`) | Default `0` en código | Precio placeholder configurable en COP mientras se definen tarifas definitivas (`0`). | `apps/api/src/config/env.ts` |
| `APP_NAME` | Opcional (default `DOMIGOO`) | Default `DOMIGOO` | Nombre público del producto expuesto en OpenAPI y avisos. | `apps/api/src/config/env.ts` |

### 3.2 Valores Exactos de `CORS_ORIGINS` y `API_BASE_URL` para `https://domigoo.vercel.app`

Con la decisión del dueño de operar en **`https://domigoo.vercel.app`** (sin dominio personalizado):

```dotenv
# En @domigoo/api (Vercel Production)
CORS_ORIGINS=https://domigoo.vercel.app
BILLING_ENABLED=false
SUBSCRIPTION_TRIAL_DAYS=15
SUBSCRIPTION_PLACEHOLDER_PRICE_COP=0

# En @domigoo/web y @domigoo/admin (Route Handlers proxy de Next.js hacia la API de producción)
API_BASE_URL=https://domigoo.vercel.app
APP_NAME=DOMIGOO

# En @domigoo/movil (Expo / React Native apuntando a producción)
EXPO_PUBLIC_API_URL=https://domigoo.vercel.app
EXPO_PUBLIC_APP_NAME=DOMIGOO
```

### 3.3 Verificación de Migraciones y `seed-admin` en Production (`x-domigoo-vercel-build`)

Cuando Vercel construye un deployment con `VERCEL_ENV=production`:
1. `scripts/vercel-build.sh` ejecuta **únicamente** `prisma migrate deploy` (usando `DATABASE_URL_UNPOOLED` si existe, o `DATABASE_URL` como respaldo) e imprime:
   - `[vercel-build] prod migrate deploy: inicio`
   - `[vercel-build] prod migrate deploy: ok`
2. A continuación ejecuta `pnpm --filter @domigoo/api seed-admin` (idempotente; sale `0` si faltan `SEED_ADMIN_*`) e imprime:
   - `[vercel-build] prod seed-admin: ejecutado` (cuando `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` están definidas), o
   - `[vercel-build] prod seed-admin: omitido` (cuando no están definidas).
3. **Nunca** ejecuta `seed:staging` ni carga datos ficticios en producción.
4. `api/index.mjs` expone el resultado real del build de producción en la cabecera HTTP `x-domigoo-vercel-build`. Para verificarlo sin inspeccionar secretos:

```bash
curl -I https://domigoo.vercel.app/health
```

Cabeceras esperadas tras el despliegue de Production:

```http
HTTP/2 200
x-domigoo-commit-sha: <sha-del-commit>
x-domigoo-deployment-id: <dpl_id>
x-domigoo-vercel-build: migrate=ok;seedAdmin=ejecutado
```

*(Si posteriormente el dueño retira `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` de Vercel Production tras el primer alta, el valor pasará a `x-domigoo-vercel-build: migrate=ok;seedAdmin=omitido`).*

### 3.4 Variables que NUNCA deben existir en Production

| Nombre de Variable | Motivo de prohibición en Production |
| --- | --- |
| `DOMIGOO_ENV=staging` | Reservada exclusivamente para el entorno de staging. |
| `STAGING_SEED_CONFIRM` | Habilita la siembra de datos sintéticos (`seed:staging`). |
| `STAGING_SEED_PASSWORD` | Contraseña de cuentas ficticias de staging. |
| `STAGING_ALLOWED_DB_HOSTS` | Bypass de validación de host de base de datos de staging. |
