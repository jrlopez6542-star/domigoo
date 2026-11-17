#!/bin/sh
set -eu

if [ "${VERCEL_ENV:-}" = "preview" ]; then
  case "${DATABASE_URL_UNPOOLED:-}" in
    postgres://*|postgresql://*) ;;
    *)
      echo "En Preview hace falta DATABASE_URL_UNPOOLED con una URL de Postgres" >&2
      exit 1
      ;;
  esac
  echo "Migrando la base de Preview"
  DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm --filter @domigoo/api exec prisma migrate deploy
  if [ -n "${STAGING_SEED_PASSWORD:-}" ]; then
    echo "Ejecutando seed:staging en Preview (pasada 1)"
    DB_HOST="$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL_UNPOOLED).hostname)')"
    DOMIGOO_ENV=staging \
      STAGING_SEED_CONFIRM=yes \
      NODE_ENV=development \
      DATABASE_URL="$DATABASE_URL_UNPOOLED" \
      STAGING_ALLOWED_DB_HOSTS="${STAGING_ALLOWED_DB_HOSTS:-$DB_HOST}" \
      pnpm --filter @domigoo/api seed:staging
    echo "Verificando idempotencia de seed:staging en Preview (pasada 2)"
    DOMIGOO_ENV=staging \
      STAGING_SEED_CONFIRM=yes \
      NODE_ENV=development \
      DATABASE_URL="$DATABASE_URL_UNPOOLED" \
      STAGING_ALLOWED_DB_HOSTS="${STAGING_ALLOWED_DB_HOSTS:-$DB_HOST}" \
      pnpm --filter @domigoo/api seed:staging
  else
    echo "STAGING_SEED_PASSWORD no definida en Preview: se omite seed:staging durante el build"
  fi
else
  echo "Sin migracion: VERCEL_ENV=${VERCEL_ENV:-local}"
fi

pnpm --filter @domigoo/api build
