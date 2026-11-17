import Link from "next/link";
import type { ReactNode } from "react";

export type ActiveRoleRoute =
  "home" | "cliente" | "restaurante" | "domiciliario" | "tracking" | "legal";

export function DomigooShell({
  appName,
  adminAppUrl,
  activeRoute,
  children,
}: {
  appName: string;
  adminAppUrl: string;
  activeRoute: ActiveRoleRoute;
  children: ReactNode;
}) {
  return (
    <div className="dg-page">
      <header className="dg-header">
        <div className="dg-header-inner">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Link href="/" className="dg-brand-link">
              <span className="dg-brand-mark" aria-hidden="true">
                D
              </span>
              <span>{appName}</span>
            </Link>
            <span className="dg-badge">Tocancipá</span>
          </div>

          <nav className="dg-nav" aria-label="Navegación principal por rol">
            <Link
              href="/"
              className="dg-nav-link"
              aria-current={activeRoute === "home" ? "page" : undefined}
            >
              Inicio
            </Link>
            <Link
              href="/cliente"
              className="dg-nav-link"
              aria-current={activeRoute === "cliente" ? "page" : undefined}
            >
              Cliente
            </Link>
            <Link
              href="/restaurante"
              className="dg-nav-link"
              aria-current={activeRoute === "restaurante" ? "page" : undefined}
            >
              Restaurante
            </Link>
            <Link
              href="/domiciliario"
              className="dg-nav-link"
              aria-current={activeRoute === "domiciliario" ? "page" : undefined}
            >
              Domiciliario
            </Link>
          </nav>
        </div>
      </header>

      <main className="dg-main">{children}</main>

      <footer className="dg-footer">
        <div className="dg-footer-inner">
          <span>
            <strong>{appName}</strong> · Domicilios en Tocancipá, Cundinamarca
          </span>

          <nav className="dg-footer-links" aria-label="Enlaces legales y administración">
            <Link href="/legal/terminos" className="dg-footer-link">
              Términos y Condiciones
            </Link>
            <Link href="/legal/privacidad" className="dg-footer-link">
              Política de Privacidad
            </Link>
            <Link href="/legal/autorizacion" className="dg-footer-link">
              Autorización de Datos
            </Link>
            <Link href="/legal/restaurantes" className="dg-footer-link">
              Términos Restaurantes
            </Link>
            <Link href="/legal/domiciliarios" className="dg-footer-link">
              Términos Domiciliarios
            </Link>
            <a
              href={adminAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="dg-footer-link"
            >
              Administración
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
