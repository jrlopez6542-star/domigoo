export function getWebServerConfig(): { appName: string; apiBaseUrl: string } {
  const appName = process.env["APP_NAME"]?.trim() || "DOMIGOO";
  const apiBaseUrl = (process.env["API_BASE_URL"]?.trim() || "http://127.0.0.1:3001").replace(
    /\/+$/,
    "",
  );
  return { appName, apiBaseUrl };
}
