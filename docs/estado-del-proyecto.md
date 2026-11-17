# Estado del proyecto

Fecha: 2026-11-16. El nombre DOMIGOO es provisional y sale de `APP_NAME`. Este documento no afirma marca ni dominio.

La suite de la API, con M25, tiene **61 pruebas**. En CI el job API del run [43947472063](https://github.com/jrlopez6542-star/domigoo/actions/runs/43947472063) repitió `Tests: 61 passed`.

## Hecho

La fase 0 y las misiones M01–M14 entraron juntas a `Contabilidad` en el PR #17 (merge `f89506f`). Los PR #2–#16 fueron los de la pila original; varios se cerraron cuando se borraron las ramas base. El código que quedó es el de #17.

| Misión | PR | Entrega |
| --- | --- | --- |
| Fase 0 | [#1](https://github.com/jrlopez6542-star/domigoo/pull/1) | Arquitectura, modelo, máquinas, plan, pruebas y ADR. |
| M01 | [#2](https://github.com/jrlopez6542-star/domigoo/pull/2) | Monorepo pnpm, TypeScript estricto, lint y CI sin secretos. |
| M02 | [#3](https://github.com/jrlopez6542-star/domigoo/pull/3) | PostGIS 17-3.5 en local y en CI. |
| M03 | [#4](https://github.com/jrlopez6542-star/domigoo/pull/4) | API Nest con `/health`, `/ready` y OpenAPI. |
| M04 | [#5](https://github.com/jrlopez6542-star/domigoo/pull/5) | Migración del contrato, incluida `CREATE EXTENSION IF NOT EXISTS postgis`. |
| M05 | [#6](https://github.com/jrlopez6542-star/domigoo/pull/6) | Cuenta y sesión con Argon2id. El token se guarda hasheado. |
| M06 | [#7](https://github.com/jrlopez6542-star/domigoo/pull/7) | Membresía de restaurante y perfil admin. |
| M07 | [#8](https://github.com/jrlopez6542-star/domigoo/pull/8) | Auditoría de identidad sin secretos en el diff. |
| M08 | [#9](https://github.com/jrlopez6542-star/domigoo/pull/9) | Avisos legales y consentimiento revocable. |
| M09 | [#10](https://github.com/jrlopez6542-star/domigoo/pull/10) | Semilla local de superadmin, sin clave en el repo. |
| M10 | [#11](https://github.com/jrlopez6542-star/domigoo/pull/11) | Restaurante, establecimiento y sucursal con punto. |
| M11 | [#12](https://github.com/jrlopez6542-star/domigoo/pull/12) | Horario y activación de sucursal y restaurante. |
| M12 | [#13](https://github.com/jrlopez6542-star/domigoo/pull/13) | Tarifas y cotización en pesos enteros. |
| M13 | [#14](https://github.com/jrlopez6542-star/domigoo/pull/14) | Política operativa publicada, con frescura de la posición. |
| M14 | [#15](https://github.com/jrlopez6542-star/domigoo/pull/15) | Suscripción sin pasarela. |
| M15 | [#19](https://github.com/jrlopez6542-star/domigoo/pull/19) | Registro abierto del domiciliario en `REGISTERING`. |
| M16 | [#18](https://github.com/jrlopez6542-star/domigoo/pull/18) | Invitación con token hasheado. |
| M17 | [#20](https://github.com/jrlopez6542-star/domigoo/pull/20) | Motocicleta y documentos en disco local, sin URL pública. |
| M18 | [#21](https://github.com/jrlopez6542-star/domigoo/pull/21) | Reglas automáticas. Ninguna escribe `APPROVED`. |
| M19 | [#22](https://github.com/jrlopez6542-star/domigoo/pull/22) | Decisión humana auditada. |
| M20 | [#23](https://github.com/jrlopez6542-star/domigoo/pull/23) | Disponibilidad, ping y radio. La lista no lee el historial de pings. |
| M21 | [#24](https://github.com/jrlopez6542-star/domigoo/pull/24) | Borrador con comida y domicilio separados, y máquina pura del pedido. |
| M22 | [#25](https://github.com/jrlopez6542-star/domigoo/pull/25) | Publicación directa. Los seis documentos tienen que estar `ACCEPTED`. La cotización queda congelada. |
| M23 | [#26](https://github.com/jrlopez6542-star/domigoo/pull/26) | Ola abierta, aceptación exclusiva e idempotencia. Merge `4c15ac6`. |
| Preview | [#27](https://github.com/jrlopez6542-star/domigoo/pull/27) | API Nest en el preview de Vercel. Migra solo Preview con `DATABASE_URL_UNPOOLED`. |
| Estado | [#28](https://github.com/jrlopez6542-star/domigoo/pull/28) | Este inventario. |
| M24 | `reconcile/m39-contabilidad` | Recorrido del pedido y `order_events` en `OrdersController` / `journey.repository.ts` (unificado sobre PR #29). |
| M25 | `reconcile/m39-contabilidad` | PIN de recogida y entrega cifrado con HMAC + AES-256-GCM y `PIN_LOCKOUT` (unificado sobre PR #30). |
| M26 | `reconcile/m39-contabilidad` | Cancelación y vencimiento idempotente de pedidos y ofertas (`ExpirationRepository`). |
| M27 | `reconcile/m39-contabilidad` | Enlace público de tracking (`noindex`, `no-referrer`, SHA-256). |
| M28 | `reconcile/m39-contabilidad` | Puerto `PushSender` y `notification_outbox`. |
| M29–M30 | `reconcile/m39-contabilidad` | Web de restaurantes (`@domigoo/web`) y página pública de tracking. |
| M31 | `reconcile/m39-contabilidad` | Panel administrativo (`@domigoo/admin`) de verificación, declaraciones y estadísticas. |
| M32–M33 | `reconcile/m39-contabilidad` | App del domiciliario (`@domigoo/movil`, Android): sesión, disponibilidad, ofertas, recorrido y PIN. |
| M34 | `reconcile/m39-contabilidad` | Incidentes append-only y transición a `FAILED` con incidente `CRITICAL`. |
| M35 | `reconcile/m39-contabilidad` | Suspensiones y rehabilitaciones de domiciliarios y restaurantes. |
| M36 | `reconcile/m39-contabilidad` | Estadísticas operativas agregadas sin PII ni PIN. |
| M37 | `reconcile/m39-contabilidad` | Solicitudes de habeas data, revocación GPS y anonimización. |
| M38 | `reconcile/m39-contabilidad` | Recorrido completo E2E de punta a punta (`e2e-full-flow.e2e-spec.ts`). |
| M39 | `reconcile/m39-contabilidad` | Alineación de contratos HTTP, `POST /v1/tariffs/quote`, `client-contracts.e2e-spec.ts` y CI Playwright. |

## En curso

La rama `reconcile/m39-contabilidad` unifica M24–M39 con `origin/Contabilidad` (incluidos PR #27–#30) mediante Pull Request hacia `Contabilidad`.

## Lo que falta

- Validación final en CI de `reconcile/m39-contabilidad` y revisión/merge del Pull Request hacia `Contabilidad`.
- Despliegue controlado a staging y pendientes operativos del dueño (listados abajo).

El detalle de cada ficha está en [plan-misiones.md](plan-misiones.md).

## Entorno

El proyecto de Vercel se llama `domigoo`. La rama de producción es `Contabilidad`. Los deployments usan Vercel Authentication.

Al vincular el repositorio se creó un deployment de producción. No se usa y no tiene base de datos. No hay que tratarlo como un entorno operativo.

La base Neon `domigoo-preview` (plan Free, región `iad1`) está conectada solo a Preview y Development. Production no la usa. PostGIS no venía habilitado; la migración inicial ejecuta `CREATE EXTENSION IF NOT EXISTS postgis` y el build de Preview ya aplicó esa migración.

Turso no se usa. Es SQLite/libSQL y este sistema necesita PostgreSQL con PostGIS.

CI sigue en GitHub Actions, con PostGIS propio. No depende de Neon ni de Vercel.

## Riesgos abiertos

- El límite de intentos de ingreso vive en memoria. Tiene que pasar a PostgreSQL antes de una segunda réplica. ADR-004 prohíbe esa réplica mientras tanto.
- El polígono de tarifas es de desarrollo, no el límite municipal de Tocancipá.
- El runner `ubuntu-latest` avisa que migrará a Ubuntu 26. No tumba el job.
- TypeScript 7 no entra: `typescript-eslint` 8.72 exige una versión anterior a 6.1. El repo usa 6.0.3.
- Cada merge a `Contabilidad` dispara un deployment de producción en Vercel. Ese deployment está protegido y no tiene base. No es una publicación de la app.
- La API ya no arranca sin `PIN_PEPPER` ni `DATA_ENCRYPTION_KEY` (32 bytes en base64). Este repositorio no guarda esos valores. Preview y el deployment de producción quedan sin atender peticiones hasta que el dueño los defina en Vercel. El build sigue compilando y, en Preview, migrando.

## Pendientes del dueño

Estos puntos no los resuelve el equipo de implementación:

- Precios reales de la suscripción y del domicilio.
- El polígono oficial de Tocancipá.
- Revisión legal del texto de privacidad y de habeas data.
- Credenciales de Firebase/FCM y las de producción.
- Generar `PIN_PEPPER` y `DATA_ENCRYPTION_KEY` y cargarlas en Preview. No van al repositorio.
- Verificación de la marca y del dominio. DOMIGOO sigue siendo un nombre provisional.
- Publicación de las apps.
- Pagos. El sistema registra medios y no cobra.
