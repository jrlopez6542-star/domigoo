#!/usr/bin/env bash
# Consulta real a PostGIS. No hay sustituto en SQLite ni respuesta fija.
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=domigoo}"
: "${PGDATABASE:=domigoo}"
: "${PGPASSWORD:=domigoo}"
export PGPASSWORD

for _ in $(seq 1 30); do
  if psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -tAc "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

version="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -tAc "SELECT PostGIS_Version();")"
printf 'PostGIS_Version: %s\n' "$version"

case "$version" in
  3.*) ;;
  *)
    printf 'Se esperaba PostGIS 3.x y la base devolvió: %s\n' "$version" >&2
    exit 1
    ;;
esac
