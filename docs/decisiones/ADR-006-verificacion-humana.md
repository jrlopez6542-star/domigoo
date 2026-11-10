# ADR-006. La verificación automática no aprueba

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

El domiciliario se registra por su cuenta o por invitación, solo en motocicleta, con documentos completos. El producto pide verificación automática y aprobación humana. Esta fase no puede usar otros modelos ni proveedores de IA.

## Decisión

La verificación automática es un conjunto cerrado de reglas sobre datos estructurados y sobre el archivo (presencia, MIME, tamaño, fechas, placa única, tipo de vehículo, documento único). Si una regla falla, el caso vuelve a `NEEDS_CHANGES`. Si todas pasan, el caso queda en `PENDING_HUMAN`. El estado `APPROVED` solo lo escribe un revisor, con motivo, comentario y auditoría.

No hay OCR ni un modelo que "lea" la cédula. La imagen la mira la persona revisora. La invitación no salta este embudo.

La suspensión es independiente: no reescribe la decisión vieja.

## Consecuencias

El tiempo de alta depende de un humano. A cambio, una regla defectuosa no deja a un domiciliario operativo. Añadir un lector de documentos en el futuro es otra ADR y sigue sin poder ser la aprobación final mientras esta decisión siga vigente.

## Alternativas

Aprobar en automático cuando las reglas pasan. Se descarta: contradice la aprobación humana. Enviar las imágenes a un proveedor de visión. Se descarta por el encargo y porque sería una transferencia de datos sensibles.
