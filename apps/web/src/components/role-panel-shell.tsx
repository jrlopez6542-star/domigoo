"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { SessionUser } from "./role-auth-card";

export type RoleNavItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
  testId?: string;
};

export function RolePanelShell({
  roleBadge,
  roleHeading,
  navItems,
  sessionUser,
  onLogout,
  loggingOut = false,
  children,
}: {
  roleBadge: string;
  roleHeading: string;
  navItems: RoleNavItem[];
  sessionUser: SessionUser;
  onLogout: () => void;
  loggingOut?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="dg-role-main-pad">
      <div className="dg-role-topbar">
        <div className="dg-role-topbar-title">
          <span className="dg-badge">{roleBadge}</span>
          <strong className="dg-role-topbar-heading">{roleHeading}</strong>
        </div>
        <div className="dg-role-topbar-actions">
          <span
            className="dg-pill dg-role-session-pill"
            data-testid="session-badge"
            title={sessionUser.email ?? sessionUser.phoneE164 ?? sessionUser.id}
            style={{
              background: "rgba(121, 213, 208, 0.16)",
              color: "#79d5d0",
              border: "1px solid rgba(121, 213, 208, 0.4)",
            }}
          >
            Sesión: {sessionUser.email ?? sessionUser.phoneE164 ?? sessionUser.id}
          </span>
          <button
            type="button"
            className="dg-btn dg-btn--secondary dg-role-logout-btn"
            onClick={onLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Cerrando..." : "Cerrar sesión"}
          </button>
        </div>
      </div>

      <div className="dg-role-app">
        <aside className="dg-role-sidebar" aria-label={`Navegación de ${roleBadge}`}>
          <p className="dg-role-sidebar-title">Menú · {roleBadge}</p>
          {navItems.map((item) => {
            const isCurrent = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="dg-role-sidebar-link"
                aria-current={isCurrent ? "page" : undefined}
                data-testid={item.testId ? `${item.testId}-sidebar` : undefined}
              >
                <span aria-hidden="true" style={{ display: "inline-flex" }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </aside>

        <div className="dg-role-content">{children}</div>
      </div>

      <nav className="dg-role-bottom-nav" aria-label={`Barra inferior de ${roleBadge}`}>
        {navItems.map((item) => {
          const isCurrent = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="dg-role-bottom-link"
              aria-current={isCurrent ? "page" : undefined}
              data-testid={item.testId ? `${item.testId}-bottom` : undefined}
            >
              <span aria-hidden="true" style={{ display: "inline-flex" }}>
                {item.icon}
              </span>
              <span>{item.shortLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
