# Pruebas y seguridad

Estrategia para las misiones de [plan-misiones.md](plan-misiones.md). Lo que la VM y CI pueden ejecutar de verdad está medido en [entorno.md](entorno.md).

## 1. Pirámide

| Capa | Dónde corre | Qué demuestra | Qué no demuestra |
| --- | --- | --- | --- |
| Unitaria | `pnpm test` en la VM y en CI, sin Docker | Transiciones, cotización en enteros, PIN, elegibilidad pura, ocultamiento de campos | Que el SQL o el índice existan |
| Integración | `pnpm test:integration` con `postgis/postgis:17-3.5` | Migración, GiST, `ST_DWithin` en metros, transacciones de aceptación, disparador de auditoría | La tienda de aplicaciones ni un teléfono real |
| API e2e | El mismo PostGIS, Supertest, sin navegador | El recorrido M38 y los abusos marcados abajo | El CSS |
| Web e2e | Playwright contra web, admin y la API | Publicar, aprobar, ver el tracking | La app nativa |
| Móvil | Jest y typecheck. Recorrido en dispositivo es manual y no bloquea el merge | Que la oferta no pinte el teléfono y que el PIN se envía al endpoint correcto | GPS real, FCM real, Play Store |

No se añade un cuarto doble de la base en memoria para "ir más rápido" en las pruebas marcadas como integración. Un mock del repositorio no habría detectado un índice GiST mal generado.

Datos de prueba: personas y teléfonos sintéticos, placas inventadas, coordenadas alrededor de Tocancipá (el punto de referencia usado en la inspección es longitud `-73.9132`, latitud `4.9655`). Ningún archivo de cédula real entra al repositorio. Los polígonos de semilla se etiquetan como envolvente de desarrollo, no como límite municipal.

## 2. Reparto entre la VM y CI

- Unitarias: las dos.
- Integración y e2e de API: CI siempre. En la VM, solo si `dockerd` está en marcha. El procedimiento de arranque está en [entorno.md](entorno.md). Si el daemon no arranca, no se cambia la prueba por SQLite; se deja CI como compuerta y se anota la bitácora.
- Playwright: CI con navegador instalado en el workflow a partir de M29. En la VM se puede correr la misma orden.
- FCM: el adaptador que registra en memoria, en los dos sitios. El adaptador de Firebase no se construye sin credencial, y CI no tiene credencial.
- Emulador Android: no es compuerta. `/dev/kvm` existe en la VM inspeccionada, pero no hay SDK ni emulador, y no se instala uno para cerrar una misión.

## 3. Herramientas

- API y dominio: Jest, que es el corredor que NestJS ya integra. Supertest para HTTP.
- Web y admin: Playwright.
- App: Jest con el preset de Expo, sin Detox en CI.
- Migraciones: `prisma migrate deploy` contra la base del job, nunca `db push` en CI.
- Contrato: el OpenAPI publicado se valida como documento. A partir de M29 los clientes generan tipos y el typecheck falla si se desvían.

Una base por corrida, nombre distinto, destruida al final. Las pruebas de integración no comparten filas entre archivos.

## 4. Compuerta de seguridad de M38

Estas pruebas son automáticas y tienen que estar verdes para dar por cerrada la fase de implementación inicial. Varias se escriben antes, en la misión que introduce la regla. M38 las reúne para que no se pierdan.

| Caso | Resultado esperado |
| --- | --- |
| Aceptar la misma oferta dos veces en paralelo | Una asignación y un conflicto |
| Oferta a un domiciliario no aprobado, suspendido o con SOAT vencido | No se crea la oferta |
| Publicar con suscripción vencida | 422 |
| Leer un pedido de otro restaurante | 403 o 404, el mismo código que si no existiera |
| PIN incorrecto repetido hasta el tope | El estado no cambia y nace un incidente `PIN_LOCKOUT` |
| Respuesta al domiciliario | Sin `foodAmountCop` y sin PIN; sin teléfono del cliente si la oferta sigue pendiente |
| Tracking | Sin teléfono del domiciliario, sin documento, sin comida, sin PIN de recogida; PIN de entrega solo en `PICKED_UP` y `AT_DROPOFF` |
| Token de tracking alterado | Respuesta genérica, sin ficha |
| `UPDATE` directo de `audit_logs` | Excepción del disparador |
| Diff de auditoría de un login o de un PIN | No contiene contraseña, token, PIN ni ciphertext |
| Carga de documento | Rechazo por MIME o por tamaño; el archivo aceptado no queda en una ruta pública |
| Push registrado por el adaptador falso | Sin dirección, teléfono, documento ni PIN |
| Revocar consentimiento de GPS | El ping siguiente se rechaza |
| Reconocimiento de suscripción | Cero conexiones salientes de pago (no hay cliente de pasarela en el grafo de módulos) |

## 5. Controles de DOMIGOO Identity y DOMIGOO Guardian

Identidad:

- Argon2id para contraseñas, parámetros revisados en M05 y fijados en código, no en una petición del cliente.
- El token de sesión se guarda hasheado. La cookie de web y de admin es `HttpOnly`, `Secure` fuera de localhost y `SameSite`.
- La app usa el token de sesión y lo puede revocar. No hay un token de larga vida sin fila en `sessions`.
- Guardas por papel y por pertenencia del recurso. Las pruebas de objeto ajeno son obligatorias en cada recurso nuevo.
- Invitación hasheada, de un solo uso, y sin atajo hacia `APPROVED`.
- La decisión humana guarda revisor, motivo y comentario, y la proyección del domiciliario cambia en esa transacción.

Guardian:

- `canPublish` y `canReceiveOffer` son funciones puras con pruebas de tabla. Los módulos las llaman después de cargar los hechos; no reimplementan la condición en el controlador.
- PIN: CSPRNG, HMAC-SHA-256 con pepper, AES-256-GCM para volver a mostrarlo, tope de intentos, comparación en tiempo constante.
- Enlace de tracking al portador, hash en la base, rate limit en memoria del proceso (suficiente para una réplica). El límite y su prueba llegan con M27.
- GPS solo con consentimiento vigente y solo en `AVAILABLE` o `ON_SERVICE`.
- Suspensión inmediata fuera de la búsqueda por radio.

Secretos de entorno previstos, ninguno con valor real en el repo: `DATABASE_URL`, `SESSION_PEPPER` si se separa del hash de contraseña, `PIN_PEPPER`, `DATA_ENCRYPTION_KEY`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, y más adelante la credencial de FCM. Se leen al arrancar. Si falta una clave que la misión ya exige, el proceso no arranca.

Registro de logs: se redactan autorización, cookie, PIN, ciphertext, token de push y número de documento. La prueba de M07 fija el criterio para auditoría; el logger de la API se cubre con una prueba del formateador en M05.

Cabeceras de la API: sin huella de versión de más, `nosniff`, y CORS limitado a los orígenes de web y admin. El tracking no refleja el origen en datos de negocio.

Archivos: nombre de almacenamiento opaco, directorio fuera de la raíz web, comprobación de MIME por firma además de la cabecera cuando la misión M17 lo implemente, tope de 10 MB.

## 6. Ley 1581 de 2012

El tratamiento previsto se apoya en la Ley 1581 de 2012 y en el Decreto 1074 de 2015. La autoridad de protección de datos es la Superintendencia de Industria y Comercio. Esta sección es el control de ingeniería, no un concepto jurídico.

Principios y dónde se cumplen:

| Principio | Control en el sistema |
| --- | --- |
| Finalidad | Cada consentimiento tiene propósito (`ACCOUNT`, `GEOLOCATION`, `DOCUMENT_STORAGE`, `ORDER_CONTACT`). El GPS no se usa para otra cosa. |
| Libertad | Sin consentimiento no hay alta, no hay archivo o no hay ping, según el propósito. La revocatoria corta el uso nuevo. |
| Transparencia | El texto aceptado es una versión con hash. El nombre del producto en el aviso sale de `APP_NAME`. |
| Acceso y circulación restringida | Matriz de la sección 7. El tracking al portador es la excepción consciente, acotada por el token. |
| Seguridad | Controles de la sección 5, auditoría append-only, archivos privados. |
| Confidencialidad | Minimización de respuestas y de push. |

Papeles, como supuesto de trabajo registrado en [riesgos](decisiones/riesgos.md): DOMIGOO es responsable de las cuentas, los documentos y la ubicación de restaurantes y domiciliarios. El restaurante es responsable de los datos del cliente que digita. DOMIGOO trata esos datos del cliente como encargado, solo para operar el servicio y el enlace. El aviso tiene que decirlo con ese reparto cuando el negocio lo confirme.

Transmisión fuera de Colombia: el token de dispositivo y el payload mínimo viajan a Firebase si el adaptador real está activo. El payload no lleva dirección, teléfono, documento ni PIN. El aviso de privacidad tiene que mencionar ese encargado. En desarrollo y CI el adaptador falso no sale de la máquina.

La inscripción en el Registro Nacional de Bases de Datos depende del tamaño de la sociedad y de la norma vigente al momento de operar. Es una obligación del negocio, no un módulo. No se afirma aquí que corresponda o no corresponda.

Derechos: M37 cubre el conducto de acceso, corrección, supresión, revocatoria y reclamo. La supresión no borra el rastro contable de montos. Los plazos de retención de trabajo están en [modelo-datos.md](modelo-datos.md).

No se tratan datos de niños. No hay cuenta de cliente final. El teléfono del cliente lo aporta el restaurante para una entrega, no para un perfil.

## 7. Matriz de visibilidad

| Dato | Restaurante del pedido | Domiciliario | Tracking | Revisor | Operaciones |
| --- | --- | --- | --- | --- | --- |
| Comida | Sí | No | No | No | Sí |
| Domicilio | Sí | Sí, desde la oferta | No | No | Sí |
| Nombre y teléfono del cliente | Sí | Solo asignado, hasta el cierre | No | No | Sí |
| PIN de recogida | En los estados de recogida | No, solo lo digita | No | No | No |
| PIN de entrega | No | No, solo lo digita | En camino al cliente | No | No |
| Documentos del domiciliario | No | Los propios | No | Sí | No |
| Posición | No | La propia | Última, mientras el servicio está activo | No | En un incidente |
| Auditoría | No | No | No | No | Seguridad y superadmin |

`SECURITY` lee auditoría. `REVIEWER` no suspende. `OPERATIONS` suspende, publica tarifas y reconoce declaraciones. `SUPERADMIN` puede lo anterior. El detalle de rutas está en [modulos.md](modulos.md).

## 8. Amenazas que V1 acepta y deja escritas

- Una réplica y un límite en memoria no contienen a un atacante si mañana hay dos procesos. El ADR de Redis fija cuándo cambia.
- El enlace de tracking es un secreto al portador. Quien lo reenvía concede la lectura. Se puede revocar.
- Seis dígitos de PIN son un espacio pequeño si el pepper se filtra. El tope de intentos y la vida corta del PIN son el control principal.
- El disco local de documentos no sirve fuera de desarrollo. Producción, cuando exista, usa un almacén privado. Esta fase no lo contrata.
- No hay reputación ni puntuación del domiciliario. La primera aceptación gana. Es una decisión de producto de V1, no un olvido de la cola.

## 9. Qué no se prueba en esta fase

Pagos reales, entrega de un mensaje FCM a un teléfono, precisión del GPS en calle, el alta en Play Store, la compra de un dominio y cualquier entorno de producción. Probarlos exigiría cuentas y acciones irreversibles que el encargo excluye.
