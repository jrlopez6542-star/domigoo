# ADR-003. Prisma 7 y geography de PostGIS

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

El despacho busca domiciliarios en un radio en metros y las tarifas usan polígonos. Prisma 8.0.0-rc (la etiqueta `latest` el día de esta decisión) ofrece una extensión PostGIS de primera clase, con otro formato de contrato y paquetes distintos. Prisma 7.10.1 es la estable anterior y exige sacar `url` del esquema hacia `prisma.config.ts`.

## Decisión

El contrato de fase 0 usa Prisma ORM 7.10.x. Las columnas espaciales son `Unsupported("geography(…,4326)")` con índice GiST. El SQL de PostGIS vive en el módulo `geo`. La extensión se crea en la migración, no con el preview viejo `postgresqlExtensions`, retirado en la línea 6.16.

Se eligió `geography` y no `geometry` para que `ST_DWithin` reciba metros. El SRID es 4326.

## Consecuencias

El cliente de Prisma no filtra por distancia; lo hace una consulta parametrizada. Eso es aceptable porque hay un solo módulo con ese SQL. El esquema se validó con Prisma 7.10.1 y el SQL se aplicó en `postgis/postgis:17-3.5`.

Cuando Prisma 8 deje de ser release candidate se abre otra ADR. No se migra el contrato en medio de una misión de negocio.

## Alternativas

Adoptar la 8 RC ahora. Se descarta: el formato todavía se mueve y la fase 0 necesita un archivo que `prisma validate` acepte de forma repetible. Guardar latitud y longitud en columnas numéricas y calcular en la aplicación. Se descarta: pierde el índice espacial y se equivoca con facilidad en el orden de los ejes. `geometry` en grados. Se descarta para el radio operativo.
