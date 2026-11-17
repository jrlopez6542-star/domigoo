# Auditoría de Preparación para Producción (M43 — Production Readiness)

**Fecha:** 2026-11-17  
**Rama base auditada:** `Contabilidad` (commit base `f5e8d41`, PR #34 integrado)  
**Rama de auditoría y endurecimiento:** `chore/m43-production-readiness`

> **Convención de estados del checklist:**
> - **`OK`**: Control implementado, verificado en código y cubierto por pruebas automáticas o contrato SQL.
> - **`FALTA`**: Brecha técnica u operativa pendiente antes de exponer tráfico real de producción a escala.
> - **`DUEÑO`**: Decisión de negocio, insumo jurídico/comercial o aprovisionamiento externo exclusivo del propietario del proyecto.

---

## 1. Resumen Ejecutivo de Conteo

| Categoría | `OK` | `FALTA` | `DUEÑO` | Total ítems |
| --- | :---: | :---: | :---: | :---: |
| 1. Seguridad | 9 | 3 | 1 | 13 |
| 2. Datos | 5 | 3 | 1 | 9 |
| 3. Operación | 4 | 3 | 1 | 8 |
| 4. Legal (sin redactar textos) | 2 | 0 | 5 | 7 |
| 5. Negocio | 0 | 0 | 5 | 5 |
| **Total General** | **20** | **9** | **13** | **42** |

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
| S-06 | **CORS por lista blanca (`CORS_ORIGINS`) y aislamiento de `/v1/tracking`**: middleware `applyHttpSecurity` aplica `Access-Control-Allow-Origin` solo a orígenes explícitamente listados en `CORS_ORIGINS` y nunca refleja origen en `/v1/tracking/*`. | `OK` | `apps/api/src/http.ts` (`L17-L66`), `apps/api/src/http.spec.ts` | **BAJO** — Requiere definir `CORS_ORIGINS` en Production si Web/Admin residen en dominios distintos al de la API. |
| S-07 | **Cabeceras HTTP de endurecimiento**: eliminación de `X-Powered-By`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, y en tracking público `X-Robots-Tag: noindex, nofollow` + `Cache-Control: no-store`. | `OK` | `apps/api/src/http.ts` (`L30-L43`), `apps/api/src/tracking/tracking.controller.ts` (`L68-L70`), `apps/api/src/http.spec.ts` | **BAJO** — Cumple el estándar de cabeceras de `docs/pruebas-y-seguridad.md`. |
| S-08 | **Cifrado de PIN y tokens de tracking (`PIN_PEPPER`, `APP_ENCRYPTION_KEY` / `DATA_ENCRYPTION_KEY`)**: CSPRNG con rejection sampling, `HMAC-SHA-256` con pepper y `AES-256-GCM` con AAD (`orderId:kind`) y clave de 32 bytes obligatoria en `NODE_ENV=production`. | `OK` | `apps/api/src/orders/pin-crypto.ts` (`L15-L90`), `apps/api/src/config/env.ts` (`L37-L79`), `apps/api/src/config/env.spec.ts` | **BAJO** — El proceso aborta en arranque si faltan `PIN_PEPPER` o `APP_ENCRYPTION_KEY`/`DATA_ENCRYPTION_KEY` en producción. |
| S-09 | **Anulación de ciphertexts en estado terminal**: al pasar el pedido a estado terminal (`DELIVERED`, `CANCELLED_*`, `EXPIRED`, `FAILED`), `pickupPinCiphertext` y `deliveryPinCiphertext` se limpian en la base de datos. | `OK` | `apps/api/src/orders/journey.repository.ts`, `apps/api/src/orders/expiration.repository.ts`, `apps/api/test/pins.e2e-spec.ts` | **BAJO** — Minimiza exposición criptográfica post-entrega. |
| S-10 | **Manejo y redacción de secretos en código, logs y auditoría**: cero secretos reales en el árbol Git; `.gitignore` excluye `.env*`; `redact` y `redactDiff` enmascaran `password`, `passwordHash`, `token`, `tokenHash`, `tokenCiphertext`, `pushToken`, `pin`, `ciphertext`, `pickupPinCiphertext`, `deliveryPinCiphertext`, `documentNumber`, `authorization` y `cookie`. | `OK` | `.gitignore`, `apps/api/src/identity/redact.ts`, `apps/api/src/audit/redact-diff.ts`, `apps/api/src/identity/redact.spec.ts` | **BAJO** — Verificado con pruebas unitarias y E2E (`apps/api/test/audit.e2e-spec.ts`). |
| S-11 | **Validación de entrada y firma binaria de documentos**: tope de 10 MB (`MAX_DOCUMENT_BYTES`), verificación de magic bytes (`%PDF-`, JPEG, PNG, WebP) además de MIME, claves UUID opacas con validación de path traversal y coordenadas WGS84 acotadas a `[-180, 180]` / `[-90, 90]`. | `OK` | `apps/api/src/storage/object-storage.ts`, `apps/api/src/storage/local-object-storage.ts` (`L28-L38`), `apps/api/src/tariffs/tariffs.controller.ts` (`L193-L213`) | **BAJO** — Impide subida de ejecutables disfrazados, lectura arbitraria de disco y errores SQL por coordenadas inválidas. |
| S-12 | **Vulnerabilidades en dependencias (`pnpm audit`)**: el escaneo actual reporta **49 hallazgos** (`3 critical`, `22 high`, `22 moderate`, `2 low`), concentrados principalmente en `next@15.5.12` (parcheado en `>=15.5.28`), `sharp` (`<0.35.5`), `postcss` y dependencias de build/test (`@playwright/test`, `expo`, `glob`, `minimatch`). | `FALTA` | Comando: `pnpm audit` / `pnpm audit --prod` (`package.json`, `pnpm-lock.yaml`) | **ALTO** — Antes de abrir tráfico público en `@domigoo/web` y `@domigoo/admin`, se debe actualizar `next` a `>=15.5.28` y regenerar `pnpm-lock.yaml` validando E2E. |
| S-13 | **Generación y carga de secretos de Production en plataforma destino**: generar valores criptográficos exclusivos de Production (`PIN_PEPPER`, `APP_ENCRYPTION_KEY`) nunca compartidos con Preview/Staging. | `DUEÑO` | `docs/preview-vercel.md` (`L27`), `.env.staging.example` | **CRÍTICO** — Responsabilidad del propietario al aprovisionar el entorno Production. |

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
| D-08 | **Ejecución de migraciones hacia base de Production**: `scripts/vercel-build.sh` solo ejecuta `prisma migrate deploy` cuando `VERCEL_ENV=preview`; no existe pipeline ni paso de migración automática hacia una base de Production. | `FALTA` | `scripts/vercel-build.sh` (`L4-L35`), `docs/preview-vercel.md` (`L11-L12`) | **MEDIO** — Diseño intencional para proteger Production en esta fase; requiere workflow controlado de migración antes del go-live. |
| D-09 | **Aprovisionamiento de base PostgreSQL 17 + PostGIS 3.5 de Production, backups PITR y rol SQL sin privilegios de superusuario**: configurar instancia separada de `domigoo-preview`, con backups automáticos Point-in-Time Recovery (PITR), prueba de restauración y usuario de aplicación sin permiso `DROP`/`TRUNCATE`. | `DUEÑO` | `docs/preview-vercel.md` (`L5`, `L23-L26`), `docs/modelo-datos.md` (`L236`) | **CRÍTICO** — Acción exclusiva del propietario sobre la infraestructura de base de datos. |

---

### 2.3 Operación

| # | Ítem | Estado | Evidencia (archivo o comando) | Riesgo |
| --- | --- | --- | --- | --- |
| O-01 | **Sondas de viveza (`/health`) y disponibilidad (`/ready`)**: `/health` verifica el proceso sin tocar base de datos (`200`); `/ready` abre conexión con timeout de 2000 ms y ejecuta `SELECT PostGIS_Version()`, devolviendo `200` o `503 Service Unavailable`. | `OK` | `apps/api/src/health/health.controller.ts` (`L15-L32`), `apps/api/src/health/readiness.service.ts` (`L9-L27`), `apps/api/test/system.e2e-spec.ts` | **BAJO** — Listo para balanceadores de carga y monitores de uptime. |
| O-02 | **Protección de fallo de arranque sin filtrar cadena de conexión**: `main.ts` intercepta errores de bootstrap y, si el mensaje contiene `postgres://` o `postgresql://`, escribe únicamente `"No se pudo arrancar la API"` en `stderr`. | `OK` | `apps/api/src/main.ts` (`L16-L24`), `apps/api/src/vercel.ts` (`L9`) | **BAJO** — Previene fuga de credenciales de BD en logs de caída. |
| O-03 | **CI/CD automatizado y smoke test E2E de 12 pasos**: workflow `.github/workflows/ci.yml` valida `lint`, `typecheck`, pruebas unitarias, `PostGIS`, `API`, `Contrato` (`check-contract.sh`), `Playwright Web y Admin`, idempotencia de `seed:staging` y los 12 pasos de `pnpm smoke:staging`. | `OK` | `.github/workflows/ci.yml` (`L1-L277`), `scripts/smoke-staging.mjs` | **BAJO** — Compuerta completa en verde antes de cualquier merge a `Contabilidad`. |
| O-04 | **Manejo consistente de errores HTTP y filtros de subida**: `DocumentUploadFilter` convierte excesos de tamaño (`LIMIT_FILE_SIZE`) en `422` limpio y oculta trazas internas en errores `500`. | `OK` | `apps/api/src/couriers/courier-files.controller.ts` (`L48-L65`) | **BAJO** — No expone stacktraces ni rutas internas al cliente. |
| O-05 | **Trabajador de despacho de `notification_outbox` y adaptador FCM real**: el sistema encola notificaciones minimizadas en `notification_outbox`, pero en V1 utiliza `InMemoryPushSender` y no cuenta con el adaptador real de Firebase Cloud Messaging ni worker de drenaje en background. | `FALTA` | `apps/api/src/notifications/push-sender.port.ts`, `apps/api/src/notifications/outbox.repository.ts`, `docs/decisiones/riesgos.md` (`R05`) | **ALTO** — Sin este adaptador y su credencial FCM, los domiciliarios no reciben notificaciones push reales en segundo plano. |
| O-06 | **Trabajador programado de expiración de ofertas y pedidos (`SEEKING_COURIER`)**: la lógica de expiración idempotente existe en `ExpirationRepository`, pero requiere un cron/scheduler en producción que invoque periódicamente el barrido de ofertas y pedidos vencidos. | `FALTA` | `apps/api/src/orders/expiration.repository.ts`, `apps/api/test/cancel-expiration.e2e-spec.ts` | **MEDIO** — Sin invocación periódica, las olas vencidas dependen de llamadas explícitas al endpoint de barrido. |
| O-07 | **Observabilidad centralizada, alertas y procedimiento de rollback**: falta integración con agregador de logs estructurados / APM (ej. Sentry, Datadog, OpenTelemetry) y runbook de rollback de base de datos para migraciones en producción. | `FALTA` | `apps/api/src/main.ts`, `apps/api/src/vercel.ts`, `vercel.json` | **MEDIO** — El rollback de código en Vercel es inmediato, pero las migraciones SQL hacia adelante requieren plan de contingencia y alertas de error 5xx. |
| O-08 | **Dominios propios, TLS y despliegue de portales `@domigoo/web` y `@domigoo/admin`**: actualmente `vercel.json` enruta únicamente la API (`api/index.mjs`); falta asignar dominios de producción y proyectos/rutas de despliegue para Web y Admin. | `DUEÑO` | `vercel.json`, `docs/preview-vercel.md` (`L21-L25`), `docs/decisiones/riesgos.md` (`R01`) | **ALTO** — Decisión e infraestructura del propietario. |

---

### 2.4 Legal (Colombia — Ley 1581 de 2012 y Decreto 1074 de 2015)

> **Nota de alcance:** De acuerdo con las instrucciones de M43, esta sección **únicamente lista qué está implementado en ingeniería y qué falta por parte del área jurídica/dueño**, sin redactar textos legales.

| # | Ítem | Estado | Evidencia (archivo o comando) | Riesgo |
| --- | --- | --- | --- | --- |
| L-01 | **Soporte técnico para versionado de textos legales y hash de integridad**: tabla `legal_documents` (`PRIVACY_NOTICE`, `TERMS`, `GEOLOCATION_CONSENT`, `DOCUMENT_PROCESSING`) con `contentHash` SHA-256 y `consent_records` trazables por usuario, canal y fecha. | `OK` | `apps/api/src/privacy/privacy.controller.ts` (`L19-L70`), `apps/api/prisma/schema.prisma` | **BAJO** — Infraestructura técnica lista para cargar los textos definitivos. |
| L-02 | **Soporte técnico para solicitudes ARCO / Habeas Data**: registro y procesamiento de solicitudes `ACCESS`, `CORRECTION`, `DELETION`, `REVOCATION` y `COMPLAINT` en `data_subject_requests`. | `OK` | `apps/api/src/privacy/privacy.controller.ts` (`L86-L133`), `apps/api/test/habeas-data.e2e-spec.ts` | **BAJO** — Mecanismo técnico operativo y probado. |
| L-03 | **Textos definitivos de Términos y Condiciones (`TERMS`) y Aviso de Privacidad (`PRIVACY_NOTICE`)**: los textos actuales en pruebas y staging son marcadores sintéticos; falta cargar los documentos jurídicos definitivos redactados y aprobados para Colombia. | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L85-L109`), `apps/api/src/staging/seed-staging.ts` (`L146-L158`) | **CRÍTICO** — Obligatorio antes de recolectar datos personales reales. |
| L-04 | **Textos definitivos de autorización de tratamiento de documentos (`DOCUMENT_PROCESSING`) y geolocalización (`GEOLOCATION_CONSENT`)**: falta el texto jurídico real que aceptan los domiciliarios al subir cédula/licencia/SOAT/tecnomecánica y al activar el GPS. | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L93-L98`) | **CRÍTICO** — Exigido por la Ley 1581 de 2012 para datos sensibles/ubicación. |
| L-05 | **Validación jurídica del reparto Responsable / Encargado frente a datos del destinatario final**: confirmar en el aviso de privacidad y contrato con restaurantes el supuesto de trabajo (restaurante como Responsable del dato del cliente final y DOMIGOO como Encargado para la entrega y enlace de tracking). | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L100`), `docs/decisiones/riesgos.md` (`R06`) | **ALTO** — Riesgo regulatorio ante la SIC si el contrato con restaurantes no lo estipula. |
| L-06 | **Cláusula de transmisión internacional de datos (Firebase / proveedores cloud) y validación de plazos de retención**: incluir en la política de tratamiento la transmisión a encargados en el exterior (FCM/cloud) y validar jurídicamente los plazos de retención de `docs/modelo-datos.md` (§7). | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L102`, `L106`), `docs/decisiones/riesgos.md` (`R16`, `R18`) | **ALTO** — Requisito del Decreto 1074 de 2015. |
| L-07 | **Evaluación de inscripción en el RNBD (Superintendencia de Industria y Comercio) y contrato con domiciliarios independientes**: determinar si la sociedad está obligada a inscribir bases en el RNBD y validar el texto contractual para evitar riesgo laboral. | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L104`), `docs/decisiones/riesgos.md` (`R14`) | **ALTO** — Obligación societaria y laboral del propietario. |

---

### 2.5 Negocio

> **Nota de alcance:** De acuerdo con las instrucciones de M43, todos los ítems de negocio se marcan exclusivamente como **`DUEÑO`**.

| # | Ítem | Estado | Evidencia (archivo o comando) | Riesgo |
| --- | --- | --- | --- | --- |
| N-01 | **Precios reales de planes de suscripción y días de prueba (`subscription_plans`)**: definir tarifas comerciales reales en COP, duración del periodo, días de `TRIAL`, `maxBranches` y `maxConcurrentOrders`, más tratamiento tributario (IVA, retenciones y facturación electrónica DIAN). | `DUEÑO` | `docs/modelo-datos.md` (`L79-L85`), `docs/decisiones/riesgos.md` (`R07`, Supuesto 4) | **ALTO** — Los planes actuales (`STAGING_PLAN`) usan valores ficticios de prueba. |
| N-02 | **Tarifario real de domicilios (`tariff_versions` / `tariff_rules`)**: definir tarifa base (`baseFeeCop`), valor por kilómetro (`perKmCop`), tarifa mínima (`minimumFeeCop`), recargo nocturno (`nightMultiplierBps`) y franja horaria nocturna para Tocancipá. | `DUEÑO` | `docs/modelo-datos.md` (`L86-L91`), `apps/api/src/tariffs/tariffs.controller.ts` | **ALTO** — Impacta directamente el cobro de cada domicilio cotizado. |
| N-03 | **Polígono geográfico oficial de cobertura en Tocancipá (`tariff_zones.area`)**: suministrar el `MultiPolygon` WKT (WGS84 / SRID 4326) oficial de cobertura urbana/rural de Tocancipá para sustituir la envolvente rectangular de desarrollo. | `DUEÑO` | `docs/pruebas-y-seguridad.md` (`L17`), `docs/decisiones/riesgos.md` (`R08`) | **MEDIO** — El motor PostGIS ya soporta publicar una nueva versión de tarifa con el polígono definitivo. |
| N-04 | **Política operativa de despacho en producción (`operations_policies`)**: definir valores reales de `offerRadiusMeters`, `directOfferTtlSeconds`, `openOfferTtlSeconds`, `seekingTtlSeconds`, `maxOffersPerWave`, `locationFreshnessSeconds` y `trackingHoursAfterTerminal`. | `DUEÑO` | `docs/modelo-datos.md` (`L92`), `apps/api/src/policies/policies.controller.ts` | **MEDIO** — Determina los tiempos de respuesta y radio de búsqueda en calle. |
| N-05 | **Recaudo de suscripciones, medios de pago y conciliación contable**: en V1 el pago de suscripción opera mediante declaración manual (`subscription_payment_declarations`) reconocida por `OPERATIONS`; definir cuenta recaudadora o integración futura de pasarela y proceso contable. | `DUEÑO` | `docs/modelo-datos.md` (`L84`), `docs/pruebas-y-seguridad.md` (`L56`, `L135`) | **ALTO** — Decisión comercial y financiera del propietario. |

---

## 3. Lista Exacta de Variables de Entorno Requeridas en Production (Solo Nombres)

> **Regla de seguridad:** Esta tabla documenta **exclusivamente los nombres** de las variables de entorno requeridas para Production. Nunca se deben almacenar ni imprimir sus valores en el repositorio.

### 3.1 API (`@domigoo/api` — Runtime y Migraciones)

| Nombre de Variable | Obligatoria en Production | Propósito | Dónde se lee |
| --- | :---: | --- | --- |
| `NODE_ENV` | Sí (`production`) | Activa exigencia de secretos (`PIN_PEPPER`, `APP_ENCRYPTION_KEY`) y flag `Secure` en cookie `domigoo_session`. | `apps/api/src/config/env.ts` (`L29`) |
| `DATABASE_URL` | Sí | Cadena de conexión PostgreSQL 17 + PostGIS 3.5 para el pool de la API en tiempo de ejecución. | `apps/api/src/config/env.ts` (`L22`) |
| `DATABASE_URL_UNPOOLED` | Sí (en migraciones) | Cadena de conexión directa (sin pooler PgBouncer) para ejecutar `prisma migrate deploy` de forma segura. | `scripts/vercel-build.sh` (`L5-L13`) |
| `PIN_PEPPER` | Sí | Secreto criptográfico (32 bytes aleatorios en base64/hex) para `HMAC-SHA-256` de PIN de recogida y entrega. | `apps/api/src/config/env.ts` (`L37`, `L52-L61`) |
| `APP_ENCRYPTION_KEY` | Sí (o `DATA_ENCRYPTION_KEY`) | Clave simétrica de 32 bytes para cifrado `AES-256-GCM` de PINs activos y tokens de tracking. | `apps/api/src/config/env.ts` (`L38-L41`, `L63-L72`) |
| `DATA_ENCRYPTION_KEY` | Alternativa a `APP_ENCRYPTION_KEY` | Alias compatible en Vercel para la clave de cifrado `AES-256-GCM` de 32 bytes si no se define `APP_ENCRYPTION_KEY`. | `apps/api/src/config/env.ts` (`L39`) |
| `APP_NAME` | Recomendada | Nombre público del producto expuesto en OpenAPI y avisos. | `apps/api/src/config/env.ts` (`L27-L28`) |
| `PORT` | Opcional (default `3000`) | Puerto TCP de escucha cuando la API corre como servidor Node.js dedicado (`main.ts`). | `apps/api/src/config/env.ts` (`L34`, `L92-L104`) |
| `CORS_ORIGINS` | Recomendada | Lista separada por comas de orígenes permitidos para navegador (portales Web y Admin). | `apps/api/src/http.ts` (`L28`) |
| `STORAGE_DIR` | Solo si disco dedicado | Ruta de almacenamiento local de archivos (en producción debe sustituirse por adaptador de bucket privado; ver `D-06`). | `apps/api/src/config/env.ts` (`L36`, `L81-L90`) |
| `SEED_ADMIN_EMAIL` | Solo en bootstrap inicial | Correo del primer `SUPERADMIN` al ejecutar `apps/api/src/identity/seed-admin.ts` por única vez. | `apps/api/src/identity/seed-admin.ts` (`L4`) |
| `SEED_ADMIN_PASSWORD` | Solo en bootstrap inicial | Contraseña inicial (12–72 caracteres) del primer `SUPERADMIN` al ejecutar `seed-admin.ts` (retirar tras el alta). | `apps/api/src/identity/seed-admin.ts` (`L5`) |

### 3.2 Portales Web (`@domigoo/web`), Admin (`@domigoo/admin`) y App Móvil (`@domigoo/movil`)

| Componente | Nombre de Variable | Obligatoria en Production | Propósito | Dónde se lee |
| --- | --- | :---: | --- | --- |
| `@domigoo/web` | `API_BASE_URL` | Sí | URL base HTTPS de la API de producción consumida por los Route Handlers proxy de Next.js. | `apps/web/src/lib/env.ts` (`L3`) |
| `@domigoo/web` | `APP_NAME` | Recomendada | Nombre del producto renderizado en el portal de restaurantes y tracking. | `apps/web/src/lib/env.ts` (`L2`) |
| `@domigoo/admin` | `API_BASE_URL` | Sí | URL base HTTPS de la API de producción consumida por el portal de administración. | `apps/admin/src/lib/env.ts` (`L3`) |
| `@domigoo/admin` | `APP_NAME` | Recomendada | Nombre del producto renderizado en el portal de administración. | `apps/admin/src/lib/env.ts` (`L2`) |
| `@domigoo/movil` | `EXPO_PUBLIC_API_URL` | Sí | URL base HTTPS de la API de producción inyectada en el bundle de la app móvil Expo/Android. | `apps/movil/src/App.tsx`, `.env.staging.example` |
| `@domigoo/movil` | `EXPO_PUBLIC_APP_NAME` | Recomendada | Nombre público de la aplicación móvil. | `.env.staging.example` |

### 3.3 Variables que NUNCA deben existir en Production

| Nombre de Variable | Motivo de prohibición en Production |
| --- | --- |
| `DOMIGOO_ENV=staging` | Reservada exclusivamente para el entorno de staging. |
| `STAGING_SEED_CONFIRM` | Habilita la siembra de datos sintéticos (`seed:staging`). |
| `STAGING_SEED_PASSWORD` | Contraseña de cuentas ficticias de staging. |
| `STAGING_ALLOWED_DB_HOSTS` | Bypass de validación de host de base de datos de staging. |

---

## 4. Defectos Pequeños y Seguros Corregidos en M43

Durante la auditoría se aplicaron y probaron en esta misma rama (`chore/m43-production-readiness`) cuatro mejoras defensivas sin impacto disruptivo:

1. **Endurecimiento de cabeceras HTTP y CORS por allowlist ([`apps/api/src/http.ts`](../apps/api/src/http.ts)):**
   - Desactiva `x-powered-by` en Express y elimina la cabecera `X-Powered-By`.
   - Añade `X-Frame-Options: DENY` y `Referrer-Policy: no-referrer` además de `X-Content-Type-Options: nosniff`.
   - Implementa lista blanca de orígenes mediante `CORS_ORIGINS` sin reflejar orígenes en `/v1/tracking/*`.
   - Cubierto por pruebas unitarias en [`apps/api/src/http.spec.ts`](../apps/api/src/http.spec.ts).
2. **Validación de rangos geográficos WGS84 en cotización de tarifas ([`apps/api/src/tariffs/tariffs.controller.ts`](../apps/api/src/tariffs/tariffs.controller.ts)):**
   - `readPoint` ahora valida que `longitude` (`[-180, 180]`) y `latitude` (`[-90, 90]`) sean números finitos dentro de rango antes de consultar PostGIS.
   - Cubierto por pruebas unitarias en [`apps/api/src/tariffs/quote.spec.ts`](../apps/api/src/tariffs/quote.spec.ts).
3. **Ampliación de redacción de secretos y PII sensible en logs y diffs de auditoría ([`apps/api/src/audit/redact-diff.ts`](../apps/api/src/audit/redact-diff.ts), [`apps/api/src/identity/redact.ts`](../apps/api/src/identity/redact.ts)):**
   - Añade `pickupPinCiphertext`, `deliveryPinCiphertext`, `tokenCiphertext`, `pushToken` y `documentNumber` a las claves y patrones redactados.
   - Cubierto por pruebas unitarias en [`apps/api/src/identity/redact.spec.ts`](../apps/api/src/identity/redact.spec.ts).
4. **Pruebas unitarias de guardas de entorno de producción ([`apps/api/src/config/env.spec.ts`](../apps/api/src/config/env.spec.ts)):**
   - Verifica explícitamente que `NODE_ENV=production` exige `PIN_PEPPER` y `APP_ENCRYPTION_KEY` (o `DATA_ENCRYPTION_KEY`) y activa `cookieSecure: true`.
