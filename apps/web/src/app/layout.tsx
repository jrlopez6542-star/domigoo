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
import { getWebServerConfig } from "@/lib/env";
import "@domigoo/brand/tokens.css";
import "@/styles/domigoo.css";

export function generateMetadata(): Metadata {
  const { appName } = getWebServerConfig();
  return {
    title: `${appName} — Tu ciudad a tu puerta`,
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
