import type { Metadata } from "next";
import Link from "next/link";
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
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: 1 }}>{children}</div>
        <footer
          style={{
            borderTop: "1px solid #e2e8f0",
            backgroundColor: "#ffffff",
            padding: "20px 24px",
            marginTop: 40,
            fontSize: 13,
            color: "#475569",
          }}
        >
          <div
            style={{
              maxWidth: 960,
              margin: "0 auto",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span>DOMIGOO · Tocancipá, Cundinamarca (Borrador en revisión legal)</span>
            <nav
              aria-label="Enlaces legales"
              style={{ display: "flex", flexWrap: "wrap", gap: 16 }}
            >
              <Link
                href="/legal/terminos"
                style={{ color: "#1d4ed8", textDecoration: "underline" }}
              >
                Términos y Condiciones
              </Link>
              <Link
                href="/legal/privacidad"
                style={{ color: "#1d4ed8", textDecoration: "underline" }}
              >
                Política de Privacidad
              </Link>
              <Link
                href="/legal/domiciliarios"
                style={{ color: "#1d4ed8", textDecoration: "underline" }}
              >
                Términos Domiciliarios
              </Link>
              <Link
                href="/legal/restaurantes"
                style={{ color: "#1d4ed8", textDecoration: "underline" }}
              >
                Términos Restaurantes
              </Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
