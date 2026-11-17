import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getAdminServerConfig } from "@/lib/env";

export function generateMetadata(): Metadata {
  const { appName } = getAdminServerConfig();
  return {
    title: `${appName} — Panel Administrativo`,
    description: "Verificación de domiciliarios, suscripciones, incidentes y estadísticas.",
    robots: {
      index: false,
      follow: false,
    },
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
