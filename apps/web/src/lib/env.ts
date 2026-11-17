export function getWebServerConfig(): {
  appName: string;
  apiBaseUrl: string;
  adminAppUrl: string;
} {
  const appName = process.env["APP_NAME"]?.trim() || "DOMIGOO";
  const apiBaseUrl = (process.env["API_BASE_URL"]?.trim() || "http://127.0.0.1:3001").replace(
    /\/+$/,
    "",
  );
  const adminAppUrl = (
    process.env["ADMIN_APP_URL"]?.trim() || "https://domigoo-admin.vercel.app"
  ).replace(/\/+$/, "");
  return { appName, apiBaseUrl, adminAppUrl };
}
