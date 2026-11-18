# Manual de Simulacros Manuales en Celular (Staging / `domigoo-preview`)

Este instructivo describe cómo preparar, ejecutar desde el celular y reiniciar los simulacros manuales con datos **100 % ficticios** en el entorno **staging (`domigoo-preview`)**.

> **Advertencia**: Nunca ejecutes los scripts de semilla o reinicio contra producción. Los scripts abortan automáticamente si `NODE_ENV=production`, `VERCEL_ENV=production`, `DOMIGOO_ENV!=staging`, o si `DATABASE_URL` apunta a producción.

## 1. Preparar o reiniciar los datos de simulacro

Desde la raíz del repositorio, con `DATABASE_URL` apuntando a la base **staging**:

```bash
# Semilla idempotente (crea restaurante en Tocancipá, 2 clientes, 2 domiciliarios aprobados con GPS y 1 admin)
DOMIGOO_ENV=staging \
STAGING_SEED_CONFIRM=yes \
NODE_ENV=development \
SIMULACRO_PASSWORD="tu-clave-staging-segura" \
pnpm seed:simulacros
```

Para borrar **únicamente** los datos marcados como simulacro (`sim-m52-*@ejemplo.com` y restaurante NIT `900520001`) sin afectar otros datos de staging:

```bash
DOMIGOO_ENV=staging \
STAGING_SEED_CONFIRM=yes \
NODE_ENV=development \
SIMULACRO_PASSWORD="tu-clave-staging-segura" \
pnpm reset:simulacros
```

## 2. Cuentas ficticias listas

Todas usan la contraseña configurada en `SIMULACRO_PASSWORD` (o `STAGING_SEED_PASSWORD`):

| Rol | Correo ficticio | Teléfono ficticio | Notas |
| --- | --- | --- | --- |
| **Restaurante** | `sim-m52-restaurante@ejemplo.com` | `+573000005201` | Sede `[SIM-M52] Principal Tocancipa` (`Calle Ficticia 12 # 5-30, Tocancipa`) |
| **Domiciliario 1** | `sim-m52-domiciliario1@ejemplo.com` | `+573000005221` | Aprobado, moto `SIM52A`, disponible en Tocancipá |
| **Domiciliario 2** | `sim-m52-domiciliario2@ejemplo.com` | `+573000005222` | Aprobado, moto `SIM52B`, disponible en Tocancipá |
| **Cliente 1** | `sim-m52-cliente1@ejemplo.com` | `+573000005211` | Para seguimiento en `/cliente/seguir` |
| **Cliente 2** | `sim-m52-cliente2@ejemplo.com` | `+573000005212` | Para pruebas de aislamiento o segundo cliente |
| **Admin (Operaciones)** | `sim-m52-admin@ejemplo.com` | `+573000005200` | Perfil `OPERATIONS` |

## 3. Enlaces de acceso (en el celular)

Reemplaza `<WEB_URL>` por la URL de `domigoo-preview`:

- **Selector de rol**: `<WEB_URL>/acceso`
- **Portal Restaurante**: `<WEB_URL>/restaurante`
- **Portal Domiciliario**: `<WEB_URL>/domiciliario`
- **Portal Cliente**: `<WEB_URL>/cliente`
- **Seguimiento público (sin sesión)**: `<WEB_URL>/tracking/<TOKEN>`

## 4. Pasos por rol desde el celular (Camino feliz)

1. **Restaurante** (`<WEB_URL>/restaurante`):
   - Inicia sesión con `sim-m52-restaurante@ejemplo.com`.
   - Ve a **Nuevo domicilio** (`/restaurante/nuevo-domicilio`).
   - En Paso 1 toca **Cotizar domicilio** y luego **Siguiente: Confirmar borrador**.
   - En Paso 2 ingresa valor comida (ej. `32000`), medio de pago (`Efectivo`) y toca **Crear borrador**, luego **Siguiente: Publicar domicilio**.
   - En Paso 3 deja modalidad **Oferta abierta en el radio**, ingresa nombre, teléfono ficticio (`+573000005211`) y dirección en Tocancipá, y toca **Publicar domicilio**.
   - Ve a **Pedidos** (`/restaurante/pedidos`) y toca **Generar enlace público** para copiar el enlace `/tracking/<TOKEN>` y enviarlo al cliente.

2. **Cliente** (`<WEB_URL>/cliente/seguir` o `<WEB_URL>/tracking/<TOKEN>`):
   - Abre el enlace público compartido o pégalo en **Seguir pedido** (`/cliente/seguir`).
   - Verifica que el estado inicial es `Buscando domiciliario (SEEKING_COURIER)`.

3. **Domiciliario 1** (`<WEB_URL>/domiciliario`):
   - Inicia sesión con `sim-m52-domiciliario1@ejemplo.com`.
   - En **Ofertas disponibles** toca **Actualizar** y luego **Aceptar** (o **Rechazar** para probar que **Domiciliario 2** la tome).
   - En **Entrega en curso** (`/domiciliario/entrega`):
     - Toca **Voy en camino** (`ARRIVING_PICKUP`).
     - Toca **Llegué al restaurante** (`AT_PICKUP`).
     - Pide al **Restaurante** el **PIN de recogida** de 6 dígitos visible en `/restaurante/pedidos`, ingrésalo y toca **Confirmar recogida** (`PICKED_UP`).
     - Toca **Llegué al cliente** (`AT_DROPOFF`).
     - Pide al **Cliente** el **PIN de entrega** de 6 dígitos visible en `/tracking/<TOKEN>`, ingrésalo y toca **Confirmar entrega** (`DELIVERED`).

4. **Verificación final**:
   - El **Cliente** recarga `/tracking/<TOKEN>` y confirma `Entregado (DELIVERED)`.
   - Al terminar las pruebas manuales, ejecuta `pnpm reset:simulacros` y vuelve a ejecutar `pnpm seed:simulacros` si deseas dejar las cuentas limpias para la siguiente sesión.
