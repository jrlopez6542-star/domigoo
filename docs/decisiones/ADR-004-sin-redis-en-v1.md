# ADR-004. Sin Redis mientras haya una sola réplica

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

Redis se pidió solo cuando hiciera falta. Los usos típicos serían el candado de la oferta, el rate limit, la sesión y la cola de push.

## Decisión

V1 no despliega Redis. La aceptación exclusiva usa `SELECT … FOR UPDATE` y un índice único parcial de una oferta `ACCEPTED` por pedido. La sesión vive en PostgreSQL. La bandeja de push también. El rate limit del tracking es en memoria del proceso. Se opera una sola réplica de la API.

Redis se introduce, con una ADR que reemplace esta, cuando haya más de una réplica o cuando la bandeja en PostgreSQL no dé abasto medida en la operación real.

## Consecuencias

El rate limit no se comparte entre procesos. Por eso la segunda réplica está prohibida mientras esta ADR siga aceptada. Las pruebas de aceptación concurrente usan dos conexiones de PostgreSQL, no un candado simulado.

## Alternativas

Redis desde M01. Se descarta: añade un servicio que la VM tendría que levantar y que el mercado inicial no exige. Un candado optimista sin bloqueo de fila. Se descarta como mecanismo único: el índice parcial se queda igual como red, y el bloqueo evita trabajo perdido.
