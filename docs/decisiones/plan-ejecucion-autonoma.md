# Plan de ejecución autónoma

Cómo debe trabajar un agente de ingeniería a partir de M01, sin esperar una instrucción nueva por cada archivo. La fase 0 no implementa esas misiones: solo deja el orden.

## Unidad de trabajo

Una misión de [plan-misiones.md](../plan-misiones.md) es un pull request. La rama sale de la rama base vigente del repositorio. El título del PR cita el identificador (`M01`, `M02`, …).

El agente no junta dos misiones "porque son pequeñas" ni adelanta endpoints de la misión siguiente para "dejarlo listo". Si una misión revela que el contrato está mal, se detiene, escribe una ADR y no rehace el diseño dentro del mismo cambio de código.

## Orden de cada misión

1. Leer la ficha, los módulos que toca y las ADR relacionadas.
2. Comprobar el entorno que la ficha necesita. Si hace falta PostGIS, seguir [entorno.md](../entorno.md): el daemon de Docker no queda encendido solo en la VM de agente.
3. Implementar solo el alcance. Los textos de interfaz van en español. Los identificadores van en inglés.
4. Añadir las pruebas de la ficha. Las de base usan `postgis/postgis:17-3.5`, el mismo imagen en Compose y en CI.
5. Ejecutar en local lo que la VM permita y dejar el workflow verde sin secretos.
6. Añadir una fila a [bitacora.md](bitacora.md) con el resultado y con lo que no se pudo ejecutar.
7. Abrir el pull request con los criterios de aceptación marcados como cumplidos o como pendientes. Un criterio pendiente no se presenta como cumplido.

## Paradas obligatorias

El agente se detiene y no improvisa si ocurre cualquiera de estos casos:

- Hace falta una credencial de Firebase, un dominio, una pasarela, una tienda o un ambiente de producción para dar el criterio por cumplido. Esos criterios no existen en el plan; si alguien los añade, se rechazan en esta etapa.
- La prueba de integración solo pasa sustituyendo PostGIS por otra base.
- Hay que aprobar a un domiciliario sin decisión humana, u ocultar un fallo de regla.
- Hay que guardar un número de cuenta, un saldo o el PIN en claro.
- La misión siguiente parece necesaria para demostrar la actual. Se recorta la demo, no se adelanta la misión.
- Un dato real de una persona (cédula, teléfono, foto) aparece en el material de trabajo. No se commitea.

No hay preguntas de negocio abiertas que bloqueen M01. Los supuestos editables están en [riesgos.md](riesgos.md). El agente los aplica y no los vuelve a preguntar en cada misión.

## Qué cuenta como verde

CI de GitHub Actions en `ubuntu-latest`, sin secretos, con el servicio PostGIS a partir de M02. La VM puede correr las mismas pruebas cuando el daemon arranca. Un emulador Android no es parte del verde. El adaptador de push en memoria sí lo es.

## Qué no hace el agente al cerrar una misión

No mergea a la rama base si el repositorio no se lo permite. No despliega. No publica la app. No compra el nombre. No carga la semilla de admin con una contraseña escrita en el código: esa semilla solo lee variables de entorno.
