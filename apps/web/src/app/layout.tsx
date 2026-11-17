import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getWebServerConfig } from "@/lib/env";
import "@/styles/domigoo.css";

export function generateMetadata(): Metadata {
  const { appName } = getWebServerConfig();
  return {
    title: `${appName} — Domicilios en Tocancipá`,
    description:
      "Plataforma única de domicilios en Tocancipá para clientes, restaurantes y domiciliarios.",
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CO">
      <body>{children}</body>
    </html>
  );
}
