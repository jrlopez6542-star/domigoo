import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getWebServerConfig } from "@/lib/env";

export function generateMetadata(): Metadata {
  const { appName } = getWebServerConfig();
  return {
    title: `${appName} — Portal de Restaurantes`,
    description: "Gestión de sucursales, pedidos y seguimiento en tiempo real.",
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          backgroundColor: "#f8fafc",
          color: "#0f172a",
        }}
      >
        {children}
      </body>
    </html>
  );
}
