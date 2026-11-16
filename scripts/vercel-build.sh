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
else
  echo "Sin migracion: VERCEL_ENV=${VERCEL_ENV:-local}"
fi

pnpm --filter @domigoo/api build
