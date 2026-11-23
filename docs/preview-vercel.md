# Preview de Vercel

El proyecto de Vercel se llama `domigoo`. La rama de producción es `Contabilidad`. Los deployments están protegidos con Vercel Authentication.

La base Neon `domigoo-preview` está conectada solo a Preview y Development. Production no tiene esa base y este repositorio no guarda su URL.

## Qué hace el build

`vercel.json` en la raíz instala con pnpm, ejecuta `scripts/vercel-build.sh` y publica la carpeta vacía `public` junto con la función de `api/`.

- Si `VERCEL_ENV` es `preview`, el script asigna `DATABASE_URL` al valor de `DATABASE_URL_UNPOOLED` solo para el proceso de `prisma migrate deploy`. Esa URL no se imprime.
- En Production, Development y en local el script no migra. Compila igual.
- La compilación es `pnpm --filter @domigoo/api build` (`tsc` hacia `apps/api/dist`).

La primera migración ya ejecuta `CREATE EXTENSION IF NOT EXISTS postgis;`. En Neon eso habilita PostGIS al migrar Preview.

## Cómo entra el tráfico

`api/index.mjs` arranca Nest una vez y atiende todas las rutas que `vercel.json` reescribe hacia `/api`. `/health` no consulta la base. `/ready` sí.

El web todavía no está en el monorepo. Cuando exista, sus rutas se declaran en `vercel.json` antes del comodín de la API. No hace falta otra base de Production para eso.

## Qué no hace este entorno

No compra dominios, no configura pagos y no escribe variables de Production. Un deploy de Production puede compilar, pero no migra y no usa `domigoo-preview`.

Desde M25 el proceso exige `PIN_PEPPER` y `DATA_ENCRYPTION_KEY`: cada una, 32 bytes en base64, generadas fuera del repositorio. Sin ellas Nest no arranca. El build de Preview sigue migrando; las peticiones responden cuando esas dos variables existen en el entorno de Preview. Este repositorio no las carga en Vercel.

## Aislamiento obligatorio de base de datos en Preview

Tanto el script de build (`scripts/vercel-build.sh` vía `preview-db-guard-cli.ts`), como los seeds (`seed:staging` y `seed-admin`) y el arranque en runtime (`readEnv` y `Database`) validan explícitamente la identidad de la base de datos cuando `VERCEL_ENV=preview`. Tener `"staging"` en el host o nombre no autoriza nada.

Variables requeridas en el proyecto Vercel `domigoo` **exclusivamente en el ámbito `Preview`**:

- **`PREVIEW_DB_ALLOWED_ENDPOINTS`** (obligatoria en Preview):
  - **Finalidad**: lista explícita de identificadores de endpoint Neon autorizados para Preview (por ejemplo, el endpoint de `domigoo-preview`). Si está vacía o ausente, Preview aborta build, migraciones, seeds y arranque.
  - **Ámbito**: únicamente `Preview`.
  - **Formato**: IDs `ep-...` separados por coma, sin sufijo `-pooler` (ejemplo: `ep-domigoo-preview-123`). El guard quita `-pooler` del host de la URL para obtener el endpoint; en esta variable una entrada con `-pooler`, con dominio o con otro formato se rechaza (fail-closed).
- **`PREVIEW_DB_EXPECTED_NAME`** (obligatoria en Preview):
  - **Finalidad**: nombre exacto de la base de datos lógica esperada en Preview. Tanto `DATABASE_URL` como `DATABASE_URL_UNPOOLED` deben coincidir exactamente con este nombre, además de compartir endpoint, puerto y usuario.
  - **Ámbito**: únicamente `Preview`.
  - **Formato**: cadena exacta del nombre de la base (ejemplo: `domigoo-preview` o `neondb`).
- **`PREVIEW_DB_FORBIDDEN_ENDPOINTS`** (opcional, recomendada en Preview):
  - **Finalidad**: lista negra explícita de endpoints de Production que deben rechazarse siempre en Preview, incluso si alguien los agregara por error a la allowlist.
  - **Ámbito**: únicamente `Preview`.
  - **Formato**: IDs `ep-...` separados por coma (ejemplo: `ep-domigoo-prod-999`).

### Endurecimiento PREVIEW-DB-ISOLATION-003

No se agregan variables nuevas. El guard (`apps/api/src/config/preview-db-guard.ts`) valida la cadena exacta que reciben `pg` y Prisma y rechaza todo lo que esos parsers podrían interpretar distinto:

- **Forma de la URL en Preview**: `postgresql://<usuario>:<contraseña>@<ep-id>[-pooler].<etiquetas>.neon.tech[:puerto]/<base>[?parámetros]`. El host debe terminar en `.neon.tech`; `DATABASE_URL` y `DATABASE_URL_UNPOOLED` deben compartir endpoint, dominio (región), base, usuario y puerto.
- **Parámetros permitidos**: solo `sslmode`, `channel_binding`, `connect_timeout`, `application_name` y `pgbouncer`, sin repetir. Cualquier otro (`host`, `hostaddr`, `port`, `user`, `password`, `dbname`, `options`, `service`, `sslrootcert`…) se rechaza, porque `pg` y Prisma lo usan para cambiar el destino o leer archivos.
- **Se rechazan además**: espacios, tabuladores, saltos de línea o caracteres de control en cualquier posición (también al final), fragmentos `#`, varios hosts, sockets, IP directas, nombres de base percent-encoded o con caracteres fuera de `A-Z a-z 0-9 _ -`, y contraseñas con el prefijo `endpoint=` (enrutamiento Neon por contraseña).
- **Variables de libpq**: en Preview se rechaza `PGOPTIONS` (pg la envía como `options` y Neon enruta con `endpoint=`) y un `PGPORT` distinto del puerto de la URL. `PGHOST`, `PGUSER` y `PGDATABASE` de la integración Neon se toleran porque la URL validada los anula.
- **`VERCEL_ENV`**: solo `production`, `development`, vacío o ausente conservan el comportamiento anterior. `preview` en cualquier combinación de mayúsculas o espacios aplica el guard; cualquier otro valor no reconocido (`staging`, `PRODUCTION`, ` production`…) también lo activa y la API no arranca. En el build, un valor no canónico cae en la rama que no migra ni siembra.
- **Seed fuera de Preview** (CI y local): solo un host loopback listado en `STAGING_ALLOWED_DB_HOSTS`, con los mismos rechazos de parámetros (por ejemplo `127.0.0.1/...?host=<remoto>` se rechaza).
