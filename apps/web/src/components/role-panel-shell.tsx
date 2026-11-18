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
  badge?: number;
};

export function RolePanelShell({
  roleBadge,
  roleHeading,
  sidebarTitle,
  navItems,
  sessionUser,
  onLogout,
  loggingOut = false,
  currentPath,
  navAriaLabel,
  children,
}: {
  roleBadge?: string;
  roleHeading?: string;
  sidebarTitle?: string;
  navItems: RoleNavItem[];
  sessionUser?: SessionUser | null;
  onLogout?: () => void;
  loggingOut?: boolean;
  currentPath?: string;
  navAriaLabel?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const activePath = currentPath ?? pathname;
  const resolvedBadge = roleBadge ?? sidebarTitle ?? "Portal";
  const resolvedHeading = roleHeading ?? sidebarTitle ?? "DOMIGOO";

  return (
    <div className="dg-role-main-pad">
      {sessionUser ? (
        <div className="dg-role-topbar">
          <div className="dg-role-topbar-title">
            <span className="dg-badge">{resolvedBadge}</span>
            <strong className="dg-role-topbar-heading">{resolvedHeading}</strong>
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
            {onLogout ? (
              <button
                type="button"
                className="dg-btn dg-btn--secondary dg-role-logout-btn"
                onClick={onLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "Cerrando..." : "Cerrar sesión"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="dg-role-app">
        <aside
          className="dg-role-sidebar"
          aria-label={navAriaLabel ?? `Navegación de ${resolvedBadge}`}
        >
          <p className="dg-role-sidebar-title">Menú · {resolvedBadge}</p>
          {navItems.map((item) => {
            const isCurrent = activePath === item.href;
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
                {item.badge !== undefined && item.badge > 0 ? (
                  <span className="dg-v2-nav-badge">{item.badge}</span>
                ) : null}
              </Link>
            );
          })}
        </aside>

        <div className="dg-role-content">{children}</div>
      </div>

      <nav
        className="dg-role-bottom-nav"
        aria-label={navAriaLabel ?? `Barra inferior de ${resolvedBadge}`}
        style={{
          gridTemplateColumns: `repeat(${String(Math.min(Math.max(navItems.length, 1), 6))}, minmax(0, 1fr))`,
        }}
      >
        {navItems.map((item) => {
          const isCurrent = activePath === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="dg-role-bottom-link"
              aria-current={isCurrent ? "page" : undefined}
              data-testid={item.testId ? `${item.testId}-bottom` : undefined}
              style={{ position: "relative" }}
            >
              <span aria-hidden="true" style={{ display: "inline-flex" }}>
                {item.icon}
              </span>
              <span>{item.shortLabel}</span>
              {item.badge !== undefined && item.badge > 0 ? (
                <span
                  className="dg-v2-nav-badge"
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 6,
                    minWidth: 18,
                    height: 18,
                    fontSize: "0.68rem",
                  }}
                >
                  {item.badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
