# Auditoría Técnica ARC-001 (M51)

**Fecha:** 2026-11-17  
**Rama de auditoría:** `fix/m51-auditoria` (base: `Contabilidad` en `1eb74de`, considerando también los cambios de aislamiento web en curso en PR #46)  
**Criterio:** Cada hallazgo se clasifica estrictamente en **CONFIRMADO** (reproducido en código o prueba) o **RIESGO HIPOTÉTICO** (brecha potencial o dependencia operativa sin fallo observado). Ningún control de seguridad fue removido ni se omitieron pruebas.

---

## 1. Tabla Resumen de Hallazgos

| Tema | Hallazgo | Confirmado / Hipotético | Severidad | Estado |
| --- | --- | :---: | :---: | --- |
| 1. Aislamiento entre roles y admin | En `Contabilidad` (`1eb74de`), la web carecía de separación completa por pantallas/sesión de rol (corregido en PR #46 `feat/m49-pantallas-rol`); en la API todos los endpoints de restaurante, domiciliario y admin validan membresía/perfil en BD (`401`/`403`/`404`). | Confirmado (web en `Contabilidad`) | Alta | Corregido en PR #46 (`feat/m49-pantallas-rol`, pendiente de merge) |
| 2. Autenticación y sesiones | Cookies `HttpOnly`, `SameSite=Lax`, `Secure` en producción, `Argon2id` y tokens SHA-256 con TTL fijo de 14 días (`MAX_AGE_SECONDS`). No existe *sliding refresh* ni *idle timeout* corto para sesiones inactivas. | Hipotético | Media | Pendiente (decisión de producto) |
| 3. Rate limiting (tracking público) | `RateLimitGuard.resolvePolicy` (`rate-limit.guard.ts`) devolvía `null` para `GET /v1/tracking/:token`, dejando el seguimiento público sin límite distribuido por IP. | Confirmado | Alta | **Corregido con PR y prueba** (`fix/m51-auditoria`, `rate-limit.guard.spec.ts`, `hardening.e2e-spec.ts`) |
| 4. Rate limiting (IP en registro) | `AuthController.register` (`auth.controller.ts:43`) leía `request.ip` en lugar de `extractClientIp(request)`, registrando la IP del proxy Next.js en lugar de la IP real del cliente (`x-domigoo-client-ip`). | Confirmado | Media | **Corregido con PR y prueba** (`fix/m51-auditoria`, `auth.controller.spec.ts`) |
| 5. Seguimiento público de pedidos | Usa token CSPRNG de 32 bytes (`base64url`), hash SHA-256, `noindex`/`no-referrer`/`no-store`, sin CORS reflejado y sin PII sensible ni montos. Con rate limit agregado se mitiga enumeración. | Confirmado (control sólido) | Baja | Cubierto (`tracking.e2e-spec.ts` + rate limit en `fix/m51-auditoria`) |
| 6. Almacenamiento de archivos | `StorageModule` ya usa `PostgresObjectStorage` por defecto con límite de 10 MB, verificación de *magic bytes* y descarga autenticada (`SessionGuard`). En `apps/web` el proxy usaba `request.text()`, lo que corrompe binarios `multipart/form-data`. | Confirmado (proxy web) | Media | **Corregido con PR** (`apps/web/src/app/api/proxy/[...path]/route.ts`) |
| 7. Notificaciones FCM | `FcmPushSender` (`push-sender.port.ts:43`) apunta a la API heredada `https://fcm.googleapis.com/fcm/send` (dada de baja por Google en junio de 2024 en favor de FCM HTTP v1 OAuth2). Sin `FCM_SERVER_KEY` cae silenciosamente a `RecordingPushSender` en memoria y no hay worker automático que drene `notification_outbox`. | Confirmado | Alta | **Requiere dueño** (credenciales Firebase / cuenta de servicio FCM HTTP v1) + migración a HTTP v1 |
| 8. Observabilidad, logs y manejo de errores | `redact` y `redactDiff` enmascaran secretos y PII, y `main.ts` oculta cadenas `postgres://`. Sin embargo, el proxy web (`apps/web/.../proxy/[...path]/route.ts`) carecía de `try/catch` en `fetch` (500 no controlado) y validación de segmentos `..`. No hay APM/alertas 5xx centralizadas. | Confirmado (proxy web) / Hipotético (APM) | Media | Proxy web **corregido con PR**; APM centralizado pendiente |
| 9. Recuperación ante fallos | `MaintenanceController` + Vercel Cron (`0 3 * * *`) purgan sesiones, buckets y pings > 90 días, pero `MaintenanceService.runMaintenance()` solo expira `dispatch_offers` y no transiciona órdenes `SEEKING_COURIER` vencidas (como sí hace `ExpirationRepository.expireStale`). Frecuencia diaria (24 h) es lenta para olas de 120 s. | Confirmado | Media | Pendiente (invocar `ExpirationRepository.expireStale` con mayor frecuencia) |
| 10. Concurrencia y consistencia de pedidos | `OffersRepository.accept` usa `BEGIN`, `FOR UPDATE` sobre `courier_availabilities`, `orders` y `dispatch_offers`, e índices únicos parciales (`dispatch_offers_one_accepted`, `orders_one_active_per_courier`). | Confirmado (control sólido) | Baja | Cubierto (`offers-concurrency.spec.ts`, `open-offer.e2e-spec.ts`) |
| 11. Integridad de datos (PIN ciphertexts) | `JourneyRepository` (`verifyPinByCourier`, `cancelOrder`, `failOrder`) y `ExpirationRepository.expireStale` no limpiaban `pickupPinCiphertext` ni `deliveryPinCiphertext` al llegar a `PICKED_UP` o estados terminales, contradiciendo el control `S-09` de `PRODUCTION_READINESS.md`. | Confirmado | Media | **Corregido con PR y prueba** (`fix/m51-auditoria`, `journey.spec.ts`, `pins.e2e-spec.ts`) |
| 12. Contrato API vs OpenAPI vs Web/Admin | Swagger/OpenAPI en `openapi.ts` y pruebas en `client-contracts.e2e-spec.ts` cubren los flujos base; `apps/web` y `apps/admin` consumen `/api/proxy/*`. El contrato de `GET /v1/offers/available` y `GET /v1/branches/mine` vive en PR #46. | Hipotético (desfase entre ramas) | Baja | Monitorear tras merge de PR #46 |
| 13. Dependencias vulnerables (`pnpm audit`) | `pnpm audit` reporta `0` críticas, `9` altas y `5` moderadas (`0` vulnerabilidades en `@domigoo/api` producción). En prod de `apps/admin` aparece `sharp <0.35.5` (transitiva de `next`); en `apps/movil` aparecen `image-size`, `uuid`, `picomatch`, `glob`, `minimatch` (herramientas de build Expo/Metro); en dev `playwright <1.55.1`. | Confirmado | Media | Pendiente (actualizaciones mayores/transitivas de `next`/`expo`/`playwright` fuera de parche menor sin riesgo) |
| 14. Configuración Prod vs Preview y Docs desactualizadas | `docs/PRODUCTION_READINESS.md` seguía fechado en M43→M44 (`LocalObjectStorage` y `login-throttle` en memoria marcados como `FALTA` aunque M47 ya los migró a Postgres, y `S-09` marcado `OK` sin implementarse). `docs/estado-del-proyecto.md` seguía en M39. | Confirmado | Media | **Corregido con PR** (`docs/PRODUCTION_READINESS.md` actualizado) |

---

## 2. Detalle de Hallazgos Confirmados y Correcciones

### 2.1 Rate limiting faltante en `GET /v1/tracking/:token`
- **Causa raíz:** En [`apps/api/src/rate-limit/rate-limit.guard.ts`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/src/rate-limit/rate-limit.guard.ts), `resolvePolicy(path, method)` solo contemplaba `/v1/auth/*`, `/v1/couriers/me/documents`, `/v1/data-subject-requests` y `pickup-pin`/`delivery-pin`, devolviendo `null` para `GET /v1/tracking/:token`.
- **Corrección:** Se agregó la política `bucket: "tracking"` para `GET /^\/v1\/tracking\/[^/]+$/` con límite configurable `RATE_LIMIT_TRACKING_MAX` (por defecto `60` por ventana).
- **Prueba:** [`rate-limit.guard.spec.ts`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/src/rate-limit/rate-limit.guard.spec.ts) (`resolvePolicy`) y [`hardening.e2e-spec.ts`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/test/hardening.e2e-spec.ts) verifican respuesta `429` y cabecera `Retry-After`.

### 2.2 Extracción de IP en `POST /v1/auth/register`
- **Causa raíz:** [`AuthController.register`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/src/identity/auth.controller.ts#L40-L46) leía `request.ip` directamente en vez de usar `extractClientIp(request)`, a diferencia de `login()`. Detrás del proxy de Next.js (`x-domigoo-client-ip` + `x-domigoo-proxy-secret`), los consentimientos iniciales quedaban registrados con la IP del servidor proxy.
- **Corrección:** Se actualizó `register()` para usar `extractClientIp(request)`.
- **Prueba:** [`auth.controller.spec.ts`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/src/identity/auth.controller.spec.ts) comprueba que la IP propagada al servicio es la de `x-domigoo-client-ip` cuando el secreto del proxy coincide.

### 2.3 Limpieza de ciphertexts de PIN al llegar a `PICKED_UP` y estados terminales
- **Causa raíz:** [`JourneyRepository`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/src/orders/journey.repository.ts) (`verifyPinByCourier`, `cancelOrder`, `failOrder`) y [`ExpirationRepository.expireStale`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/src/orders/expiration.repository.ts) actualizaban el estado de la orden pero dejaban `"pickupPinCiphertext"` y `"deliveryPinCiphertext"` intactos en PostgreSQL.
- **Corrección:** Al pasar a `PICKED_UP` se limpia `"pickupPinCiphertext" = NULL`; al pasar a `DELIVERED`, `CANCELLED_*`, `FAILED` o `EXPIRED` se limpian ambos (`"pickupPinCiphertext" = NULL, "deliveryPinCiphertext" = NULL`).
- **Prueba:** [`journey.spec.ts`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/src/orders/journey.spec.ts) y [`pins.e2e-spec.ts`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/test/pins.e2e-spec.ts).

### 2.4 Proxy web (`apps/web/src/app/api/proxy/[...path]/route.ts`)
- **Causa raíz:** A diferencia de `apps/admin`, el proxy de `apps/web` no capturaba fallos de red en `fetch` (generando HTTP 500 sin formato), leía el cuerpo con `request.text()` (corrompiendo cargas binarias `multipart/form-data`) y no bloqueaba segmentos `..` en `path`.
- **Corrección:** Validación de segmentos `..`/`.`/`\`, uso de `request.arrayBuffer()` y `try/catch` con respuesta JSON `502`.

### 2.5 Notificaciones FCM (`apps/api/src/notifications/push-sender.port.ts`)
- **Hallazgo confirmado:** [`FcmPushSender`](file:///home/antigravity/jrlopez6542-star/domigoo/apps/api/src/notifications/push-sender.port.ts#L36-L58) utiliza el endpoint heredado `https://fcm.googleapis.com/fcm/send` con `Authorization: key=...`, dado de baja por Google en junio de 2024. Sin `FCM_SERVER_KEY`, `createPushSenderFromEnv()` usa `RecordingPushSender` en memoria y no falla ni persiste errores. Requiere credenciales de cuenta de servicio Firebase del dueño y migración a FCM HTTP v1 antes de habilitar notificaciones push en producción.
