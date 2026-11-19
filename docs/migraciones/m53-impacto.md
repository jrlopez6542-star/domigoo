# Impacto de Migración M53 (`20261118120000_m53_public_restaurants_and_client_links`)

## Cambios en el esquema (100 % aditivos)

1. **`branches`**:
   - `"publicPhone" VARCHAR(20) NULL`: teléfono público opcional de la sede para contacto directo del cliente por WhatsApp (`wa.me`) o llamada (`tel:`). Nunca expone NIT, correo ni razón social.
   - `"acceptingOrders" BOOLEAN NOT NULL DEFAULT true`: interruptor manual del restaurante para abrir o cerrar la recepción de domicilios desde su panel, complementando `BranchHour`.
2. **`orders`**:
   - `"claimedByUserId" UUID NULL REFERENCES users(id) ON DELETE SET NULL`: permite que un cliente con cuenta opcional vincule un pedido a su historial mediante enlace de seguimiento (`POST /v1/tracking/:token/claim`). Nunca es obligatorio para pedir ni para seguir un pedido.
   - Índice `orders_claimed_by_user_idx` sobre `("claimedByUserId", "createdAt")`.

## Impacto y compatibilidad

- **Sin bloqueos destructivos**: Solo `ADD COLUMN` con `NULL` o `DEFAULT true`, más `CREATE INDEX`.
- **Retrocompatibilidad**: Todos los registros existentes de `branches` quedan con `acceptingOrders = true` y `publicPhone = NULL`. Todos los `orders` existentes quedan con `claimedByUserId = NULL`.
- **Seguridad y PII**: Los endpoints públicos (`GET /v1/public/restaurants`) solo leen `tradeName`, `name`, `addressLine`, `neighborhood`, `publicPhone`, `acceptingOrders` y `branch_hours`; jamás devuelven `nit`, `email` ni `legalName`.

## Estrategia de despliegue y reversión

- **Despliegue**: Ejecutar `pnpm --filter @domigoo/api exec prisma migrate deploy` en entorno `staging` / `preview` antes de desplegar la API. **Nunca ejecutar contra producción sin aprobación explícita.**
- **Reversión (`down.sql`)**:
  - `DROP INDEX IF EXISTS "orders_claimed_by_user_idx";`
  - `ALTER TABLE "orders" DROP COLUMN IF EXISTS "claimedByUserId";`
  - `ALTER TABLE "branches" DROP COLUMN IF EXISTS "acceptingOrders", DROP COLUMN IF EXISTS "publicPhone";`
