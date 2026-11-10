# Registro de riesgos

Impacto y probabilidad en escala baja, media o alta. Dueño `ingeniería` si el plan ya lo trata. Dueño `negocio` si hace falta una decisión fuera del código. Ninguno de los riesgos de negocio bloquea M01: el software usa el supuesto indicado hasta que se cambie con una ADR o con un dato de configuración.

| Id | Riesgo | Impacto | Prob. | Supuesto o mitigación | Dueño |
| --- | --- | --- | --- | --- | --- |
| R01 | El nombre DOMIGOO o un dominio no están disponibles | Medio | Media | `APP_NAME` configurable. No se compran dominios en el código. | Negocio |
| R02 | Prisma 8 estable obliga a reescribir el contrato geo | Medio | Media | ADR-003 fija 7.10 hasta una ADR de reemplazo. No se migra a medias. | Ingeniería |
| R03 | En la VM el daemon de Docker no arranca solo | Medio | Alta | [entorno.md](../entorno.md) documenta el arranque manual. CI no depende de ese arranque. | Ingeniería |
| R04 | No hay emulador Android en CI | Bajo | Alta | Jest y typecheck. La prueba en teléfono es manual y no es compuerta. | Ingeniería |
| R05 | El adaptador falso de FCM diverge del real | Medio | Media | El puerto es estrecho y el payload está prohibido de llevar PII. La primera prueba real es posterior a esta etapa y con credencial fuera del repo. | Ingeniería |
| R06 | El reparto responsable/encargado del dato del cliente no coincida con el criterio jurídico | Alto | Media | Supuesto de ADR-009. Cambiar el aviso no cambia las tablas. | Negocio |
| R07 | IVA, retención y factura de la suscripción no están modelados | Alto | Alta | No se cobra de verdad en estas misiones. Los montos son enteros en pesos, sin impuesto calculado. | Negocio |
| R08 | No hay polígono oficial de Tocancipá | Medio | Alta | Semilla marcada como envolvente de desarrollo. El motor ya admite reemplazar la versión publicada. | Negocio aporta el polígono; ingeniería ya dejó el cauce |
| R09 | PIN de 6 dígitos si se filtra el pepper | Alto | Baja | Tope de intentos, vida corta, pepper fuera de la base. ADR-007. | Ingeniería |
| R10 | Alguien levanta una segunda réplica y el rate limit deja de servir | Medio | Baja | El límite de intentos de ingreso vive en memoria y debe pasar a PostgreSQL antes de tener más de una réplica. ADR-004 prohíbe esa segunda réplica mientras tanto. No se resuelve en la fase 3. | Ingeniería |
| R11 | El enlace de tracking se reenvía y quien lo tiene ve el recorrido | Medio | Alta | Token largo, revocación, vencimiento, datos mínimos. Es un secreto al portador por diseño. | Ingeniería |
| R12 | Documentos de identidad en disco local | Alto | Alta | Solo desarrollo y CI. Producción no se abre con ese adaptador. | Ingeniería |
| R13 | La primera aceptación gana, sin reputación | Medio | Alta | Decisión de V1. No hay tabla de puntuación a propósito. | Negocio, si quiere cambiarlo antes de M23 |
| R14 | La invitación se interprete como vínculo distinto al de un independiente | Alto | Baja | El software no liquida salario ni exige exclusividad. El texto del contrato con el domiciliario es del negocio. | Negocio |
| R15 | Coordenadas mal digitadas porque no hay geocodificador | Medio | Alta | La API exige el punto. La web de M29 pide latitud y longitud, no una dirección suelta. | Ingeniería |
| R16 | FCM como transmisión internacional de un token | Medio | Media | Payload mínimo y mención en el aviso. En CI no sale de la máquina. | Negocio en el texto del aviso; ingeniería en el payload |
| R17 | M04 aplica el esquema completo y un error de diseño se corrige con otra migración | Bajo | Media | El esquema ya se aplicó una vez en PostGIS 3.5. Un cambio posterior es una migración nueva, no un edit de la historia. | Ingeniería |
| R18 | Plazos de retención distintos del criterio contable final | Medio | Media | Tabla de trabajo en el modelo de datos. Ajustable en M37 sin entidad nueva. | Negocio |

## Supuestos que el agente no vuelve a preguntar

1. Reparto de responsabilidades de datos de la fila R06.
2. La tarifa publicada es el domicilio que ven restaurante y domiciliario. El restaurante no la edita en V1.
3. No hay geocodificador. El cliente de la API envía coordenadas.
4. Precios, días de prueba y polígono son datos semilla, no constantes repartidas en el código.
5. El nombre de desarrollo es DOMIGOO y puede cambiar con `APP_NAME`.

Si el negocio corrige uno de estos puntos, se actualiza la semilla, el aviso o una ADR. No se reabre la fase 0.
