# DOMIGOO — Guía de Identidad Visual ("Futuro Urbano")

- **Marca:** DOMIGOO
- **Eslogan:** TU CIUDAD A TU PUERTA
- **Dirección creativa oficial:** Futuro Urbano
- **Cobertura:** Tocancipá, Cundinamarca

---

## 1. Paleta oficial

| Token | Hex | Uso |
|---|---|---|
| `--domigoo-indigo` | `#29243E` | Color institucional base: encabezados, botones principales, barra lateral, footer, splash e icono de app. |
| `--domigoo-turquoise` | `#79D5D0` | Color distintivo: acentos, curvas, iconos sobre índigo, focos (`focus-visible`) y estados activos. |
| `--domigoo-turquoise-text` | `#0E7C77` | Variante accesible WCAG AA para texto/enlaces turquesa sobre fondos claros (`#F5F7FA` / `#FFFFFF`). |
| `--domigoo-silver` | `#C0C6D4` | Bordes, detalles metálicos y texto secundario sobre fondos oscuros. |
| `--domigoo-white` | `#F5F7FA` | Fondo neutro claro para áreas de lectura, formularios y tarjetas. |

> **Regla de accesibilidad (WCAG AA):** Nunca usar `#79D5D0` como color de texto sobre `#F5F7FA` o `#FFFFFF`. Úsalo sobre `#29243E`, o como fondo de acento con texto `#29243E`.

---

## 2. Tipografías (OFL gratuitas)

- **Marca y encabezados:** `Montserrat` (600, 700, 800 normal e itálica). En Next.js se carga vía `next/font/google`.
- **Interfaz, textos y formularios:** `Inter` (400, 500, 600, 700).

---

## 3. Ubicación de recursos y sistema de diseño

- **Paquete centralizado:** [`packages/brand`](../../packages/brand/src/index.ts) (`@domigoo/brand`), exporta tokens TypeScript (`tokens.ts`) y variables CSS (`tokens.css`).
- **Original archivado (ZIP):** `docs/brand/original/` (conservado sin modificar).
- **Referencias oficiales:**
  - `docs/brand/referencias/lamina-marca-futuro-urbano.png` (fuente de verdad del logotipo y estilo).
  - `docs/brand/referencias/195919.png` (composición obligatoria de la pantalla de inicio HOME-002).
- **Logotipos vectoriales v2 (fuente: lámina oficial):** `docs/brand/logo-v2/`
  - `domigoo-horizontal-dark.svg` / `domigoo-horizontal-light.svg`
  - `domigoo-vertical-dark.svg` / `domigoo-vertical-light.svg`
  - `domigoo-app-icon.svg` (zona segura central del 66% para Android adaptive icon)
  - `domigoo-isotipo.svg` y `domigoo-isotipo-sm.svg` (versión simplificada D + pin para 16–32 px)
  - `domigoo-mono-white.svg` / `domigoo-mono-black.svg`
  - `comparacion-lamina-vs-svg.png`
- **Web (`apps/web`):** `apps/web/public/brand/` + `apps/web/src/app/icon.svg`.
- **Admin (`apps/admin`):** `apps/admin/public/brand/` + `apps/admin/src/app/icon.svg`.
- **Móvil (`apps/movil`):** `apps/movil/assets/{icon.png,adaptive-icon.png,splash-icon.png,favicon.png}` configurados en `apps/movil/app.json` con fondo `#29243E`.

---

## 4. Reglas de uso del logotipo

- **Tamaño mínimo:**
  - Logotipo horizontal completo: mínimo `120 px` de ancho en web.
  - Isotipo completo (`domigoo-isotipo.svg`): mínimo `36 px`.
  - Para `16–32 px` (favicons y badges pequeños): usar `domigoo-isotipo-sm.svg` (D + pin simplificado).
- **Zona de respeto:** Dejar al menos un margen equivalente al ancho del trazo vertical de la `D` alrededor del logotipo. En `adaptive-icon.png`, el símbolo permanece dentro del `66%` central.
- **Fondos permitidos:** `#29243E` (preferido para versión dark), `#F5F7FA` o `#FFFFFF` (versión light), o monocromático blanco/negro sobre fondos de alto contraste.
- **Usos prohibidos:**
  - No introducir naranja, amarillo o rojo como colores principales de marca.
  - No usar la lámina raster completa como logotipo ni incrustar fotos de comida o insignias de tiendas de aplicaciones.
  - No distorsionar proporciones ni cambiar la tipografía del wordmark.
- **Pendiente para diseñador profesional:** Refinamiento óptico de brillos 3D/metálicos y kerning final del wordmark vectorial para materiales impresos de gran formato.

---

## 5. Cómo agregar una nueva aplicación al sistema de marca

1. Agregar `"@domigoo/brand": "workspace:*"` en el `package.json` de la nueva app.
2. En aplicaciones web (Next.js): cargar `Montserrat` e `Inter` con `next/font/google`, importar `@domigoo/brand/tokens.css` en `layout.tsx`, copiar `docs/brand/logo-v2/*.svg` a `public/brand/` y `domigoo-isotipo-sm.svg` a `src/app/icon.svg`.
3. En aplicaciones React Native / Expo: importar `BRAND_COLORS`, `BRAND_RADII` y `BRAND_SPACING` desde `@domigoo/brand` y reutilizar `apps/movil/assets/` en `app.json`.
