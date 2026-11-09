# ADR-008. Push detrás de un puerto y bandeja en PostgreSQL

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

El domiciliario necesita enterarse de una oferta con la app en segundo plano. FCM es el canal previsto. En la VM y en CI no hay credenciales de Firebase, y no se van a crear para probar.

## Decisión

`PushSender` es un puerto. `RecordingPushSender` registra plantilla, usuario y payload en las pruebas. `FcmPushSender` solo se construye si la credencial está configurada. La filas nacen en `notification_outbox` dentro de la misma transacción que la oferta, y un ciclo del propio proceso las envía.

El payload lleva identificadores y una frase corta. No lleva dirección, teléfono, documento ni PIN. Quien abre la app pide el detalle a la API.

## Consecuencias

CI puede exigir el contenido del aviso sin red hacia Google. Un fallo de FCM reintenta desde la bandeja. Firebase, cuando se use, queda como encargado de un dato mínimo y el aviso de privacidad tiene que decirlo.

## Alternativas

Llamar a FCM desde el controlador de despacho. Se descarta: no se puede probar y mezcla un proveedor con la regla. SMS. Se descarta en V1: es otro proveedor y otro dato. Solo polling. Se descarta como único mecanismo: la oferta vence y el domiciliario no estaría mirando la pantalla.
