"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  BarChart3,
  Bike,
  ClipboardList,
  CreditCard,
  FileCheck2,
  FileText,
  LayoutDashboard,
  LogIn,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";
import {
  buildAdminLoginPayload,
  buildVerificationDecisionPayload,
  type VerificationOutcome,
} from "@/lib/contracts";

type VerificationCase = {
  id: string;
  courierId: string;
  status: string;
  reason?: string | null;
};

type AdminStats = {
  ordersByStatus: Record<string, number>;
  eligibleCouriers: number;
  medianAcceptSeconds: number | null;
  openIncidents: number;
  activeRestaurants?: number;
  registeredCouriers?: number;
  registeredClients?: number;
  ordersToday?: number;
  ordersInProgress?: number;
  ordersCompletedToday?: number;
};

type AdminSection =
  | "dashboard"
  | "restaurantes"
  | "domiciliarios"
  | "clientes"
  | "solicitudes"
  | "verificaciones"
  | "reportes";

async function callProxy<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { message: text };
    }
  }
  if (!res.ok) {
    const msg =
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof parsed.message === "string"
        ? (parsed as { message: string }).message
        : `Error ${String(res.status)}`;
    throw new Error(msg);
  }
  return parsed as T;
}

export function AdminPortal({ appName }: { appName: string }) {
  const [activeSection, setActiveSection] = useState<AdminSection>("dashboard");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // 1. Login admin (correo o teléfono E.164)
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [adminUserId, setAdminUserId] = useState<string | null>(null);

  // 2. Verificación
  const [cases, setCases] = useState<VerificationCase[]>([]);
  const [caseId, setCaseId] = useState("");
  const [outcome, setOutcome] = useState<VerificationOutcome>("APPROVED");
  const [reasonCode, setReasonCode] = useState("DOCS_VERIFIED");
  const [comment, setComment] = useState("");

  // 3. Reconocimiento de declaración de suscripción
  const [declarationId, setDeclarationId] = useState("");
  const [ackReference, setAckReference] = useState("");

  // 4. Estadísticas
  const [stats, setStats] = useState<AdminStats | null>(null);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      const payload = buildAdminLoginPayload(identifier, password);
      const data = await callProxy<{ id?: string; user?: { id: string } }>(
        "auth/login",
        "POST",
        payload,
      );
      try {
        const statsData = await callProxy<AdminStats>("admin/stats", "GET");
        setStats(statsData);
      } catch {
        await callProxy<unknown>("auth/logout", "POST").catch(() => undefined);
        setAdminUserId(null);
        setErrorMessage("Esta cuenta no tiene permisos administrativos.");
        return;
      }
      setAdminUserId(data.id ?? data.user?.id ?? "activo");
      setStatusMessage("Sesión administrativa iniciada.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    }
  }

  async function handleLogout() {
    setErrorMessage("");
    setStatusMessage("");
    try {
      await callProxy<unknown>("auth/logout", "POST");
    } catch {
      // Limpiamos el estado local aunque falle el cierre remoto.
    } finally {
      setAdminUserId(null);
      setCases([]);
      setStats(null);
      setStatusMessage("Sesión administrativa cerrada.");
    }
  }

  async function handleLoadCases() {
    setErrorMessage("");
    setStatusMessage("");
    try {
      const data = await callProxy<{ cases?: VerificationCase[] } | VerificationCase[]>(
        "admin/verification-cases",
        "GET",
      );
      const list = Array.isArray(data) ? data : (data.cases ?? []);
      setCases(list);
      const firstPending = list.find((c) => c.status === "PENDING_HUMAN");
      if (firstPending) {
        setCaseId(firstPending.id);
      }
      setStatusMessage(`Casos cargados: ${String(list.length)}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudieron cargar los casos.");
    }
  }

  async function handleDecideCase(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      const payload = buildVerificationDecisionPayload({
        outcome,
        reasonCode,
        comment,
      });
      await callProxy<{ decided: boolean }>(
        `admin/verification-cases/${caseId}/decision`,
        "POST",
        payload,
      );
      setStatusMessage(`Decisión registrada: ${payload.outcome}`);
      await handleLoadCases();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo registrar la decisión.");
    }
  }

  async function handleAcknowledgeDeclaration(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      const res = await callProxy<{ acknowledged?: boolean; status?: string }>(
        `admin/declarations/${declarationId}/acknowledge`,
        "POST",
        {
          note: ackReference,
        },
      );
      setStatusMessage(
        res.acknowledged ? "Declaración reconocida." : `Declaración: ${res.status ?? "OK"}`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo reconocer la declaración.");
    }
  }

  async function handleLoadStats() {
    setErrorMessage("");
    try {
      const data = await callProxy<AdminStats>("admin/stats", "GET");
      setStats(data);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudieron consultar las estadísticas.",
      );
    }
  }

  const navItems: Array<{ id: AdminSection; label: string; icon: ReactNode }> = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} aria-hidden="true" /> },
    { id: "restaurantes", label: "Restaurantes", icon: <Store size={18} aria-hidden="true" /> },
    { id: "domiciliarios", label: "Domiciliarios", icon: <Bike size={18} aria-hidden="true" /> },
    { id: "clientes", label: "Clientes", icon: <Users size={18} aria-hidden="true" /> },
    {
      id: "solicitudes",
      label: "Solicitudes",
      icon: <ClipboardList size={18} aria-hidden="true" />,
    },
    {
      id: "verificaciones",
      label: "Verificaciones",
      icon: <FileCheck2 size={18} aria-hidden="true" />,
    },
    { id: "reportes", label: "Reportes", icon: <FileText size={18} aria-hidden="true" /> },
  ];

  return (
    <div className="adm-shell">
      <header className="adm-topbar">
        <div className="adm-topbar-inner">
          <div className="adm-brand">
            <img
              src="/brand/domigoo-horizontal-dark.svg"
              alt={appName}
              width={136}
              height={40}
              style={{ display: "block", height: "38px", width: "auto" }}
            />
            <span className="adm-badge">
              <ShieldCheck size={14} aria-hidden="true" />
              Panel Administrativo
            </span>
          </div>
          <span style={{ color: "#C0C6D4", fontSize: "0.85rem" }}>
            Operación en Tocancipá · Sin manejo de dinero
          </span>
        </div>
      </header>

      <div className="adm-layout">
        <nav className="adm-sidebar" aria-label="Secciones administrativas">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adm-nav-item ${activeSection === item.id ? "adm-nav-item--active" : ""}`}
              onClick={() => {
                setActiveSection(item.id);
              }}
              style={{
                background: activeSection === item.id ? "rgba(121, 213, 208, 0.14)" : "transparent",
                border:
                  activeSection === item.id
                    ? "1px solid rgba(121, 213, 208, 0.45)"
                    : "1px solid transparent",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <main className="adm-content">
          {statusMessage ? (
            <div role="status" className="adm-alert adm-alert--success">
              {statusMessage}
            </div>
          ) : null}

          {errorMessage ? (
            <div role="alert" className="adm-alert adm-alert--error">
              {errorMessage}
            </div>
          ) : null}

          <section id="admin-ingreso" className="adm-card">
            <h1 className="adm-card-title" style={{ fontSize: "1.25rem" }}>
              <LogIn size={20} aria-hidden="true" />
              Ingreso administrativo
            </h1>
            {adminUserId ? (
              <div
                data-testid="admin-session"
                className="adm-alert adm-alert--success"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: 0,
                }}
              >
                <span>Sesión activa: {adminUserId}</span>
                <button
                  type="button"
                  className="adm-btn"
                  onClick={() => {
                    void handleLogout();
                  }}
                >
                  Cerrar sesión
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  void handleLogin(e);
                }}
                className="adm-form"
              >
                <label className="adm-field">
                  Correo o teléfono (+57...)
                  <input
                    className="adm-input"
                    name="identifier"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                    }}
                    placeholder="admin@ejemplo.com o +573001112233"
                    required
                  />
                </label>
                <label className="adm-field">
                  Contraseña
                  <input
                    className="adm-input"
                    name="password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                    }}
                    required
                  />
                </label>
                <div>
                  <button type="submit" className="adm-btn">
                    Entrar
                  </button>
                </div>
              </form>
            )}
          </section>

          {activeSection === "dashboard" ? (
            <section id="admin-estadisticas" className="adm-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                  marginBottom: "12px",
                }}
              >
                <h2 className="adm-card-title" style={{ margin: 0 }}>
                  <BarChart3 size={20} aria-hidden="true" />
                  Operación en Tocancipá
                </h2>
                <button
                  type="button"
                  className="adm-btn"
                  onClick={() => {
                    void handleLoadStats();
                  }}
                >
                  Actualizar estadísticas
                </button>
              </div>
              {stats ? (
                <div data-testid="admin-stats" className="adm-stats-grid">
                  <div className="adm-stat-box">
                    <div className="adm-stat-value">{stats.activeRestaurants ?? 0}</div>
                    <div>Restaurantes activos</div>
                  </div>
                  <div className="adm-stat-box">
                    <div className="adm-stat-value">{stats.registeredCouriers ?? 0}</div>
                    <div>Domiciliarios registrados</div>
                  </div>
                  <div className="adm-stat-box">
                    <div className="adm-stat-value">{stats.registeredClients ?? 0}</div>
                    <div>Clientes registrados</div>
                  </div>
                  <div className="adm-stat-box">
                    <div className="adm-stat-value">{stats.ordersToday ?? 0}</div>
                    <div>Solicitudes hoy</div>
                  </div>
                  <div className="adm-stat-box">
                    <div className="adm-stat-value">{stats.ordersInProgress ?? 0}</div>
                    <div>Solicitudes en proceso</div>
                  </div>
                  <div className="adm-stat-box">
                    <div className="adm-stat-value">{stats.ordersCompletedToday ?? 0}</div>
                    <div>Completadas hoy</div>
                  </div>
                  <div className="adm-stat-box">
                    <div className="adm-stat-value">{stats.eligibleCouriers}</div>
                    <div>Domiciliarios disponibles</div>
                  </div>
                  <div className="adm-stat-box">
                    <div className="adm-stat-value">{stats.openIncidents}</div>
                    <div>Incidentes abiertos</div>
                  </div>
                  <div className="adm-stat-box">
                    <div className="adm-stat-value">
                      {stats.medianAcceptSeconds !== null
                        ? `${String(stats.medianAcceptSeconds)} s`
                        : "—"}
                    </div>
                    <div>Mediana de aceptación</div>
                  </div>
                </div>
              ) : (
                <p style={{ color: "#C0C6D4", margin: 0 }}>
                  Inicia sesión como administrador para consultar los conteos operativos en
                  Tocancipá (sin datos personales).
                </p>
              )}
            </section>
          ) : null}

          {activeSection === "verificaciones" ? (
            <>
              <section id="admin-verificacion" className="adm-card">
                <h2 className="adm-card-title">
                  <FileCheck2 size={20} aria-hidden="true" />
                  Bandeja de verificación de domiciliarios
                </h2>
                <button
                  type="button"
                  className="adm-btn"
                  onClick={() => {
                    void handleLoadCases();
                  }}
                >
                  Cargar casos
                </button>

                {cases.length > 0 ? (
                  <ul data-testid="verification-cases-list" className="adm-case-list">
                    {cases.map((c) => (
                      <li key={c.id} className="adm-case-item">
                        <code>{c.id}</code> — Domiciliario <code>{c.courierId}</code> — Estado:{" "}
                        <strong>{c.status}</strong>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <form
                  onSubmit={(e) => {
                    void handleDecideCase(e);
                  }}
                  className="adm-form"
                  style={{ marginTop: "1rem" }}
                >
                  <label className="adm-field">
                    ID del caso
                    <input
                      className="adm-input"
                      name="caseId"
                      value={caseId}
                      onChange={(e) => {
                        setCaseId(e.target.value);
                      }}
                      required
                    />
                  </label>
                  <label className="adm-field">
                    Resultado (outcome)
                    <select
                      className="adm-select"
                      name="outcome"
                      value={outcome}
                      onChange={(e) => {
                        setOutcome(e.target.value as VerificationOutcome);
                      }}
                    >
                      <option value="APPROVED">Aprobar (APPROVED)</option>
                      <option value="REJECTED">Rechazar (REJECTED)</option>
                      <option value="NEEDS_CHANGES">Solicitar cambios (NEEDS_CHANGES)</option>
                    </select>
                  </label>
                  <label className="adm-field">
                    Código de motivo (reasonCode)
                    <input
                      className="adm-input"
                      name="reasonCode"
                      value={reasonCode}
                      onChange={(e) => {
                        setReasonCode(e.target.value);
                      }}
                      pattern="[A-Za-z0-9_]{1,64}"
                      required
                    />
                  </label>
                  <label className="adm-field">
                    Comentario (comment)
                    <input
                      className="adm-input"
                      name="comment"
                      value={comment}
                      onChange={(e) => {
                        setComment(e.target.value);
                      }}
                      required
                    />
                  </label>
                  <div>
                    <button type="submit" className="adm-btn">
                      Registrar decisión
                    </button>
                  </div>
                </form>
              </section>

              <section id="admin-suscripciones" className="adm-card">
                <h2 className="adm-card-title">
                  <CreditCard size={20} aria-hidden="true" />
                  Reconocimiento de declaración de suscripción
                </h2>
                <p style={{ color: "#C0C6D4", fontSize: "0.9rem", marginTop: 0 }}>
                  DOMIGOO no procesa pagos electrónicos desde este panel. Aquí únicamente se
                  reconoce una declaración de transferencia o pago reportada por el restaurante.
                </p>
                <form
                  onSubmit={(e) => {
                    void handleAcknowledgeDeclaration(e);
                  }}
                  className="adm-form"
                >
                  <label className="adm-field">
                    ID de declaración
                    <input
                      className="adm-input"
                      name="declarationId"
                      value={declarationId}
                      onChange={(e) => {
                        setDeclarationId(e.target.value);
                      }}
                      required
                    />
                  </label>
                  <label className="adm-field">
                    Referencia o nota de verificación
                    <input
                      className="adm-input"
                      name="ackReference"
                      value={ackReference}
                      onChange={(e) => {
                        setAckReference(e.target.value);
                      }}
                      required
                    />
                  </label>
                  <div>
                    <button type="submit" className="adm-btn">
                      Reconocer declaración de pago
                    </button>
                  </div>
                </form>
              </section>
            </>
          ) : null}

          {activeSection === "restaurantes" ||
          activeSection === "domiciliarios" ||
          activeSection === "clientes" ||
          activeSection === "solicitudes" ||
          activeSection === "reportes" ? (
            <section className="adm-card" data-testid={`admin-section-${activeSection}`}>
              <h2 className="adm-card-title" style={{ textTransform: "capitalize" }}>
                {activeSection}
              </h2>
              <div className="adm-alert" style={{ marginBottom: 0 }}>
                <strong>Próximamente:</strong> Esta sección administrativa se habilitará cuando
                estén disponibles los endpoints dedicados de gestión.
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
