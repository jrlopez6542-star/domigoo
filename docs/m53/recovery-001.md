# M53-RECOVERY-001: Resumen de recuperación, causas raíz y cierre

Rama: `feat/m53-pantallas` (PR #49 borrador hacia `Contabilidad`).

## 1. Causas raíz y correcciones por commit

- **`264249a` / `0cd98bc`** (`M53-RECOVERY-001` base):
  - **Tracking público**: se eliminaron `foodAmountCop`, `deliveryFeeCop`, `courierPhone`, `dropoffAddress` y `dropoffLocation` de `PublicTrackingView` y `ClaimedOrderItem`, manteniendo el enlace público sin exposición de datos sensibles.
  - **Admin roles / OpenAPI / ESM**: se corrigió `user_roles` → `admin_profiles` en `apps/api/test/m53-pantallas.e2e-spec.ts`, se ajustó el contrato OpenAPI en `system.e2e-spec.ts` y se reemplazó `__dirname` por `import.meta.url` en pruebas móviles.
- **`a2439f5`**:
  - **CI y Smoke Preview**: se restringió el trigger `push` de CI a `[Contabilidad]`, se agregó `concurrency` por rama y se filtró `scripts/wait-vercel-preview.mjs` al proyecto `name === "domigoo"`.
- **`2986552`**:
  - **Documentación de despliegues**: se documentó en [`docs/despliegues.md`](../despliegues.md) el flujo Hobby de Vercel (100/día, 1 build simultáneo) y la propuesta para commits exclusivos de documentación.
- **`700aef9`**:
  - **UUIDs inválidos**: se agregó `ParseUUIDPipe` en rutas `:id`/`:userId` de restaurantes, sucursales y admin para responder `400` en lugar de `500` cuando llega un UUID inválido, y se corrigió `restRes.body.id` en `m53-pantallas.e2e-spec.ts`.
  - **Layout móvil y navegación**: se compactó `.dg-auth-form` para `360x780`, se pasó `sessionUser`/`onLogout` en `ClientPortalShell` y se ajustó la navegación de ofertas.
- **`c5e6eb3`** (`M53-FIX-CI-700aef9`):
  - **Consentimiento de geolocalización**: en `m53-pantallas.e2e-spec.ts`, se publicó el documento `GEOLOCATION_CONSENT` y se registró el consentimiento (`purpose: "GEOLOCATION"`, `channel: "MOBILE"`) antes de `POST /v1/couriers/me/availability`.
  - **React hooks y estados vacíos**: se movió `navItemsWithBadge = useMemo(...)` antes de los `return` tempranos en `CourierPortalShell` (evitando crash al iniciar sesión), se protegieron `restaurants`/`orders` con `Array.isArray(...)` en `client-portal.tsx`, se agregó `overflowWrap: "anywhere"` al correo en `/cliente/cuenta` y se dejó un único botón `"Cerrar sesión"` en `.dg-role-topbar`.
  - **Área táctil móvil**: se subió el padding vertical de `.dg-inline-link` a `16px 0` (`>= 44px`).
- **`bec1482`** (`M53-FIX-CI-c5e6eb3`):
  - **Precondiciones de `publishOpen`**: en `m53-pantallas.e2e-spec.ts`, se agregaron suscripción activa (`ACTIVE`), política operativa publicada (`PUBLISHED`), tarifa publicada coincidente (`6500` COP), vehículo activo (`MOTORCYCLE`) y los 6 documentos `ACCEPTED` exigidos por `CANDIDATE_SQL`.
  - **Barra inferior de domiciliario**: se restauró `Entrega` (`/domiciliario/entrega`, `nav-domiciliario-entrega`) en `COURIER_NAV_ITEMS`, se ajustó la grilla a 7 columnas en `role-panel-shell.tsx` + `domigoo.css`, y se restauró `"No hay ofertas por ahora."` en `courier-no-offers`.
- **`a6f25a0`** (`M53-FIX-CI-bec1482`):
  - **Admin inicial**: se mostró `#admin-suscripciones` (`Reconocer declaración de pago`) en `dashboard` además de `verificaciones` en `admin-portal.tsx`.
- **`b603187`** (`M53-CIERRE-44PX`):
  - **Áreas táctiles `>= 44px`**: `min-height: 44px` con `inline-flex` en `.dg-v2-auth-link` (inicio), `.dg-card:has(.dg-auth-form) .dg-input` (login/registro móvil) y `.adm-nav-item` (menú admin).

## 2. Resultados reales de CI

- **Run `44443404987` (`700aef9`)**: `Contrato`, `PostGIS`, `typecheck y lint` y `Smoke Vercel Preview` en verde; `API` con 1 fallo (`availability` 422 por orden de consentimiento) y `Playwright Web y Admin` con 7 fallos.
- **Run `44452030933` (`c5e6eb3`)**: `API` **129/130** (solo `publishOpen` 422 por precondiciones); `Playwright Web` **17/18** (solo `nav-domiciliario-entrega-bottom`).
- **Run `44540142173` (`bec1482`)**: `API` **130/130 PASS**, `Playwright Web` **18/18 PASS** (1 skipped); quedó 1 fallo en `apps/admin` (`admin.spec.ts:7`).
- **CI de `a6f25a0`**: **TODO VERDE** (API, Playwright Web y Playwright Admin).
- **Validación local de `b603187`**: `pnpm lint` PASS, `pnpm typecheck` PASS, unit tests `@domigoo/web` (4/4) y `@domigoo/admin` (3/3) PASS, builds `web` y `admin` PASS, verificación Chromium headless en `390x844`, `360x780` y `1280x800` con `>= 44px` y `overflow: false` PASS.

## 3. Propuesta para evitar despliegues de las 3 apps en cambios solo de documentación

> **Solo propuesta**: no se modificó `vercel.json` ni la configuración en el dashboard de Vercel.

- Actualmente `domigoo-web` (`apps/web`) y `domigoo-admin` (`apps/admin`) omiten despliegues cuando los cambios son solo en `docs/`, pero `domigoo` (API) tiene su `Root Directory` en la raíz del repositorio (`.`), por lo que cualquier cambio en `docs/` dispara un despliegue en Vercel.
- **Recomendación**: mover el `Root Directory` de `domigoo` a `apps/api` en la configuración del proyecto en Vercel (habilitando *Include source files outside of the Root Directory* para `packages/*` y `scripts/vercel-build.sh`). No usar `ignoreCommand`, ya que los builds cancelados mediante *Ignored Build Step* sí consumen cuota del plan Hobby (100/día). Mientras tanto, mantener commits exclusivos de `docs/` al final de cada ronda.
