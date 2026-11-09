# Entorno de desarrollo y de CI

Fecha de la inspección: 2026-11-09. Los comandos se ejecutaron en la VM de este agente. Un agente nuevo puede encontrar la VM recién creada y tiene que repetir la instalación de Docker; los paquetes no forman parte de la imagen base.

## Qué hay en la VM

| Pieza | Resultado |
| --- | --- |
| Sistema | Ubuntu 24.04.5 LTS, kernel `6.12.113+`, x86_64, 4 vCPU |
| Memoria | Docker informó unos 16 GiB. `free` puede mostrar mucho menos porque el hipervisor mantiene un balloon (en la inspección, del orden de 10 GiB). No usar `free` como techo de capacidad. |
| Node.js | 22.23.4 |
| npm / pnpm / Corepack | 10.9.9 / 10.33.4 / 0.36.0 |
| Yarn | 1.22.22. No se usará. |
| Bun | No está instalado. No hace falta. |
| Python / JDK | 3.12.3 / OpenJDK 21 |
| Git y GitHub CLI | Disponibles. El remoto es este repositorio. |
| PostgreSQL, PostGIS, Redis, psql | No vienen instalados en el host. |
| Android SDK, adb, emulador, QEMU | No están. `/dev/kvm` sí existe. |
| Credenciales Firebase, FCM o Google | No hay variables de ese tipo. |
| systemd | `systemctl is-system-running` respondió `offline`. `policy-rc.d` impide arrancar servicios al instalarlos. |
| Red | El registro de npm, los archivos de Ubuntu y Docker Hub respondieron durante la inspección. |

## Docker y PostGIS

`docker.io` 29.1.3 y el plugin Compose 2.40.3 están en los repositorios de Ubuntu y se pueden instalar con `apt`. Después de instalarlos el daemon no queda en marcha: no hay socket en `/var/run/docker.sock` hasta arrancarlo a mano.

Arranque que funcionó en esta VM:

```bash
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2
sudo dockerd --host=unix:///var/run/docker.sock
```

Con el daemon en marcha se probó `postgis/postgis:17-3.5` (PostGIS 3.5, `USE_GEOS=1 USE_PROJ=1 USE_STATS=1`). Dos puntos de ejemplo en la zona de Tocancipá, `POINT(-73.9132 4.9655)` y `POINT(-73.9200 4.9700)`, dieron `ST_Distance` ≈ 903,5 m y `ST_DWithin` a 2 km verdadero.

El contrato ejecutable está en [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma). `scripts/check-contract.sh` lo migra sobre esta imagen y comprueba tablas, índices GiST y una distancia en metros.

Conclusión para las misiones: la integración con PostGIS se puede ejecutar en esta VM si el daemon se arranca así, y en GitHub Actions con un contenedor de servicio, sin instalar el daemon a mano. M02 fija esa imagen en `docker-compose.yml` y en el job `PostGIS` del workflow. La consulta es `scripts/postgis-version.sh`.

## Qué puede automatizarse

| Prueba | VM de agente | GitHub Actions (`ubuntu-latest`) |
| --- | --- | --- |
| Typecheck, lint y pruebas unitarias puras | Sí, con Node y pnpm ya presentes | Sí |
| PostgreSQL 17 + PostGIS 3.5 | Sí, con el daemon arrancado como arriba | Sí, servicio `postgis/postgis:17-3.5` |
| Consultas `ST_DWithin` / `ST_Distance` en metros | Sí | Sí |
| API NestJS contra esa base | Sí, cuando exista `apps/api` | Sí |
| Redis | Se podría levantar un contenedor. V1 no lo necesita | Igual |
| FCM real | No. No hay credenciales y no se deben inventar | No. El puerto falso cubre el contrato |
| Emulador Android o GPS de dispositivo | No forma parte del camino. Hay KVM, pero no hay SDK ni emulador, y un emulador en CI sería lento e inestable | No |
| App Expo: typecheck y Jest de lógica | Sí, sin emulador | Sí |
| Playwright del web | Sí, con navegador instalado en la misión que lo introduzca | Sí |
| Pasarela de pagos, Play Store, dominio, producción | Fuera de alcance. No se hacen | Fuera de alcance |

## Límites que el diseño respeta

- Un agente no debe depender de que Docker ya esté corriendo. El primer paso de una prueba de base es comprobar el socket y, en esta VM, arrancar `dockerd` si falta.
- La integración con PostGIS es obligatoria en CI. Si la VM no puede levantar el daemon, no se sustituye por un mock de PostGIS ni por SQLite: la misión queda roja y se documenta el fallo en la bitácora.
- FCM se prueba con un adaptador en memoria que registra plantilla y destinatario. El adaptador de Firebase Admin solo se construye si existen credenciales, y esas credenciales no se commitean.
- No hay geocodificador externo. Las coordenadas las envía el cliente de la API.
- No se compran dominios, no se publican apps y no se toca un entorno de producción. Esta fase no despliega nada.

## Implicación para el plan

M01 puede completarse solo con Node. M02 y M04 necesitan Docker. Las misiones de la app móvil no esperan un emulador verde en CI; cubren la lógica con Jest y dejan el recorrido en dispositivo físico como prueba manual descrita, no como compuerta de merge.
