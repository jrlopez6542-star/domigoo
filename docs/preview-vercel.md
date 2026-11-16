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
