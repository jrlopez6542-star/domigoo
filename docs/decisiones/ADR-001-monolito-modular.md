# ADR-001. Monolito modular

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

El producto tiene varios papeles (restaurante, domiciliario, admin, tracking) y reglas que se cruzan: una aceptación de oferta toca pedido, disponibilidad, PIN y bandeja de avisos. El mercado inicial es un municipio.

## Decisión

Un solo servicio NestJS dividido en los módulos de [modulos.md](../modulos.md). Los módulos se hablan por puertos. No se crean repositorios ni despliegues separados por dominio.

## Consecuencias

Una transacción de PostgreSQL puede cambiar el pedido y las ofertas juntas. El costo es que un error de guardia en un módulo comparte proceso con los demás. Las guardas y la separación del admin en otro origen de frontend reducen ese costo sin partir la base.

## Alternativas

Microservicios por superficie. Se descartan: partirían la transacción de aceptación y añadirían red, sin un equipo ni un tráfico que lo justifiquen. Extraer un servicio más adelante exige otra ADR.
