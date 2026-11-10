# ADR-010. Código en inglés y nombre configurable

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

La documentación de producto está en español, como se pidió. El nombre DOMIGOO es provisional y no se ha comprobado como marca ni como dominio.

## Decisión

Tablas, módulos, rutas y pruebas usan identificadores en inglés (`Courier`, `Order`, `Branch`). Los textos que ve una persona están en español. El nombre visible sale de `APP_NAME`, con valor de desarrollo `DOMIGOO`. No se compran dominios ni se incrusta un dominio de producción en el código.

Las coordenadas y la zona inicial se tratan como datos. El motor no dice "Tocancipá" en la regla de cobro; lo dice la semilla de la zona, marcada como envolvente de desarrollo.

## Consecuencias

Un cambio de marca no es una migración de tablas. La documentación histórica puede seguir diciendo DOMIGOO mientras señale que es el nombre de desarrollo.

## Alternativas

Nombrar tablas en español. Se descarta: mezcla acentos y el contrato técnico con la copia. Fijar el dominio en los CORS de ejemplo. Se descarta hasta que exista un dominio elegido por el negocio.
