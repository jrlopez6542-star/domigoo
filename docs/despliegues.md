# Despliegues en Vercel y CI (DOMIGOO)

Este documento describe el flujo de despliegues en Vercel y la ejecución de CI para los tres proyectos del monorepo:

- **`domigoo`** (API NestJS en `apps/api`)
- **`domigoo-web`** (Web Next.js en `apps/web`)
- **`domigoo-admin`** (Panel Admin Next.js en `apps/admin`)

## 1. Previews por rama / Pull Request

Cada `push` a una rama con Pull Request abierto dispara:

1. **`domigoo` (API)**: siempre genera un Preview Deployment en Vercel.
   - Ejecuta `scripts/vercel-build.sh` con `VERCEL_ENV=preview`:
     - Corre `prisma migrate deploy` contra la base de staging (`DATABASE_URL_UNPOOLED`).
     - Ejecuta `pnpm --filter @domigoo/api seed:staging` (dos veces para verificar idempotencia) si `STAGING_SEED_PASSWORD` está definida.
     - Compila `apps/api` y genera `apps/api/dist/vercel-build-meta.js`.
2. **`domigoo-web` y `domigoo-admin`**: solo generan Preview Deployment cuando cambian archivos dentro de su respectiva app o de `packages/` (comportamiento nativo de skip de monorepo en Vercel).
   - **Nota sobre `API_BASE_URL` en Preview**: Actualmente los Previews de `domigoo-web` y `domigoo-admin` apuntan a la `API_BASE_URL` de producción (decisión pendiente del dueño sobre si apuntarlos al Preview de API o mantenerlos así).

> **Importante**: No se usa `ignoreCommand` personalizado en `vercel.json`, porque según la documentación de Vercel los builds cancelados mediante *Ignored Build Step* **sí cuentan** contra el límite diario de despliegues.

## 2. Producción (merge a `Contabilidad`)

Al hacer merge hacia la rama **`Contabilidad`**:

- Se despliega **Production** de los 3 proyectos (`domigoo`, `domigoo-web`, `domigoo-admin`).
- En `domigoo` (`VERCEL_ENV=production`), `scripts/vercel-build.sh` ejecuta `prisma migrate deploy` en producción (usando `DATABASE_URL_UNPOOLED` o `DATABASE_URL`) y `seed-admin` si están configuradas las credenciales iniciales. No ejecuta `seed:staging`.

## 3. Límites del plan Vercel Hobby

- **100 despliegues/día** en total.
- **1 build simultáneo** a la vez.
- Regla operativa: agrupar cambios localmente, validar antes de subir y hacer **un solo push por ronda** (sin ráfagas).

## 4. CI en GitHub Actions (`.github/workflows/ci.yml`)

- El workflow de CI corre en `pull_request` y únicamente en `push` a `branches: [Contabilidad]`, evitando ejecuciones duplicadas por cada commit en ramas de trabajo.
- Usa `concurrency` por rama (`${{ github.workflow }}-${{ github.ref }}`) con `cancel-in-progress: true` para cancelar corridas obsoletas al subir un nuevo commit.
- El job `Smoke Vercel Preview` espera específicamente el proyecto `name === "domigoo"` en el comentario de `vercel[bot]` (`scripts/wait-vercel-preview.mjs`).

## 5. Propuesta: evitar que cambios solo de documentación disparen despliegues en Vercel

> **Estado**: Solo propuesta (no se ha modificado `vercel.json` ni la configuración del dashboard de Vercel).

### Diagnóstico actual
- `domigoo-web` (`apps/web/vercel.json`) y `domigoo-admin` (`apps/admin/vercel.json`) tienen su **Root Directory** configurado en `apps/web` y `apps/admin` respectivamente, por lo que el salto nativo de monorepo de Vercel los omite (`Skipped - Not affected`) cuando solo cambian `docs/`, `.github/` o `apps/api/`.
- En cambio, `domigoo` (API) usa el `vercel.json` de la **raíz del repositorio** (Root Directory `.`). Al estar en la raíz, cualquier cambio en `docs/`, `.github/`, `scripts/` o incluso en `apps/web/` queda dentro de su árbol y dispara un despliegue de `domigoo`.

### Propuesta recomendada (sin `ignoreCommand`)
1. **Mover el Root Directory de `domigoo` a `apps/api`** en la configuración del proyecto en Vercel (habilitando *Include source files outside of the Root Directory* para `packages/*` y `scripts/vercel-build.sh`, o moviendo el script de build dentro de `apps/api`). Con esto, `domigoo` heredaría el mismo salto nativo de monorepo que ya funciona en `domigoo-web` y `domigoo-admin`: los commits exclusivos de `docs/`, `.github/` o de otra app serían omitidos automáticamente antes de crear un deployment.
2. **Por qué NO usar `ignoreCommand` ni `git.deploymentEnabled`**:
   - Según la documentación de Vercel, los builds cancelados mediante `ignoreCommand` (*Ignored Build Step*) **sí cuentan** para el límite diario de despliegues del plan Hobby.
   - `git.deploymentEnabled` deshabilita despliegues por rama completa, no por rutas modificadas.
3. **Disciplina operativa mientras tanto**: no mezclar `docs/`, capturas ni cambios globales con commits de `apps/api`, `apps/web` o `apps/admin`, y agrupar documentación en un commit separado únicamente al cierre de la ronda.
