# DOMIGOO

Plataforma de intermediación entre restaurantes y domiciliarios independientes. El nombre es provisional y configurable (`APP_NAME`). Esta documentación no afirma que la marca ni ningún dominio estén disponibles.

Mercado inicial previsto: Tocancipá, Cundinamarca, Colombia.

El restaurante paga una suscripción a DOMIGOO. El domiciliario no paga por recibir ofertas. El cliente paga la comida al restaurante y el domicilio al domiciliario. DOMIGOO no custodia ese dinero. El valor de la comida y el valor del domicilio van separados. Los medios de pago (efectivo, Nequi, Daviplata, transferencia) se registran y no se procesan.

## Estado

M05 deja el registro y la sesión: Argon2id, cookie HttpOnly y token de móvil hasheado. La próxima misión es **M06**: autorización.

## Calidad

```bash
pnpm install
pnpm lint
pnpm typecheck
docker compose up -d
./scripts/postgis-version.sh
DATABASE_URL=postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo pnpm --filter @domigoo/api test
./scripts/check-contract.sh
```

El compilador es TypeScript 6.0.3. La versión 7.0 no entra todavía: `typescript-eslint` 8.72 exige `typescript` anterior a 6.1.

## Superficies

| Superficie            | Uso                                                                                                | Cliente previsto   |
| --------------------- | -------------------------------------------------------------------------------------------------- | ------------------ |
| DOMIGOO Restaurantes  | Establecimientos, sucursales, solicitudes directas y abiertas, seguimiento, suscripción            | Web                |
| DOMIGOO Domiciliarios | Registro abierto o por invitación, solo motocicleta en V1, verificación, disponibilidad, servicios | Android (Expo)     |
| DOMIGOO Admin         | Verificación, tarifas, suscripciones, incidentes, estadísticas                                     | Web, origen aparte |
| DOMIGOO Tracking      | Seguimiento con enlace privado, sin instalar una app                                               | Página pública     |

La verificación documental combina reglas automáticas y aprobación humana. Hay PIN de recogida, PIN de entrega, GPS con consentimiento, incidentes y auditoría. El tratamiento de datos personales sigue la Ley 1581 de 2012.

## Documentación

- [Entorno de desarrollo y CI](docs/entorno.md): qué se pudo probar en esta VM (PostGIS 17/3.5 en Docker) y qué no (FCM real, emulador Android).
- [Arquitectura](docs/arquitectura.md): contenedores, despacho, dinero y los ajustes a la propuesta técnica.
- [Modelo de datos](docs/modelo-datos.md) y el contrato [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma).
- [Módulos y máquinas de estado](docs/modulos.md).
- [Plan de misiones](docs/plan-misiones.md): M01 en adelante, con pruebas y criterios de aceptación.
- [Pruebas y seguridad](docs/pruebas-y-seguridad.md).
- [Decisiones, riesgos y ejecución autónoma](docs/decisiones/README.md).

## Cómo está pensado el sistema

Monorepo con pnpm. Next.js para las webs, Expo para Android, NestJS como única fuente de reglas, PostgreSQL con PostGIS, Prisma 7 y OpenAPI. Redis no entra en V1. El push va detrás de un puerto: en CI se usa un adaptador en memoria, sin credenciales de Firebase.

No hay servidor ni aplicación de negocio que arrancar en este commit.
