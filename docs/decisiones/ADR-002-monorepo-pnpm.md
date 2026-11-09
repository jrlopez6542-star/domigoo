# ADR-002. Monorepo con pnpm y cuatro superficies

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

Hay dos webs, una app Android y una API que deben compartir versión de TypeScript y el contrato OpenAPI. El admin ve documentos de identidad y sanciones.

## Decisión

Un solo repositorio con pnpm workspaces: `apps/api`, `apps/web` (restaurantes y tracking), `apps/admin`, `apps/movil` (Expo, solo Android) y `packages/config`. El admin no se sirve desde el mismo proyecto Next que el restaurante.

## Consecuencias

CI tiene un grafo de paquetes. Un XSS en el portal del restaurante no comparte origen con la consola. Tracking no tiene su propio despliegue: es una ruta pública de `apps/web`. iOS queda fuera de V1.

## Alternativas

Tres repositorios. Se descarta por el costo de mantener el contrato a mano. Una sola app Next con grupos de rutas para el admin. Se descarta por el dato que la consola exhibe. Yarn o Bun. El entorno ya trae pnpm 10; no hace falta otro gestor.
