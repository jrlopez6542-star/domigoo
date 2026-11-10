# ADR-005. Sin custodia y sin pasarela

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

El restaurante paga la suscripción a DOMIGOO. El cliente paga la comida al restaurante y el domicilio al domiciliario. El encargo prohíbe que DOMIGOO custodie el dinero del domicilio y prohíbe, en esta etapa, integrar pagos.

## Decisión

`foodAmountCop` y `deliveryFeeCop` son columnas distintas en toda la vida del pedido. El medio (`CASH`, `NEQUI`, `DAVIPLATA`, `TRANSFER`) es una etiqueta. No se guardan números de cuenta ni de billetera.

La suscripción copia el precio del plan al abrir el periodo. Un humano declara un pago y un admin lo reconoce. Esa acción no abre una conexión a un banco. No hay tabla de saldo, de billetera ni de intento de cobro.

El domiciliario ve el domicilio desde la oferta y no ve el monto de la comida. La cotización queda congelada en `tariff_quotes`.

## Consecuencias

DOMIGOO no puede conciliar el efectivo de la calle. Tampoco queda sujeto, por el software de V1, a capturar fondos de terceros. Factura electrónica, IVA y retenciones no se calculan: es un riesgo de negocio antes del primer cobro real, no una misión de código.

## Alternativas

Guardar el celular de Nequi "por si se integra después". Se descarta: amplía el dato personal sin un flujo que lo use. Una pasarela en modo sandbox. Se descarta en esta fase: el encargo dice que no hay pagos, y un sandbox sigue siendo una integración que hay que borrar o cuidar.
