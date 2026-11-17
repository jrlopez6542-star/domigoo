#!/bin/sh
set -eu

MARKER_FILE=""
if [ -n "${VERCEL:-}" ] || [ -n "${VERCEL_ENV:-}" ]; then
  MARKER_FILE="/tmp/domigoo-vercel-build-${VERCEL_GIT_COMMIT_SHA:-preview}.markers"
  if [ -f "$MARKER_FILE" ] && [ -f "apps/api/dist/vercel.js" ] && [ -f "apps/api/dist/vercel-build-meta.js" ]; then
    cat "$MARKER_FILE"
    mkdir -p public
    : > public/.gitkeep
    exit 0
  fi
fi

record_marker() {
  echo "$1"
  if [ -n "$MARKER_FILE" ]; then
    echo "$1" >> "$MARKER_FILE"
  fi
}

if [ -n "$MARKER_FILE" ]; then
  : > "$MARKER_FILE"
fi

MIGRATE_STATUS="omitido"
SEED_STATUS="omitido"

if [ "${VERCEL_ENV:-}" = "production" ]; then
  record_marker "[vercel-build] migrate deploy: omitido (VERCEL_ENV=production)"
  record_marker "[vercel-build] seed:staging: omitido (VERCEL_ENV=production)"
  MIGRATE_STATUS="omitido:production"
  SEED_STATUS="omitido:production"
elif [ "${VERCEL_ENV:-}" = "preview" ]; then
  case "${DATABASE_URL_UNPOOLED:-}" in
    postgres://*|postgresql://*) ;;
    *)
      echo "[vercel-build] Error: en Preview hace falta DATABASE_URL_UNPOOLED con una URL de Postgres" >&2
      exit 1
      ;;
  esac
  record_marker "[vercel-build] migrate deploy: inicio"
  DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm --filter @domigoo/api exec prisma migrate deploy
  record_marker "[vercel-build] migrate deploy: ok"
  MIGRATE_STATUS="ok"

  if [ -n "${STAGING_SEED_PASSWORD:-}" ]; then
    DB_HOST="$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL_UNPOOLED).hostname)')"
    DOMIGOO_ENV=staging \
      STAGING_SEED_CONFIRM=yes \
      NODE_ENV=development \
      DATABASE_URL="$DATABASE_URL_UNPOOLED" \
      STAGING_ALLOWED_DB_HOSTS="${STAGING_ALLOWED_DB_HOSTS:-$DB_HOST}" \
      pnpm --filter @domigoo/api seed:staging
    DOMIGOO_ENV=staging \
      STAGING_SEED_CONFIRM=yes \
      NODE_ENV=development \
      DATABASE_URL="$DATABASE_URL_UNPOOLED" \
      STAGING_ALLOWED_DB_HOSTS="${STAGING_ALLOWED_DB_HOSTS:-$DB_HOST}" \
      pnpm --filter @domigoo/api seed:staging
    record_marker "[vercel-build] seed:staging: ejecutado"
    SEED_STATUS="ejecutado"
  else
    record_marker "[vercel-build] seed:staging: omitido (STAGING_SEED_PASSWORD no definida)"
    SEED_STATUS="omitido:sin_password"
  fi
else
  record_marker "[vercel-build] migrate deploy: omitido (VERCEL_ENV=${VERCEL_ENV:-local})"
  record_marker "[vercel-build] seed:staging: omitido (VERCEL_ENV=${VERCEL_ENV:-local})"
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
};
EOF

mkdir -p public
: > public/.gitkeep
record_marker "[vercel-build] api build: ok"

