# Estado del proyecto

Fecha: 2026-11-16. El nombre DOMIGOO es provisional y sale de `APP_NAME`. Este documento no afirma marca ni dominio.

La suite de la API, con M24, tiene **52 pruebas**. En CI el job API del run [43941218385](https://github.com/jrlopez6542-star/domigoo/actions/runs/43941218385) repitió `Tests: 52 passed`.

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
| M24 | [#29](https://github.com/jrlopez6542-star/domigoo/pull/29) | Recorrido: camino a la sucursal, llegada y camino al destino, con historial. |

## En curso

El PR [#29](https://github.com/jrlopez6542-star/domigoo/pull/29) lleva M24. El CI de esa rama ya pasó. Falta que se fusione en `Contabilidad`.

## Lo que falta

Fase 5, todavía abierta:

- M25. PIN de recogida y de entrega.
- M26. Cancelación y vencimiento.

Fase 6. Superficies:

- M27. Enlace de tracking.
- M28. Puerto de push.
- M29. Web de restaurantes.
- M30. Página de tracking.
- M31. Admin de verificación y suscripciones.
- M32. App del domiciliario: sesión, disponibilidad y ofertas.
- M33. App del domiciliario: recorrido y PIN.

Fase 7. Cierre operativo:

- M34. Incidentes.
- M35. Suspensión.
- M36. Estadísticas.
- M37. Solicitudes de habeas data.
- M38. Recorrido de punta a punta y abusos básicos.

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

## Pendientes del dueño

Estos puntos no los resuelve el equipo de implementación:

- Precios reales de la suscripción y del domicilio.
- El polígono oficial de Tocancipá.
- Revisión legal del texto de privacidad y de habeas data.
- Credenciales de Firebase/FCM y las de producción.
- Verificación de la marca y del dominio. DOMIGOO sigue siendo un nombre provisional.
- Publicación de las apps.
- Pagos. El sistema registra medios y no cobra.
