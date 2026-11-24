#!/bin/sh
set -eu

MIGRATE_STATUS="omitido"
SEED_STATUS="omitido"
SEED_ADMIN_STATUS="omitido"

if [ "${VERCEL_ENV:-}" = "production" ]; then
  PROD_DB_URL="${DATABASE_URL_UNPOOLED:-${DATABASE_URL:-}}"
  case "$PROD_DB_URL" in
    postgres://*|postgresql://*) ;;
    *)
      echo "[vercel-build] Error: en Production hace falta DATABASE_URL_UNPOOLED o DATABASE_URL con una URL de Postgres" >&2
      exit 1
      ;;
  esac
  echo "[vercel-build] prod migrate deploy: inicio"
  DATABASE_URL="$PROD_DB_URL" pnpm --filter @domigoo/api exec prisma migrate deploy
  echo "[vercel-build] prod migrate deploy: ok"
  MIGRATE_STATUS="ok"
  SEED_STATUS="omitido:production"

  DATABASE_URL="$PROD_DB_URL" pnpm --filter @domigoo/api seed-admin
  if [ -n "${SEED_ADMIN_EMAIL:-}" ] && [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
    echo "[vercel-build] prod seed-admin: ejecutado"
    SEED_ADMIN_STATUS="ejecutado"
  else
    echo "[vercel-build] prod seed-admin: omitido"
    SEED_ADMIN_STATUS="omitido"
  fi
elif [ "${VERCEL_ENV:-}" = "preview" ]; then
  echo "[vercel-build] preview db guard: inicio"
  pnpm --filter @domigoo/api exec tsx src/config/preview-db-guard-cli.ts
  echo "[vercel-build] preview db guard: ok"

  echo "[vercel-build] migrate deploy: inicio"
  DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm --filter @domigoo/api exec prisma migrate deploy
  echo "[vercel-build] migrate deploy: ok"
  MIGRATE_STATUS="ok"

  if [ -n "${STAGING_SEED_PASSWORD:-}" ]; then
    pnpm --filter @domigoo/api exec tsx src/config/preview-db-guard-cli.ts
    DOMIGOO_ENV=staging \
      STAGING_SEED_CONFIRM=yes \
      NODE_ENV=development \
      DATABASE_URL="$DATABASE_URL_UNPOOLED" \
      pnpm --filter @domigoo/api seed:staging
    DOMIGOO_ENV=staging \
      STAGING_SEED_CONFIRM=yes \
      NODE_ENV=development \
      DATABASE_URL="$DATABASE_URL_UNPOOLED" \
      pnpm --filter @domigoo/api seed:staging
    echo "[vercel-build] seed:staging: ejecutado"
    SEED_STATUS="ejecutado"
  else
    echo "[vercel-build] seed:staging: omitido (STAGING_SEED_PASSWORD no definida)"
    SEED_STATUS="omitido:sin_password"
  fi
else
  echo "[vercel-build] migrate deploy: omitido (VERCEL_ENV=${VERCEL_ENV:-local})"
  echo "[vercel-build] seed:staging: omitido (VERCEL_ENV=${VERCEL_ENV:-local})"
  MIGRATE_STATUS="omitido:${VERCEL_ENV:-local}"
  SEED_STATUS="omitido:${VERCEL_ENV:-local}"
fi

pnpm --filter @domigoo/api build

cat > apps/api/dist/vercel-build-meta.js <<EOF
export const vercelBuildMeta = {
  vercelEnv: "${VERCEL_ENV:-local}",
  commitSha: "${VERCEL_GIT_COMMIT_SHA:-}",
  deploymentId: "${VERCEL_DEPLOYMENT_ID:-}",
  migrateDeploy: "${MIGRATE_STATUS}",
  seedStaging: "${SEED_STATUS}",
  seedAdmin: "${SEED_ADMIN_STATUS}",
};
EOF

mkdir -p public
: > public/.gitkeep
echo "[vercel-build] api build: ok"

