# Informe de Simulacros Automáticos — M52

- **Rama**: `test/m52-simulacros` (desde `Contabilidad` / `feat/m49-pantallas-rol`)
- **Modelo de negocio**: El cliente paga la comida al restaurante y el domicilio al domiciliario. DOMIGOO no maneja dinero ni procesa cobros.
- **Datos**: 100 % ficticios (`sim-m52-*@ejemplo.com`, teléfonos `+5730000052xx`, direcciones ficticias en Tocancipá).
- **Cobertura**:
  - Semilla y reinicio idempotente con guardas anti-producción: [`simulacros-seed.ts`](../../apps/api/src/staging/simulacros-seed.ts), [`simulacros-reset.ts`](../../apps/api/src/staging/simulacros-reset.ts), [`simulacros-guard.ts`](../../apps/api/src/staging/simulacros-guard.ts).
  - Pruebas de integración API (NestJS + PostGIS): [`simulacros-m52.e2e-spec.ts`](../../apps/api/test/simulacros-m52.e2e-spec.ts).
  - Pruebas móviles E2E en Playwright (`mobile-iphone-13` 390x844 y `mobile-android-360` 360x780): [`simulacros-m52.mobile.spec.ts`](../../apps/web/tests/simulacros-m52.mobile.spec.ts).

## Matriz de escenarios (a–h)

| Escenario | Resultado | Evidencia | Bugs encontrados / Observaciones |
| --- | --- | --- | --- |
| **a) Camino feliz** (pedido nace, restaurante publica, domiciliario acepta, PIN recogida, en camino, PIN entrega, entregado; cliente ve cada estado y enlace público) | Cubierto (API + Playwright móvil 390x844 y 360x780) | `simulacros-m52.e2e-spec.ts`, `simulacros-m52.mobile.spec.ts`, capturas `01` a `09` en `docs/capturas/m52-simulacros/` | Sin bugs en el flujo actual. El catálogo/carrito de cliente sigue pendiente para M50; el cliente sigue el pedido por `/cliente/seguir` y `/tracking/[token]`. |
| **b) Domiciliario rechaza oferta y otro la acepta** | Cubierto (API + Playwright móvil) | `simulacros-m52.e2e-spec.ts`, `simulacros-m52.mobile.spec.ts`, captura `10-rechazo-y-segundo-domiciliario.png` | Sin bugs. |
| **c) Concurrencia: dos domiciliarios aceptan casi al mismo tiempo** | Cubierto (API) | `simulacros-m52.e2e-spec.ts` (`Promise.all` sobre `POST /v1/offers/:id/accept`) | Uno recibe `201 ACCEPTED` y el otro `409 Conflict` (`"La oferta ya no se puede aceptar"`). |
| **d) PIN incorrecto en recogida y en entrega + límite de intentos** | Cubierto (API + Playwright móvil) | `simulacros-m52.mobile.spec.ts` (captura `05-domiciliario-pin-recogida-invalido.png`) y `simulacros-m52.e2e-spec.ts` (5 intentos fallidos + bloqueo `422`/`423` + incidente `PIN_LOCKOUT`) | Sin bugs. El estado no avanza con PIN incorrecto y tras `maxPinAttempts` (5) bloquea nuevos intentos incluso con el PIN correcto (`422`/`423`). |
| **e) Cancelación en estado permitido y bloqueo posterior** | Cubierto (API + verificación UI en tracking) | `simulacros-m52.e2e-spec.ts`, `simulacros-m52.mobile.spec.ts` (captura `11-pedido-cancelado-tracking.png`) | Observación: la cancelación (`POST /v1/orders/:id/cancel`) existe en la API, pero aún no tiene botón en la interfaz web; tras cancelar, ningún rol puede avanzar el pedido (`422`). |
| **f) Sin domiciliarios disponibles** | Cubierto (API) | `simulacros-m52.e2e-spec.ts` | Comportamiento actual documentado: si todos los domiciliarios elegibles rechazan la oferta, el pedido permanece en `SEEKING_COURIER` y restaurante/cliente lo ven buscando. Si no hay ningún domiciliario disponible al momento de publicar en modo `OPEN`, `POST /v1/orders/:id/publish` responde `422` y el pedido queda en `DRAFT` (no se inventó nueva regla). |
| **g) Aislamiento entre roles (403/404)** | Cubierto (API + Playwright) | `simulacros-m52.e2e-spec.ts`, `simulacros-m52.mobile.spec.ts` | Cliente, otro restaurante y domiciliario no asignado reciben `403`/`404` sin filtrar datos al intentar ver o modificar pedidos/ofertas ajenas. |
| **h) Enlace público de seguimiento inválido o vencido** | Cubierto (API + Playwright móvil) | `simulacros-m52.e2e-spec.ts`, `simulacros-m52.mobile.spec.ts` (captura `12-tracking-invalido.png`) | Token inválido, revocado o vencido devuelve `404` en API y muestra `"Enlace de seguimiento no disponible"` sin filtrar datos ni PIN. |

## Ejecución en CI

- El workflow `.github/workflows/ci.yml` ejecuta:
  1. `pnpm seed:simulacros` dos veces seguidas (verificando idempotencia) contra la base PostGIS de pruebas.
  2. `pnpm --filter @domigoo/web test:e2e` (incluyendo `mobile-iphone-13` y `mobile-android-360`).
  3. `pnpm reset:simulacros` para limpiar exclusivamente los datos con marcador `sim-m52`.
  4. Sube las capturas generadas en `docs/capturas/m52-simulacros/` como artefacto `m52-simulacros-capturas`.
