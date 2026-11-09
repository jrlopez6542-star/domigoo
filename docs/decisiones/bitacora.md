# Bitácora

Una fila por misión cerrada. La fase 0 queda registrada abajo. Las misiones de implementación añaden la suya al abrir el pull request.

| Fecha | Misión | Resultado | No se pudo ejecutar |
| --- | --- | --- | --- |
| 2026-11-09 | Fase 0, documentación | Contrato de arquitectura, datos, módulos, misiones, pruebas y ADR. `prisma validate` con 7.10.1. El SQL del esquema se aplicó en un contenedor desechable `postgis/postgis:17-3.5` (42 tablas) y el contenedor se eliminó. | No hay aplicación que probar. No se llamó a FCM. No se instaló un emulador Android. |
| 2026-11-09 | M01, monorepo y calidad estática | `pnpm install`, `pnpm install --frozen-lockfile`, `pnpm lint` y `pnpm typecheck` salieron 0 en local. Un archivo temporal `string = null` produjo TS2322 y no se commiteó. El workflow no usa secretos. TypeScript 6.0.3, porque `typescript-eslint` 8.72.2 no admite la 7.0.2. El job «typecheck y lint» de GitHub Actions terminó en éxito (run 42718215422). | Quedó un aviso del runner: `ubuntu-latest` migra a Ubuntu 26. No tumbó el job. |
