# ADR-007. PIN y enlace de tracking

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

Hace falta un control de que la comida salió del local y de que llegó a quien corresponde, sin app para el cliente. El restaurante debe poder volver a ver el PIN de recogida y el enlace.

## Decisión

PIN de 6 dígitos, generado con CSPRNG. Se verifica con HMAC-SHA-256 y un pepper de entorno, asociado al pedido y al tipo de PIN. Se muestra de nuevo gracias a un ciphertext AES-256-GCM. El domiciliario nunca recibe el PIN en una respuesta: lo digita. El de recogida nace al aceptar y lo ve el restaurante hasta la recogida. El de entrega nace al recoger y lo ve el tracking hasta la entrega. Cinco intentos fallidos abren un incidente y no avanzan el estado.

El enlace es un token de 32 bytes. En la base hay hash y ciphertext, nunca el token en claro. La página pública no lista teléfonos, documentos, comida ni el PIN de recogida.

Al cerrar el pedido se anulan los ciphertext de los PIN.

## Consecuencias

Sin el pepper y sin la clave de cifrado no se operan los PIN. Esas claves son configuración local, distintas en cada ambiente, y no van al repositorio. Perder la clave impide volver a mostrar PIN ya emitidos; la verificación también falla sin el pepper. Por eso el arranque se niega a continuar si faltan cuando la misión que los usa ya está desplegada en local.

## Alternativas

Guardar el PIN en claro. Se descarta. Un PIN de 4 dígitos. Se descarta: el espacio es cien veces menor y el costo de seis dígitos para una persona es bajo. Un código QR firmado en vez de PIN. Se deja fuera de V1: el teléfono del cliente no tiene app y el domiciliario ya tiene un teclado.
