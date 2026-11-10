# Modelo de datos

Contrato ejecutable: [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma), escrito para Prisma ORM 7.10. La migración inicial vive en `apps/api/prisma/migrations` e incluye la extensión PostGIS, el SQL de Prisma y el de la sección 6. No hay una segunda copia editable en `docs/`.

## 1. Convenciones

- Identificador de cada fila: UUID v4 generado por la base (`gen_random_uuid()` vía `@default(uuid())`).
- Nombres de tablas en snake_case (`@@map`). Nombres de columnas como los campos de Prisma, en camelCase y entre comillas en el SQL. Se prefirió no mapear cada columna a mano en un contrato de esta longitud; el SQL de PostGIS cita el identificador.
- Pesos colombianos: enteros. No hay centavos en la operación. No hay columnas `Decimal` ni `Float` para dinero.
- Multiplicador nocturno: puntos básicos enteros. 10000 = 1,00.
- Fechas de vigencia (`SOAT`, tecnomecánica, documentos): `@db.Date`. Instantes: `@db.Timestamptz(6)`.
- El borrado físico de restaurantes, domiciliarios, pedidos y auditoría no es una operación del producto. Las relaciones de negocio usan `ON DELETE RESTRICT`. Cascada solo en piezas que no viven solas (sesión, horario de sucursal, chequeos de un caso, accesos de un enlace).
- Un hecho histórico (evento de pedido, decisión, cotización, consentimiento, declaración) no tiene `updatedAt`.

## 2. Contextos

```mermaid
erDiagram
  USER ||--o| COURIER : "perfil"
  USER ||--o| ADMIN_PROFILE : "perfil"
  USER ||--o{ RESTAURANT_MEMBERSHIP : "participa"
  RESTAURANT ||--o{ RESTAURANT_MEMBERSHIP : "tiene"
  RESTAURANT ||--o{ ESTABLISHMENT : "registra"
  ESTABLISHMENT ||--o{ BRANCH : "opera"
  RESTAURANT ||--o{ RESTAURANT_SUBSCRIPTION : "contrata"
  SUBSCRIPTION_PLAN ||--o{ RESTAURANT_SUBSCRIPTION : "define"
  COURIER ||--o| VEHICLE : "usa"
  COURIER ||--o{ COURIER_DOCUMENT : "adjunta"
  COURIER ||--o{ VERIFICATION_CASE : "somete"
  VERIFICATION_CASE ||--o{ VERIFICATION_DECISION : "recibe"
  RESTAURANT ||--o{ ORDER : "crea"
  BRANCH ||--o{ ORDER : "despacha"
  ORDER ||--o| TARIFF_QUOTE : "congela"
  ORDER ||--o{ DISPATCH_OFFER : "ofrece"
  COURIER ||--o{ DISPATCH_OFFER : "recibe"
  ORDER ||--o| TRACKING_LINK : "comparte"
  ORDER ||--o{ INCIDENT : "puede originar"
```

### Identidad

`users` es la cuenta. El correo y el teléfono son únicos y opcionales; el servicio exige al menos uno. `passwordHash` es nulo solo mientras una invitación de personal no se ha consumido.

`sessions` guarda el hash del token, el tipo de cliente (`WEB`, `MOBILE`, `ADMIN`) y `revokedAt`. No guarda el token en claro.

`admin_profiles.role` es el papel de plataforma: `SUPERADMIN`, `REVIEWER`, `OPERATIONS`, `SECURITY`. Los papeles del restaurante no van aquí.

`access_invites` incorpora personal de restaurante o un admin. `courier_invitations` atribuye un alta de domiciliario a un restaurante o a un admin. Ninguna de las dos concede el estado `APPROVED`.

### Restaurante

`restaurants` es el suscriptor (razón social, nombre comercial, NIT). `establishments` es el establecimiento de comercio. `branches` es la sucursal que despacha y la que tiene el punto geográfico. Un restaurante de una sola sede se modela con un establecimiento y una sucursal; no hay un atajo de "restaurante con dirección".

`branch_hours.weekday` sigue ISO-8601: 1 es lunes y 7 es domingo. Varias filas del mismo día son franjas partidas. Los minutos van desde medianoche.

### Domiciliario

`couriers.status` es una proyección. Solo cambia en la misma transacción que una decisión de verificación, una suspensión, una rehabilitación o el vencimiento de un documento. El historial está en `verification_cases`, `verification_decisions` y `audit_logs`.

`vehicles.type` solo tiene `MOTORCYCLE`. Otro vehículo es una migración y una decisión de producto, no un valor libre.

`courier_documents.storageKey` apunta al adaptador de archivos. No es una URL pública. El SHA-256 permite detectar un archivo repetido y comprobar integridad.

`courier_availabilities` es una fila por domiciliario. `location_pings` es el rastro. La búsqueda usa solo la primera.

### Verificación

Un caso recorre el ciclo de la sección 4. `verification_checks` guarda el código de la regla, el resultado y un JSON sin imagen. `verification_decisions` es la firma humana: revisor, resultado, código de motivo y comentario.

### Privacidad

`legal_documents` versiona el aviso de privacidad, los términos, el texto de geolocalización y el texto de tratamiento de documentos. El consentimiento apunta a la versión exacta (`contentHash`).

`consent_records` se revoca con `revokedAt`. No se reescribe `grantedAt`.

`data_subject_requests` registra acceso, corrección, supresión, revocatoria y reclamo. El estado operativo no borra por sí solo las filas contables; la misión M37 define qué columnas se anonimizan.

### Suscripción

`subscription_plans.priceCop` no se edita si ya existen suscripciones: se crea otro código de plan. `restaurant_subscriptions.priceCop` copia el precio al abrir el periodo.

`isCurrent` marca la fila vigente. El único parcial de la sección 6 impide dos vigentes para el mismo restaurante.

`subscription_payment_declarations` es una declaración escrita por una persona. Estados: `DECLARED`, `ACKNOWLEDGED`, `REJECTED`. No tiene id de pasarela ni saldo.

### Tarifa y política

`tariff_versions` y `operations_policies` se publican como versión. Solo una fila de cada una puede estar en `PUBLISHED` (índice parcial).

`tariff_zones.area` es `geography(MultiPolygon,4326)`. `priority` desempata solapes. `tariff_rules.zoneId` nulo es la regla por defecto.

`operations_policies` fija radio, TTL de oferta directa, TTL de oferta abierta, TTL de búsqueda, tamaño de la ola, longitud del PIN, intentos máximos, horas de vida del tracking tras el cierre y frescura de la posición. El pedido guarda `operationsPolicyId` al publicarse.

### Pedido

`orders.referenceCode` es un código corto para mostrarlo en el local. No es secreto.

`foodAmountCop` y `deliveryFeeCop` viven separados desde el borrador. `paymentMethod` es el medio con el que el cliente pagará el domicilio al domiciliario.

`tariff_quotes` es inmutable y uno a uno con el pedido. `order_events` es la bitácora de estados. `dispatch_offers` es cada oferta, con `wave` para un segundo intento directo o una segunda ola. La terna `(orderId, courierId, wave)` es única.

`pin_attempts` no guarda el PIN digitado, solo si acertó.

Los cifrados `pickupPinCiphertext` y `deliveryPinCiphertext` permiten volver a mostrar el PIN a quien corresponde. Los hash sirven para verificar. La clave no está en la base. Al llegar a un estado terminal los cifrados se anulan.

### Tracking, incidentes, salida y auditoría

`tracking_links.tokenHash` es único. `tracking_accesses` guarda IP y agente para abuso; la IP es dato personal de retención corta.

`incidents` puede colgar de pedido, restaurante o domiciliario. `incident_events.payload` es el historial del caso.

`device_push_tokens.token` es el token FCM. Se trata como secreto de canal: no entra en logs ni en auditoría.

`notification_outbox.payload` ya viene minimizado.

`idempotency_keys` cubre reintentos del móvil en aceptar oferta y confirmar PIN. La pareja `(userId, key)` es única.

`audit_logs` no tiene actualización. El disparador de la sección 6 rechaza `UPDATE` y `DELETE`.

## 3. Invariantes que el servicio hace cumplir

La base no puede expresarlos todos. Los módulos los comprueban y las pruebas de integración los fijan.

1. La sucursal del pedido pertenece al restaurante del pedido.
2. Publicar exige restaurante `ACTIVE`, sucursal `ACTIVE` con `location`, establecimiento `ACTIVE`, suscripción `TRIAL` o `ACTIVE` con `periodEndsAt` en el futuro, y conteo de pedidos no terminales menor que `maxConcurrentOrders`.
3. `deliveryFeeCop` del pedido publicado es igual a `tariff_quotes.deliveryFeeCop`.
4. Un domiciliario recibe ofertas solo si está `APPROVED`, su vehículo activo es motocicleta, los seis documentos están `ACCEPTED` y no vencidos, la disponibilidad está `AVAILABLE`, hay consentimiento de geolocalización vigente y la posición es más reciente que `locationFreshnessSeconds`.
5. En V1 un domiciliario tiene como máximo un pedido no terminal.
6. El monto de la comida no sale en las respuestas del domiciliario ni del tracking.
7. El teléfono y el nombre del cliente no salen en una oferta todavía `PENDING`.
8. Ningún adaptador de push recibe PIN, documento, dirección completa ni teléfono.

## 4. Estados

Los diagramas completos y las guardas están en [modulos.md](modulos.md). Resumen de los enumerados persistidos:

| Agregado | Valores | Terminales |
| --- | --- | --- |
| Pedido | `DRAFT`, `SEEKING_COURIER`, `ACCEPTED`, `ARRIVING_PICKUP`, `AT_PICKUP`, `PICKED_UP`, `AT_DROPOFF`, `DELIVERED`, `EXPIRED`, `CANCELLED_RESTAURANT`, `CANCELLED_COURIER`, `CANCELLED_ADMIN`, `FAILED` | `DELIVERED`, `EXPIRED`, los tres `CANCELLED_*`, `FAILED` |
| Oferta | `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `SUPERSEDED`, `CANCELLED` | Todos menos `PENDING` |
| Caso de verificación | `COLLECTING`, `SUBMITTED`, `AUTO_IN_PROGRESS`, `PENDING_HUMAN`, `NEEDS_CHANGES`, `APPROVED`, `REJECTED` | `APPROVED` y `REJECTED` cierran el caso. Un documento vencido abre otro ciclo, no reabre el caso cerrado. |
| Proyección del domiciliario | `REGISTERING`, `PENDING_VERIFICATION`, `NEEDS_CHANGES`, `APPROVED`, `REJECTED`, `SUSPENDED` | Ninguno es eterno. `SUSPENDED` es operativo y no borra la última decisión. |
| Suscripción | `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED` | `CANCELLED` |
| Restaurante | `DRAFT`, `PENDING_REVIEW`, `ACTIVE`, `SUSPENDED`, `CLOSED` | `CLOSED` |

## 5. Índices geoespaciales y de consulta

Definidos en el esquema y comprobados en el SQL generado:

| Índice | Columna | Tipo |
| --- | --- | --- |
| `branches_location_gist` | `branches.location` | GiST |
| `courier_availability_location_gist` | `courier_availabilities.location` | GiST |
| `location_pings_location_gist` | `location_pings.location` | GiST |
| `tariff_zones_area_gist` | `tariff_zones.area` | GiST |
| `orders_pickup_location_gist` | `orders.pickupLocation` | GiST |
| `orders_dropoff_location_gist` | `orders.dropoffLocation` | GiST |

Índices de acceso que ya están en Prisma: pedido por restaurante y estado, pedido por domiciliario asignado, ofertas por domiciliario y vencimiento, casos por estado, auditoría por entidad y por actor, bandeja por estado y `availableAt`.

La búsqueda de candidatos es responsabilidad del módulo `geo`:

```sql
SELECT c.id
FROM couriers c
JOIN courier_availabilities a ON a."courierId" = c.id
WHERE c.status = 'APPROVED'
  AND a.state = 'AVAILABLE'
  AND a."recordedAt" > now() - make_interval(secs => $freshness)
  AND ST_DWithin(a.location, $origin::geography, $radius_meters);
```

`$origin` es el punto de la sucursal. El radio sale de la política publicada.

## 6. SQL que Prisma no genera

M04 lo añade en la misma migración, después del SQL de Prisma. Los nombres citados coinciden con las columnas camelCase.

```sql
CREATE UNIQUE INDEX restaurant_subscriptions_one_current
  ON restaurant_subscriptions ("restaurantId")
  WHERE "isCurrent";

CREATE UNIQUE INDEX tariff_versions_one_published
  ON tariff_versions (status)
  WHERE status = 'PUBLISHED';

CREATE UNIQUE INDEX operations_policies_one_published
  ON operations_policies (status)
  WHERE status = 'PUBLISHED';

CREATE UNIQUE INDEX dispatch_offers_one_accepted
  ON dispatch_offers ("orderId")
  WHERE status = 'ACCEPTED';

CREATE INDEX courier_available_location_gist
  ON courier_availabilities USING GIST (location)
  WHERE state = 'AVAILABLE';

ALTER TABLE orders
  ADD CONSTRAINT orders_amounts_non_negative
  CHECK ("foodAmountCop" >= 0 AND "deliveryFeeCop" >= 0);

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_amounts
  CHECK ("priceCop" >= 0 AND "periodDays" > 0 AND "trialDays" >= 0
         AND "maxBranches" > 0 AND "maxConcurrentOrders" > 0);

ALTER TABLE subscription_payment_declarations
  ADD CONSTRAINT subscription_declarations_amount_positive
  CHECK ("amountCop" > 0);

ALTER TABLE tariff_rules
  ADD CONSTRAINT tariff_rules_fees
  CHECK ("baseFeeCop" >= 0 AND "perKmCop" >= 0 AND "minimumFeeCop" >= 0
         AND "nightMultiplierBps" > 0);

ALTER TABLE branch_hours
  ADD CONSTRAINT branch_hours_clock
  CHECK (weekday BETWEEN 1 AND 7
         AND "opensMinute" BETWEEN 0 AND 1439
         AND "closesMinute" BETWEEN 0 AND 1440);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es append-only';
END;
$$;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
```

La primera migración también ejecuta `CREATE EXTENSION IF NOT EXISTS postgis` antes de crear columnas `geography`. El rol de la aplicación en un ambiente real no será propietario: no tendrá `UPDATE` ni `DELETE` sobre `audit_logs`. En la VM y en CI se comprueba el disparador, que sí cubre al propietario.

## 7. Retención prevista

Son valores iniciales de ingeniería para que el esquema tenga sentido. No reemplazan el criterio jurídico. Están registrados como riesgo, no como pregunta que frene M01.

| Dato | Plazo de trabajo | Después |
| --- | --- | --- |
| Pings de ubicación | 30 días | Borrado de la fila |
| Accesos al enlace de tracking | 90 días | Borrado de IP y agente |
| Teléfono y nombre del cliente en el pedido | 24 meses desde el cierre | Anonimización de esas columnas. Quedan los montos y el estado. |
| Documentos de identidad y su archivo | Mientras la cuenta esté activa y 12 meses tras el cierre o el rechazo | Borrado del archivo y de `storageKey` |
| Suscripciones, declaraciones y montos del pedido | 10 años | Se conservan como rastro contable de DOMIGOO. El teléfono del cliente no hace falta para ese rastro. |
| Auditoría | 5 años | Se conserva. El diff ya nace redactado. |
| Token de push | Hasta revocación o 180 días sin `lastSeenAt` | Borrado |

## 8. Cómo volver a comprobar el contrato

Desde la raíz, con el Compose en marcha:

```bash
./scripts/check-contract.sh
```

El script crea `domigoo_contract` vacía, ejecuta `prisma migrate deploy` y comprueba las 42 tablas, los seis índices GiST, el índice único de una oferta aceptada, el rechazo de `UPDATE` en `audit_logs` y un `ST_DWithin` de 2 km en metros. `DATABASE_URL` tiene que existir para Prisma aunque `validate` no abra una conexión:

```bash
cd apps/api
export DATABASE_URL="postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo_contract"
pnpm exec prisma validate
```
