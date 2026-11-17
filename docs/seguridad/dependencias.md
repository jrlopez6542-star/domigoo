# Auditoría de dependencias de seguridad (M47)

Fecha de auditoría: 2026-11-17  
Comando ejecutado: `pnpm audit --prod`

## Resumen Antes vs. Después

| Severidad | Antes | Después |
|---|---:|---:|
| Crítica | 3 | 0 |
| Alta | 22 | 6 |
| Moderada | 20 | 3 |
| Baja | 2 | 0 |
| **Total** | **47** | **9** |

## Cambios aplicados (parche/minor compatibles)

1. `next`: actualizado de `15.5.12` a `15.5.29` en `apps/web/package.json` y `apps/admin/package.json`. Elimina las 3 vulnerabilidades críticas y todas las altas/bajas de `next`.
2. `postcss`: fijado override `>=8.5.23` en `package.json` raíz (`pnpm.overrides`), resolviendo las vulnerabilidades altas y moderadas de `postcss` en `apps/admin` y `apps/movil`.

## Riesgos pendientes (requieren cambio mayor o 0.x incompatible)

| Paquete | Severidad | Ruta | Motivo por el que no se fuerza | Mitigación / Plan |
|---|---|---|---|---|
| `sharp` (`<0.35.5`) | Alta (3) | `apps/admin > next > sharp` | Requiere salto `0.34.x -> 0.35.x` fuera del árbol directo de `next@15.5.x` | `apps/admin` es panel interno autenticado y no expone optimización de imágenes públicas no confiables; actualizar cuando Next 15/16 adopte `sharp >=0.35.5` |
| `image-size` (`<=2.0.2`) | Alta (2) | `apps/movil > expo > react-native > metro > image-size` | Transición `1.x -> 2.0.3` incompatible con `metro` en Expo 53 | Solo se ejecuta en build/empaquetado de desarrollo móvil (`@expo/cli`/`metro`), no en runtime de producción de la API |
| `playwright` (`<1.55.1`) | Alta (1) | `apps/admin > next > @playwright/test > playwright` | Dependencia transitiva de runner E2E | Solo se usa en CI/pruebas automatizadas, nunca en producción |
| `uuid`, `glob`, `minimatch` | Moderada (3) | `apps/movil > expo > @expo/cli` | Requieren salto mayor en `@expo/cli` / Expo SDK 54+ | Solo se usan en herramientas CLI de desarrollo móvil, sin exposición en producción |
