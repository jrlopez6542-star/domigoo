import Link from "next/link";
import type { ReactNode } from "react";

export type ActiveRoleRoute = "home" | "cliente" | "restaurante" | "domiciliario" | "tracking";

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

          <div className="dg-footer-links">
            {/* Espacio preparado para enlaces legales de M45 (/legal/terminos, /legal/privacidad, etc.) */}
            <span data-testid="footer-legal-slot" className="dg-muted">
              Términos y privacidad (próximamente)
            </span>
            <a
              href={adminAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="dg-footer-link"
            >
              Administración
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
