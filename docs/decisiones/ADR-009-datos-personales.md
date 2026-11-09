# ADR-009. Minimización y Ley 1581

- **Estado:** Aceptada
- **Fecha:** 2026-11-09

## Contexto

El sistema trata cédulas, ubicación y teléfonos de clientes que no tienen cuenta. La Ley 1581 de 2012 y el Decreto 1074 de 2015 aplican al tratamiento en Colombia.

## Decisión

Los consentimientos se guardan por propósito y por versión del texto. El GPS exige un consentimiento vigente y se corta al revocarlo. Los documentos viven fuera de la base, en un adaptador privado. Las respuestas se recortan según la matriz de [pruebas-y-seguridad.md](../pruebas-y-seguridad.md). La auditoría nace redactada y es append-only.

Supuesto de trabajo, no un dictamen: DOMIGOO es responsable de cuentas, documentos y ubicación de restaurantes y domiciliarios. El restaurante es responsable de los datos del cliente que escribe. DOMIGOO los trata como encargado solo para el servicio y el enlace.

Los plazos de retención de la tabla del modelo de datos son el comportamiento del software hasta que asesoría los cambie. Cambiarlos no exige rediseñar entidades; exige ajustar el job de M37 y el aviso.

## Consecuencias

Hay columnas que no se borran en una solicitud de supresión (montos y auditoría). El producto tiene que explicarlo en el aviso. La posición histórica se borra a los 30 días porque no hace falta más para el tracking ni para un incidente reciente.

## Alternativas

Un único consentimiento genérico. Se descarta: no permite revocar el GPS y seguir teniendo cuenta. Tratar a DOMIGOO como único responsable también de la agenda de clientes del restaurante. Sería más simple de redactar y más ancho de lo que el sistema hace. Se deja como supuesto explícito para que el negocio lo corrija sin frenar el esquema.
