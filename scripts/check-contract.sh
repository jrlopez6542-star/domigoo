#!/usr/bin/env bash
# Migra una base vacía y comprueba el contrato. No siembra personas.
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=domigoo}"
: "${PGPASSWORD:=domigoo}"
: "${PGDATABASE:=domigoo}"
export PGPASSWORD

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DB="domigoo_contract"

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE);" \
  -c "CREATE DATABASE ${TARGET_DB};"

export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${TARGET_DB}"

(
  cd "$ROOT/apps/api"
  pnpm exec prisma migrate deploy
)

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" -v ON_ERROR_STOP=1 \
  -f "$ROOT/scripts/check-contract.sql"

printf 'Contrato verificado en %s\n' "$TARGET_DB"
