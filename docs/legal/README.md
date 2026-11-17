> # ⚠️ BORRADOR — debe ser revisado por un abogado colombiano antes de publicarse
>
> Estos textos son un borrador de trabajo. No constituyen asesoría legal y **no deben publicarse** hasta que un abogado colombiano los revise y se reemplacen todos los marcadores entre corchetes.
>
> Versión 0.1 (borrador) · Fecha del borrador: 16 de noviembre de 2026

# Textos legales de DOMIGOO

Plataforma web y móvil de domicilios en Tocancipá, Cundinamarca, Colombia (clientes, restaurantes y domiciliarios independientes).

## Archivos

| Archivo | Contenido | Dónde se usa |
|---|---|---|
| `terminos-y-condiciones.md` | Términos generales para todos los usuarios | Registro, pie de página, menú de la app |
| `politica-tratamiento-datos.md` | Política completa de tratamiento de datos (Ley 1581/2012) | Enlace público permanente |
| `autorizacion-tratamiento-datos.md` | Casillas cortas del registro + autorización larga | Formulario de registro |
| `consentimiento-geolocalizacion.md` | Pantallas de consentimiento de ubicación (domiciliarios y clientes) y revocatoria | Antes del permiso de ubicación del sistema |
| `terminos-domiciliarios.md` | Términos para domiciliarios independientes | Registro de domiciliarios |
| `terminos-restaurantes.md` | Términos para restaurantes | Registro de restaurantes |

## Marcadores que el propietario debe completar

**Datos de la empresa (en todos los documentos)**
- `[RAZÓN SOCIAL]`, `[NIT]`, `[DIRECCIÓN]`
- `[CORREO DE CONTACTO]` (soporte y PQR), `[TELÉFONO]`, `[HORARIO DE ATENCIÓN]`
- `[CORREO DE PROTECCIÓN DE DATOS]`, `[OFICIAL DE PROTECCIÓN DE DATOS]` (persona o área)
- `[FECHA DE ENTRADA EN VIGENCIA]`
- `[URL DEL SITIO]`, `[RUTA DE LA POLÍTICA]`

**Operación**
- `[ZONA DE COBERTURA]` (polígono de Tocancipá por definir)
- `[PROVEEDOR DE MAPAS]`, `[PROVEEDOR DE CORREO/SMS]`, `[OTROS PROVEEDORES]`
- `[OTROS DATOS DE VERIFICACIÓN…]` y `[OTROS: p. ej. RUT, certificado de antecedentes…]` (domiciliarios)
- `[OTROS CRITERIOS]` de asignación de pedidos y de orden de restaurantes; si las calificaciones influyen `[sí / no]`
- Cómo se fija el valor del domicilio `[DEFINIR…]`
- Reglas de entrega de efectivo entre domiciliario y restaurante `[DEFINIR…]`
- Si se permite vender alcohol `[DEFINIR…]`
- Frecuencia de envío de ubicación `[X] segundos`; tiempo de aceptación de pedidos `[X] minutos`

**Precios (pendientes)**
- `[PRECIOS POR DEFINIR]`, `[NOMBRE DEL PLAN DE PRUEBA]`, `[NOMBRE DEL PLAN 1/2]`, `[PRECIO]`, `[MENSUAL]`, `[FUNCIONES]`
- Qué pasa si el restaurante no acepta un plan pago `[PLAN GRATUITO / SUSPENSIÓN DE LA CUENTA]`

**Plazos propuestos entre corchetes (confirmar o cambiar)**
- Preaviso de precios: `[30]` días · cambios de términos: `[15]` días
- Reporte de incidentes del cliente: `[24]` horas
- Descargos ante suspensión: `[5]` días hábiles · respuesta de restaurantes a PQR: `[3]` días hábiles
- Conservación: cuenta `[2]` años, pedidos `[5]` años, recorridos GPS `[90]` días, documentos de domiciliarios `[1]` año, PQR `[3]` años
- Vigencia del certificado de Cámara de Comercio: `[30]` días

## Decisiones legales pendientes (revisar con el abogado)

1. **Ley 2466 de 2025 y Decreto 0991 de 2026 (plataformas de reparto).** La reforma laboral obliga a las plataformas digitales de reparto a aportar el 60 % de salud y pensión y el 100 % de riesgos laborales de los repartidores independientes, actuar como agentes de retención, inscribirse ante el Ministerio del Trabajo y cumplir deberes de transparencia. Estas obligaciones entran a regir 12 meses después de que se certifique la operatividad de la PILA. Hay que confirmar si DOMIGOO cae en esa definición (los clientes pagan en efectivo directamente al domiciliario) y desde cuándo le aplica. Por eso, los términos de domiciliarios **no** dicen que la seguridad social sea solo responsabilidad del domiciliario: la cláusula 3 deja a salvo esas obligaciones.
2. **Riesgo de que se reconozca una relación laboral.** Si DOMIGOO fija la tarifa del domicilio, impone turnos, sanciona por rechazar pedidos o exige exclusividad, aumenta el riesgo de que se declare un contrato de trabajo (primacía de la realidad). La operación real debe coincidir con lo que dicen los textos.
3. **Rol de DOMIGOO ante el consumidor.** Los textos presentan a DOMIGOO como portal de contacto (art. 53, Ley 1480). La SIC ha atribuido responsabilidades a plataformas de domicilios; conviene confirmar el alcance de la responsabilidad solidaria y de la garantía.
4. **RNBD.** Hoy solo es obligatorio para sociedades y ESAL con activos totales superiores a 100.000 UVT (Decreto 090 de 2018). Confirmar si aplica y, de todos modos, designar al oficial de protección de datos.
5. **Transferencia internacional.** Confirmar las regiones reales de Vercel y Neon, firmar o aceptar sus acuerdos de procesamiento de datos (DPA) como contrato de transmisión y verificar que la Circular 005 de 2017 de la SIC siga vigente para Estados Unidos.
6. **Datos sensibles.** Decidir si se verifican antecedentes judiciales de domiciliarios y si se usa reconocimiento facial (en ese caso se necesita un análisis adicional de datos biométricos).
7. **Prueba de 15 días para clientes.** Se pidió para "todo usuario registrado". Para clientes no tiene efecto práctico mientras el servicio sea gratis; decidir si se mantiene en los términos generales.
8. **Alcohol y tabaco.** Decidir si se permiten; si sí, definir la verificación de edad al entregar.
9. **Plazos de conservación** y de preaviso (los valores entre corchetes son propuestas).
10. **Cancelaciones de pedidos** después de aceptados: definir la regla (hoy remite a las condiciones de cada restaurante).
11. **Pagos en línea futuros.** Cuando existan, actualizar por reversión del pago (art. 51, Ley 1480), facturación de la suscripción y datos financieros (PCI DSS).

## Marco legal usado

Ley 1581 de 2012 · Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) · Decreto 090 de 2018 (RNBD) · Ley 1480 de 2011 · Ley 527 de 1999 · Ley 2466 de 2025 y Decreto 0991 de 2026 · Ley 769 de 2002 · Ley 9 de 1979 y Resolución 2674 de 2013 · Ley 2232 de 2022 · Estatuto Tributario y Resolución DIAN 000165 de 2023. La Ley 1266 de 2008 (habeas data financiero) **no aplica** por ahora: DOMIGOO no trata información crediticia ni reporta a centrales de riesgo.
