# DOMIGOO — APK Android (Flutter Preview)

Este documento describe cómo instalar, reconstruir y verificar el APK de previsualización de la app móvil de domiciliarios de DOMIGOO (`apps/movil_flutter/`, paquete `domigoo_movil`).

## Configuración de la compilación

- **Tecnología:** Flutter (`3.29.2`, Dart `3.7.2`), solo plataforma Android.
- **Nombre visible de la app:** `DOMIGOO`
- **Paquete Android (`applicationId`):** `com.domigoo.movil`
- **Versión:** `1.0.0` (`versionCode: 1`)
- **Identidad visual:** `BRAND-001` (Futuro Urbano: `#29243E`, `#79D5D0`, `#C0C6D4`, `#F5F7FA`, fuentes locales `Montserrat` e `Inter`, icono, icono adaptativo y splash).
- **API de producción configurada:** `https://domigoo.vercel.app` (configurable con `--dart-define=API_URL=...`).
- **Permisos declarados:** `INTERNET`, `ACCESS_FINE_LOCATION` y `ACCESS_COARSE_LOCATION`.

## Cómo instalar el APK en un teléfono Android

1. Descarga el artifact `domigoo-apk` (`app-release.apk`) desde la ejecución del workflow `Android APK (Preview)` en GitHub Actions.
2. En tu teléfono Android, abre **Configuración → Seguridad / Aplicaciones** y habilita **Instalar aplicaciones desconocidas** para el navegador o gestor de archivos desde el que abras el `.apk`.
3. Toca el archivo `.apk` descargado y confirma **Instalar** (si Google Play Protect muestra aviso por firma de depuración, selecciona **Instalar de todas formas**).
4. Al abrir la app, verás el splash Futuro Urbano (`#29243E`) y la pantalla de bienvenida `DOMIGOO`.

## Cómo verificar la integridad del APK (SHA-256)

Antes de instalar, compara el hash SHA-256 del archivo descargado con el publicado en el log del workflow `Android APK (Preview)`:

```bash
sha256sum app-release.apk
```

## Cómo reconstruir el APK localmente (sin servicios pagos)

Requisitos previos: Flutter `3.29.2`, JDK 17 y Android SDK (`platform-tools`, `platforms;android-35`, `build-tools;35.0.0`).

```bash
cd apps/movil_flutter

# 1. Instalar dependencias
flutter pub get

# 2. Analizar y ejecutar pruebas unitarias/widget
flutter analyze
flutter test

# 3. Compilar el APK release firmado con keystore de debug local
flutter build apk --release --dart-define=API_URL=https://domigoo.vercel.app
```

El APK generado queda en:
`apps/movil_flutter/build/app/outputs/flutter-apk/app-release.apk`

## Limitaciones conocidas (Preview)

- **Firma de depuración (`debug.keystore`):** Este APK está firmado con el keystore de debug generado localmente por Gradle. **No es apto para publicar en Google Play Store** ni debe usarse como firma definitiva de producción.
- **Actualización de la app:** Si se cambia la firma en el futuro (por ejemplo con un keystore de release oficial), será necesario desinstalar la versión preview antes de instalar la nueva.
