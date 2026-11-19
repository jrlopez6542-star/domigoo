# M53 — Estado Inicial del Repositorio

- **Rama base**: `feat/m53-pantallas` (commit `ecf4ac3`, creada desde `Contabilidad` `387d33d`).
- **Modelo de negocio**: Conexión entre clientes, restaurantes y domiciliarios independientes en Tocancipá. Sin catálogo de productos, sin carrito y sin pagos integrados; el cliente paga la comida al restaurante y el domicilio directamente al domiciliario. DOMIGOO no maneja dinero ni cobra comisiones por pedido.

## Capacidades existentes que se reutilizan

| Módulo | Qué existe y se reutiliza en M53 | Ubicación |
| --- | --- | --- |
| **Pedidos y máquina de estados** | `Order`, `OrderStatus` (`DRAFT`, `SEEKING_COURIER`, `ACCEPTED`, `ARRIVING_PICKUP`, `AT_PICKUP`, `PICKED_UP`, `AT_DROPOFF`, `DELIVERED`, `CANCELLED`), `OrderEvent`, creación por restaurante (`POST /v1/orders`), publicación (`POST /v1/orders/:id/publish`), cancelación (`POST /v1/orders/:id/cancel`), transiciones del recorrido (`arrive-pickup`, `at-pickup`, `at-dropoff`). | `apps/api/src/orders/` |
| **Ofertas y concurrencia** | `DispatchOffer`, `GET /v1/offers/available`, `POST /v1/offers/:id/accept` (con `Idempotency-Key` y cerrojo transaccional), `POST /v1/offers/:id/decline`. En M53 se amplía `AvailableOfferItem` con distancia (`distanceKm`) y tiempo estimado (`etaMinutes`). | `apps/api/src/orders/offers.controller.ts`, `offers.repository.ts` |
| **PIN de recogida y entrega** | Generación cifrada (`pin-crypto.ts`), verificación `POST /v1/orders/:id/pickup-pin` y `delivery-pin`, conteo de intentos (`maxPinAttempts`) e incidente `PIN_LOCKOUT`. | `apps/api/src/orders/` |
| **Disponibilidad y ubicación de domiciliario** | `CourierAvailability` (`AVAILABLE`, `BUSY`, `OFFLINE`), `POST /v1/couriers/me/availability`, `POST /v1/couriers/me/location` con consentimiento M45 (`GEOLOCATION_CONSENT`) y `LocationPing`. | `apps/api/src/couriers/` |
| **Seguimiento público sin cuenta** | `TrackingLink` con token cifrado + hash SHA-256, expiración y revocación, `POST /v1/orders/:id/tracking-link`, `GET /v1/tracking/:token`, página `/tracking/[token]`. | `apps/api/src/tracking/`, `apps/web/src/app/tracking/[token]/page.tsx` |
| **Restaurantes y horarios** | `Restaurant`, `Establishment`, `Branch` (con punto PostGIS en Tocancipá), `BranchHour` (días ISO 1–7, minutos de apertura/cierre) y cálculo horario en `America/Bogota` (`bogota-time.ts`). | `apps/api/src/restaurants/`, `apps/api/src/tariffs/bogota-time.ts` |
| **Tarifas y cobertura Tocancipá** | `POST /v1/tariffs/quote`, `validateTocancipaCoverage` con GeoJSON oficial de Tocancipá (`25817`). | `apps/api/src/tariffs/`, `apps/api/src/geo/` |
| **Admin** | `GET /v1/admin/stats` (conteos sin PII), suspensión/rehabilitación de restaurantes y domiciliarios, casos de verificación (`verification-admin.controller.ts`). | `apps/api/src/admin/`, `apps/api/src/verification/` |
| **Identidad, consentimientos M45 y marca** | Sesiones por cookie `httpOnly` (web/admin) y Bearer (móvil), `ConsentRecord`, `@domigoo/brand` (`logo-v2` SVG en `docs/brand/logo-v2/` y `tokens.css`). | `apps/api/src/identity/`, `packages/brand/` |

## Hallazgos heredados de M52

- En `apps/web/src/app/api/proxy/[...path]/route.ts`, las respuestas `204 No Content` (como `POST /v1/auth/logout`) arrojaban `TypeError: Response constructor: Invalid response status code 204` al pasar un cuerpo vacío `""` a `new NextResponse(...)`. Como `feat/m53-pantallas` parte de `387d33d` (previo a M52), esta corrección se incorpora en M53 devolviendo cuerpo `null` para estados `204`, `205` y `304`.
- La cancelación (`POST /v1/orders/:id/cancel`) ya existe en la API y se expone en el panel del restaurante en M53 para cancelar pedidos en `SEEKING_COURIER` cuando ningún domiciliario lo ha tomado.
- `apps/simulacros/m52-informe.md` no existe aún en esta rama base (reside en `test/m52-simulacros`), por lo que la referencia documentada aquí resume sus hallazgos clave.

## Decisiones técnicas M53

- **Tiempo casi real (Polling vs SSE)**: Se eligió **polling controlado cada 5 s** en seguimiento público (`/tracking/[token]`) y tablero de solicitudes del restaurante, y **cada 10 s** en ofertas del domiciliario. Motivo: el proxy web (`apps/web/src/app/api/proxy/[...path]/route.ts`) opera sobre Next.js App Router y despliegues serverless en Vercel, donde conexiones SSE prolongadas sufren cortes por timeout de función; el polling HTTP corto funciona de forma idempotente sin estado de conexión y con bajo tráfico en Tocancipá.
- **Mapa gratuito sin claves ni servicios pagos**: Se usa el embed estándar de **OpenStreetMap** (`https://www.openstreetmap.org/export/embed.html`) para visualizar la ubicación en vivo durante el seguimiento, y enlaces directos a **Google Maps** (`maps.google.com/?q=lat,lng`) y **Waze** (`waze.com/ul?ll=lat,lng&navigate=yes`) para navegación del domiciliario. No requiere claves API, cuentas externas ni tecnologías pagas.

