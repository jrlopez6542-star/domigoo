# Entorno de Staging Aislado (`domigoo-staging`)

Este documento describe cómo levantar, resembrar, verificar y destruir el entorno de **staging aislado** de DOMIGOO sin tocar producción ni usar datos personales reales.

## 1. Arquitectura y aislamiento

| Componente | Recurso Staging | Aislamiento respecto a Producción |
| --- | --- | --- |
| Rama / Preview | Rama de PR / `domigoo-staging` en Vercel | Despliegue Preview separado de la rama `Contabilidad` (Production) |
| Base de datos | Branch Neon `domigoo-staging` (PostgreSQL 17 + PostGIS 3.5) | URL y credenciales exclusivas (`DATABASE_URL` / `DATABASE_URL_UNPOOLED`), nunca compartidas con producción |
| Secretos | `PIN_PEPPER` y `APP_ENCRYPTION_KEY` propios de staging | Generados con `openssl rand -base64 32`; distintos a cualquier clave de producción |
| Datos | 100% ficticios (`@example.com`, `+573000000xxx`, NIT `9000009xx`) | Sin PII real ni pasarelas de pago |
| Clientes | `@domigoo/web`, `@domigoo/admin`, `@domigoo/movil` | Apuntan a `API_BASE_URL` / `EXPO_PUBLIC_API_URL` de staging |

## 2. Variables de entorno

La plantilla documentada sin secretos reales vive en [`.env.staging.example`](../.env.staging.example).

1. Copia la plantilla localmente (no se commitea):

   ```bash
   cp .env.staging.example .env.staging
   ```

2. Genera las claves criptográficas de staging:

   ```bash
   openssl rand -base64 32   # PIN_PEPPER
   openssl rand -base64 32   # APP_ENCRYPTION_KEY
   ```

3. Configura `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PIN_PEPPER`, `APP_ENCRYPTION_KEY` y `APP_NAME=domigoo-staging` en el entorno **Preview/Staging** de Vercel (o en `.env.staging` para staging local con Docker).

## 3. Cómo desplegar staging

### Opción A: Vercel Preview + Neon (`domigoo-preview` / `domigoo-staging`)

1. En **Neon**, utiliza el store existente `domigoo-preview` conectado a Vercel únicamente para los entornos **Preview** y **Development** (con PostGIS habilitado por la primera migración).
2. En **Vercel** (proyecto `domigoo`, equipo `jrlopez6542-1905`, scope **Preview**):
   - Verifica que estén configuradas `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `PIN_PEPPER`, `APP_ENCRYPTION_KEY` (o `DATA_ENCRYPTION_KEY`) y `APP_NAME=domigoo-staging`.
   - Para que el build de Preview ejecute automáticamente `seed:staging` tras `prisma migrate deploy`, añade `STAGING_SEED_PASSWORD` (12–72 caracteres) únicamente en el entorno **Preview** de Vercel.
   - Si Vercel Authentication está activo en Preview, habilita **Protection Bypass for Automation** en Vercel (*Settings → Deployment Protection*) y utiliza `VERCEL_AUTOMATION_BYPASS_SECRET` al correr `pnpm smoke:staging`.
3. Abre o actualiza un PR hacia `Contabilidad`: [`scripts/vercel-build.sh`](../scripts/vercel-build.sh) ejecuta `prisma migrate deploy` (usando `DATABASE_URL_UNPOOLED`), siembra datos ficticios (si `STAGING_SEED_PASSWORD` está presente en Preview) y compila la API (`apps/api/dist`).

### Opción B: Staging aislado local con Docker

```bash
docker compose up -d
set -a && source .env.staging && set +a
pnpm --filter @domigoo/api exec prisma migrate deploy
pnpm --filter @domigoo/api build
PORT=3001 node apps/api/dist/main.js
```

## 4. Cómo resembrar datos ficticios (idempotente y protegido)

El script [`apps/api/src/staging/seed-staging.ts`](../apps/api/src/staging/seed-staging.ts) es idempotente y cuenta con guardas estrictas para impedir cualquier ejecución accidental sobre producción:

- Aborta si `NODE_ENV=production`.
- Exige `DOMIGOO_ENV=staging` y `STAGING_SEED_CONFIRM=yes`.
- Exige que el host o nombre de BD en `DATABASE_URL` contenga `"staging"` (o que el host esté en `STAGING_ALLOWED_DB_HOSTS`).
- Exige `STAGING_SEED_PASSWORD` (12–72 caracteres), sin contraseña por defecto en el repositorio.

```bash
set -a && source .env.staging && set +a
DOMIGOO_ENV=staging \
STAGING_SEED_CONFIRM=yes \
NODE_ENV=development \
STAGING_SEED_PASSWORD="<clave-staging-12-72-chars>" \
pnpm --filter @domigoo/api seed:staging
```

Siembra:
- Admin con rol mínimo `REVIEWER` (`reviewer-staging@example.com`).
- Tarifa publicada (`Tarifa Staging`) y política operativa (`Politica Staging`).
- Documentos legales (`DOCUMENT_PROCESSING` y `GEOLOCATION_CONSENT`).
- Plan de suscripción (`STAGING_PLAN`).
- Restaurante ficticio activo (`Asadero Staging SAS`, NIT `900000901`) con sucursal en Tocancipá y suscripción `TRIAL`.
- Domiciliario ficticio aprobado y `AVAILABLE` dentro de la zona (`Camila Staging`).

## 5. Cómo correr el smoke test (flujo completo de 12 pasos)

El script [`scripts/smoke-staging.mjs`](../scripts/smoke-staging.mjs) ejecuta por HTTP los 12 pasos de M40 contra `STAGING_API_URL` usando datos ficticios únicos por ejecución y genera un informe JSON (sin contraseñas ni tokens). Por seguridad, exige `STAGING_SEED_PASSWORD` y rechaza cualquier URL cuyo host no contenga `"staging"`, `"preview"`, `"localhost"` o `"127.0.0.1"` (salvo `STAGING_SMOKE_ALLOW_HOST=yes` o `STAGING_ALLOWED_HOSTS`).

```bash
STAGING_API_URL=https://domigoo-staging.vercel.app \
STAGING_ADMIN_EMAIL=reviewer-staging@example.com \
STAGING_SEED_PASSWORD="<clave-staging-12-72-chars>" \
SMOKE_REPORT_PATH=/tmp/smoke-staging-report.json \
pnpm smoke:staging
```

Si Vercel Authentication está activo en Preview, añade:

```bash
VERCEL_AUTOMATION_BYPASS_SECRET="<tu-secreto>" pnpm smoke:staging
```

## 6. Cómo destruir el entorno de staging

1. **Vercel:** elimina el deployment de Preview o cierra el PR correspondiente.
2. **Neon:** elimina el branch/base `domigoo-staging` desde la consola de Neon.
3. **Local:** si usaste Docker, ejecuta `docker compose down -v` y elimina `.env.staging` y `/tmp/domigoo-staging-storage`.
