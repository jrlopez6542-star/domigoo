# Política de expiración y retención automatizada (M47)

Endpoint protegido: `GET|POST /v1/internal/cron/maintenance` (header `Authorization: Bearer <CRON_SECRET>` o `x-cron-secret`).  
Programación Vercel Cron (`vercel.json`, plan gratuito — 1 ejecución diaria): `0 3 * * *` (03:00 UTC).

## Tareas ejecutadas automáticamente (idempotentes)

| Entidad / Tabla | Acción | Plazo / Criterio | Referencia |
|---|---|---|---|
| `dispatch_offers` (`PENDING`) | Marca `EXPIRED` | `expiresAt < now()` | Operación de despacho |
| `courier_invitations` (`PENDING`) | Marca `EXPIRED` | `expiresAt < now()` | Invitaciones caducadas |
| `access_invites` (no consumidas) | Elimina | `consumedAt IS NULL AND expiresAt < now()` | Invitaciones caducadas |
| `tracking_links` (activos) | Revoca (`revokedAt = now()`) | `revokedAt IS NULL AND expiresAt < now()` | Enlaces de seguimiento caducados |
| `sessions` | Elimina | `expiresAt < now()` | Tokens de sesión caducados |
| `idempotency_keys` | Elimina | `expiresAt < now()` | Claves de idempotencia caducadas |
| `rate_limit_buckets` | Elimina | `windowStart < now() - 24h` y sin bloqueo vigente | Limpieza de contadores de rate limit |
| `location_pings` | Elimina | `recordedAt < now() - 90 días` (conserva pings ligados a incidentes no `RESOLVED`/`DISMISSED`) | `docs/legal/politica-tratamiento-datos.md` §11 (`[90] días`) |
| `tracking_accesses` | Elimina | `accessedAt < now() - 90 días` | `docs/legal/politica-tratamiento-datos.md` §11 |

## Plazos pendientes de definir (no se purgan automáticamente)

Según `docs/legal/politica-tratamiento-datos.md` §11, los siguientes plazos son propuestas entre corchetes pendientes de revisión legal definitiva, por lo que **no** se eliminan automáticamente en M47:

- Datos de cuenta (`users`): **pendiente de definir** (propuesta `[2] años` tras cierre).
- Historial de pedidos (`orders`): **pendiente de definir** (propuesta `[5] años`).
- Documentos de domiciliarios (`courier_documents` / `stored_objects`): **pendiente de definir** (propuesta `[1] año` tras cierre).
- PQR e incidentes (`incidents`): **pendiente de definir** (propuesta `[3] años` desde cierre).
- Registros de auditoría (`audit_logs`): **pendiente de definir** (append-only por trazabilidad legal y contable).
