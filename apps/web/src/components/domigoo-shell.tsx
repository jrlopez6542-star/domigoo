"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";

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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="dg-page">
      <header className="dg-header">
        <div className="dg-header-inner">
          <div className="dg-header-brand-row">
            <Link href="/" className="dg-brand-link" aria-label={`${appName} — Inicio`}>
              <img
                src="/brand/domigoo-horizontal-dark.svg"
                alt={appName}
                className="dg-brand-logo"
                width={128}
                height={38}
              />
            </Link>
            <span className="dg-badge">Tocancipá</span>
          </div>

          <button
            type="button"
            className="dg-menu-toggle"
            aria-label={menuOpen ? "Cerrar menú de navegación" : "Abrir menú de navegación"}
            aria-expanded={menuOpen}
            aria-controls="dg-primary-nav"
            onClick={() => {
              setMenuOpen((prev) => !prev);
            }}
          >
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>

          <nav
            id="dg-primary-nav"
            className={menuOpen ? "dg-nav dg-nav--open" : "dg-nav"}
            aria-label="Navegación principal por rol"
          >
            <Link
              href="/"
              className="dg-nav-link"
              aria-current={activeRoute === "home" ? "page" : undefined}
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              Inicio
            </Link>
            <Link
              href="/cliente"
              className="dg-nav-link"
              aria-current={activeRoute === "cliente" ? "page" : undefined}
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              Cliente
            </Link>
            <Link
              href="/restaurante"
              className="dg-nav-link"
              aria-current={activeRoute === "restaurante" ? "page" : undefined}
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              Restaurante
            </Link>
            <Link
              href="/domiciliario"
              className="dg-nav-link"
              aria-current={activeRoute === "domiciliario" ? "page" : undefined}
              onClick={() => {
                setMenuOpen(false);
              }}
            >
              Domiciliario
            </Link>
          </nav>
        </div>
      </header>

      <main className={activeRoute === "home" ? "dg-main dg-main--home" : "dg-main"}>
        {children}
      </main>

      <footer className="dg-footer">
        <div className="dg-footer-inner">
          <span>
            <strong>{appName}</strong> · Tu ciudad a tu puerta · Tocancipá, Cundinamarca
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
