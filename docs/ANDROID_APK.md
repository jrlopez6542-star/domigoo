# DOMIGOO — APK Android (Preview)

Este documento describe cómo instalar, reconstruir y verificar el APK de previsualización de la app móvil de DOMIGOO (`@domigoo/movil`).

## Configuración de la compilación

- **Nombre de la app:** `DOMIGOO`
- **Paquete Android (`applicationId`):** `com.domigoo.movil`
- **Versión:** `1.0.0` (`versionCode: 1`)
- **Identidad visual:** `BRAND-001` (Futuro Urbano, fondo `#29243E`, icono, icono adaptativo y splash).
- **API de producción configurada:** `https://domigoo.vercel.app` (vía `EXPO_PUBLIC_API_URL` en tiempo de empaquetado y `expo.extra.apiUrl` en `apps/movil/app.json`).
- **Permisos declarados:** `INTERNET`, `ACCESS_FINE_LOCATION` y `ACCESS_COARSE_LOCATION`.

## Cómo instalar el APK en un teléfono Android

1. Descarga el archivo `domigoo-android-1.0.0-preview.apk` desde el **Release prerelease** (`v1.0.0-android-preview`) o desde los **Artifacts** del workflow `Android APK (Preview)` en GitHub Actions.
2. En tu teléfono Android, abre **Configuración → Seguridad / Aplicaciones** y habilita **Instalar aplicaciones desconocidas** para el navegador o gestor de archivos desde el que abras el `.apk`.
3. Toca el archivo `.apk` descargado y confirma **Instalar** (si Google Play Protect muestra aviso por firma de depuración, selecciona **Instalar de todas formas**).
4. Al abrir la app, verás el splash Futuro Urbano (`#29243E`) y la pantalla de bienvenida `HOME-002`.

## Cómo reconstruir el APK localmente (sin servicios pagos ni Expo EAS)

Requisitos previos: Node.js 24, `pnpm`, JDK 17 y Android SDK (`platform-tools`, `platforms;android-35`, `build-tools;35.0.0`) con `ANDROID_HOME` configurado.

```bash
# 1. Instalar dependencias del monorepo
pnpm install --frozen-lockfile

# 2. Generar el proyecto nativo Android (no se sube a git)
cd apps/movil
EXPO_PUBLIC_API_URL=https://domigoo.vercel.app npx expo prebuild --platform android --no-install

# 3. Compilar el APK release firmado con el keystore de debug local
cd android
EXPO_PUBLIC_API_URL=https://domigoo.vercel.app ./gradlew assembleRelease --no-daemon
```

El APK generado queda en:
`apps/movil/android/app/build/outputs/apk/release/app-release.apk`

## Limitaciones conocidas (Preview)

- **Firma de depuración (`debug.keystore`):** Este APK está firmado con el keystore de debug generado localmente por Expo/Gradle. **No es apto para publicar en Google Play Store** ni debe usarse como firma definitiva de producción.
- **Carpeta `apps/movil/android/`:** Se genera de forma reproducible con `expo prebuild` y está excluida en `.gitignore` junto con `*.keystore`, `*.jks` y `*.apk`.
- **Actualización de la app:** Si se cambia la firma en el futuro (por ejemplo con un keystore de release oficial), será necesario desinstalar la versión preview antes de instalar la nueva.
