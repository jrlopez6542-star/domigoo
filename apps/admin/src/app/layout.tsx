import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/700-italic.css";
import "@fontsource/montserrat/800.css";
import { getAdminServerConfig } from "@/lib/env";
import "@domigoo/brand/tokens.css";
import "@/styles/admin.css";

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
      <body>{children}</body>
    </html>
  );
}
