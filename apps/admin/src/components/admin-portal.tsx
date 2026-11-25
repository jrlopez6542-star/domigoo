"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BarChart3, CreditCard, FileCheck2, LogIn, ShieldCheck } from "lucide-react";
import {
  buildAdminLoginPayload,
  buildVerificationDecisionPayload,
  formatAdminSessionLabel,
  formatBogotaDateTime,
  type AdminSessionIdentity,
  type VerificationOutcome,
  verificationCaseStatusLabel,
  verificationOutcomeActionLabel,
  verificationOutcomeLabel,
} from "@/lib/contracts";
import { orderStatusLabel } from "@/lib/order-status";

type VerificationCase = {
  id: string;
  courierId: string;
  status: string;
  courierName?: string;
  submittedAt?: string | null;
  reason?: string | null;
};

type AdminStats = {
  ordersByStatus: Record<string, number>;
  eligibleCouriers: number;
  medianAcceptSeconds: number | null;
  openIncidents: number;
};

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

export function AdminPortal({
  appName,
  hasSessionCookie = false,
}: {
  appName: string;
  hasSessionCookie?: boolean;
}) {
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [checkingSession, setCheckingSession] = useState(hasSessionCookie);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // 1. Login admin (correo o teléfono E.164)
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [adminSessionLabel, setAdminSessionLabel] = useState<string | null>(null);

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

  useEffect(() => {
    if (!hasSessionCookie) {
      setCheckingSession(false);
      return;
    }
    let active = true;
    async function rehydrate() {
      try {
        const me = await callProxy<{ id?: string } | null>("auth/me", "GET");
        const statsData = await callProxy<AdminStats>("admin/stats", "GET");
        if (!active) return;
        setAdminUserId(me?.id ?? "activo");
        setAdminSessionLabel(formatAdminSessionLabel(me));
        setStats(statsData);
      } catch {
        if (!active) return;
        setAdminUserId(null);
        setAdminSessionLabel(null);
      } finally {
        if (active) {
          setCheckingSession(false);
        }
      }
    }
    void rehydrate();
    return () => {
      active = false;
    };
  }, [hasSessionCookie]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setLoadingAction("login");
    try {
      const payload = buildAdminLoginPayload(identifier, password);
      const data = await callProxy<AdminSessionIdentity & { user?: AdminSessionIdentity }>(
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
        setAdminSessionLabel(null);
        setErrorMessage("Esta cuenta no tiene permisos administrativos.");
        return;
      }
      setAdminUserId(data.id ?? data.user?.id ?? "activo");
      setAdminSessionLabel(formatAdminSessionLabel(data.user ?? data, identifier));
      setStatusMessage("Sesión administrativa iniciada.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleLogout() {
    setErrorMessage("");
    setStatusMessage("");
    setLoadingAction("logout");
    try {
      await callProxy<unknown>("auth/logout", "POST");
    } catch {
      // Limpiamos el estado local aunque falle el cierre remoto.
    } finally {
      setAdminUserId(null);
      setAdminSessionLabel(null);
      setCases([]);
      setStats(null);
      setStatusMessage("Sesión administrativa cerrada.");
      setLoadingAction(null);
    }
  }

  async function handleLoadCases(silentStatus = false) {
    setErrorMessage("");
    if (!silentStatus) {
      setStatusMessage("");
    }
    setLoadingAction("cases");
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
      if (!silentStatus) {
        setStatusMessage(`Casos cargados: ${String(list.length)}`);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudieron cargar los casos.");
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleDecideCase(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setLoadingAction("decide");
    try {
      const payload = buildVerificationDecisionPayload({
        outcome,
        reasonCode,
        comment,
      });
      await callProxy<{ decided: boolean }>(
        `admin/verification-cases/${encodeURIComponent(caseId.trim())}/decision`,
        "POST",
        payload,
      );
      await handleLoadCases(true);
      setStatusMessage(`Decisión registrada: ${verificationOutcomeLabel(payload.outcome)}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo registrar la decisión.");
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleAcknowledgeDeclaration(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setLoadingAction("ack");
    try {
      const res = await callProxy<{ acknowledged?: boolean; status?: string } | null>(
        `admin/declarations/${encodeURIComponent(declarationId.trim())}/acknowledge`,
        "POST",
        {
          note: ackReference,
        },
      );
      setStatusMessage(
        res?.acknowledged ? "Declaración reconocida." : `Declaración: ${res?.status ?? "OK"}`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo reconocer la declaración.");
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleLoadStats() {
    setErrorMessage("");
    setLoadingAction("stats");
    try {
      const data = await callProxy<AdminStats>("admin/stats", "GET");
      setStats(data);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudieron consultar las estadísticas.",
      );
    } finally {
      setLoadingAction(null);
    }
  }

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
            Verificación documental, suscripciones y operación
          </span>
        </div>
      </header>

      <div className="adm-layout">
        <nav className="adm-sidebar" aria-label="Secciones administrativas">
          <a href="#admin-ingreso" className="adm-nav-item">
            <LogIn size={18} aria-hidden="true" />
            1. Ingreso
          </a>
          {adminUserId ? (
            <>
              <a href="#admin-verificacion" className="adm-nav-item">
                <FileCheck2 size={18} aria-hidden="true" />
                2. Verificación
              </a>
              <a href="#admin-suscripciones" className="adm-nav-item">
                <CreditCard size={18} aria-hidden="true" />
                3. Suscripciones
              </a>
              <a href="#admin-estadisticas" className="adm-nav-item">
                <BarChart3 size={18} aria-hidden="true" />
                4. Estadísticas
              </a>
            </>
          ) : null}
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
              1. Ingreso administrativo
            </h1>
            {checkingSession ? (
              <p style={{ color: "var(--dg-text-muted)", fontSize: "0.9rem", marginTop: 0 }}>
                Verificando sesión administrativa...
              </p>
            ) : null}
            {adminUserId ? (
              <div
                data-testid="admin-session"
                className="adm-alert adm-alert--success"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <span>{adminSessionLabel ?? "Sesión activa"}</span>
                <button
                  type="button"
                  className="adm-btn"
                  disabled={loadingAction !== null}
                  onClick={() => {
                    void handleLogout();
                  }}
                >
                  {loadingAction === "logout" ? "Cerrando..." : "Cerrar sesión"}
                </button>
              </div>
            ) : null}
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
                <button
                  type="submit"
                  className="adm-btn"
                  disabled={checkingSession || loadingAction !== null}
                >
                  {loadingAction === "login" ? "Entrando..." : "Entrar"}
                </button>
              </div>
            </form>
          </section>

          {adminUserId ? (
            <>
              <section id="admin-verificacion" className="adm-card">
                <h2 className="adm-card-title">
                  <FileCheck2 size={20} aria-hidden="true" />
                  2. Bandeja de verificación de domiciliarios
                </h2>
                <button
                  type="button"
                  className="adm-btn"
                  disabled={loadingAction !== null}
                  onClick={() => {
                    void handleLoadCases();
                  }}
                >
                  {loadingAction === "cases" ? "Cargando..." : "Cargar casos"}
                </button>

                {cases.length > 0 ? (
                  <ul data-testid="verification-cases-list" className="adm-case-list">
                    {cases.map((c) => {
                      const isSelected = caseId === c.id;
                      return (
                        <li
                          key={c.id}
                          className="adm-case-item"
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "10px",
                          }}
                        >
                          <span>
                            Domiciliario: <strong>{c.courierName?.trim() || "Domiciliario"}</strong>{" "}
                            · Enviado: {formatBogotaDateTime(c.submittedAt)} — Estado:{" "}
                            <strong>{verificationCaseStatusLabel(c.status)}</strong>
                            {c.reason ? <span> — Motivo: {c.reason}</span> : null}
                          </span>
                          <button
                            type="button"
                            className="adm-btn"
                            onClick={() => {
                              setCaseId(c.id);
                            }}
                          >
                            {isSelected ? "Seleccionado" : "Seleccionar"}
                          </button>
                        </li>
                      );
                    })}
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
                    Caso a decidir
                    {cases.length > 0 ? (
                      <select
                        className="adm-select"
                        name="caseId"
                        value={caseId}
                        onChange={(e) => {
                          setCaseId(e.target.value);
                        }}
                        required
                      >
                        {cases.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.courierName?.trim() || "Domiciliario"} ·{" "}
                            {formatBogotaDateTime(c.submittedAt)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="adm-input"
                        name="caseId"
                        value={caseId}
                        onChange={(e) => {
                          setCaseId(e.target.value);
                        }}
                        placeholder="Carga los casos pendientes arriba"
                        required
                      />
                    )}
                  </label>
                  <label className="adm-field">
                    Resultado
                    <select
                      className="adm-select"
                      name="outcome"
                      value={outcome}
                      onChange={(e) => {
                        setOutcome(e.target.value as VerificationOutcome);
                      }}
                    >
                      <option value="APPROVED">{verificationOutcomeActionLabel("APPROVED")}</option>
                      <option value="REJECTED">{verificationOutcomeActionLabel("REJECTED")}</option>
                      <option value="NEEDS_CHANGES">
                        {verificationOutcomeActionLabel("NEEDS_CHANGES")}
                      </option>
                    </select>
                  </label>
                  <label className="adm-field">
                    Código de motivo
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
                    Comentario
                    <input
                      className="adm-input"
                      name="comment"
                      maxLength={2000}
                      value={comment}
                      onChange={(e) => {
                        setComment(e.target.value);
                      }}
                      required
                    />
                  </label>
                  <div>
                    <button type="submit" className="adm-btn" disabled={loadingAction !== null}>
                      {loadingAction === "decide" ? "Registrando..." : "Registrar decisión"}
                    </button>
                  </div>
                </form>
              </section>

              <section id="admin-suscripciones" className="adm-card">
                <h2 className="adm-card-title">
                  <CreditCard size={20} aria-hidden="true" />
                  3. Reconocimiento de declaración de suscripción
                </h2>
                <p style={{ color: "var(--dg-text-muted)", fontSize: "0.9rem", marginTop: 0 }}>
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
                      maxLength={200}
                      value={ackReference}
                      onChange={(e) => {
                        setAckReference(e.target.value);
                      }}
                      required
                    />
                  </label>
                  <div>
                    <button type="submit" className="adm-btn" disabled={loadingAction !== null}>
                      {loadingAction === "ack"
                        ? "Reconociendo..."
                        : "Reconocer declaración de pago"}
                    </button>
                  </div>
                </form>
              </section>

              <section id="admin-estadisticas" className="adm-card">
                <h2 className="adm-card-title">
                  <BarChart3 size={20} aria-hidden="true" />
                  4. Estadísticas operativas
                </h2>
                <button
                  type="button"
                  className="adm-btn"
                  disabled={loadingAction !== null}
                  onClick={() => {
                    void handleLoadStats();
                  }}
                >
                  {loadingAction === "stats" ? "Consultando..." : "Consultar estadísticas"}
                </button>
                {stats ? (
                  <div data-testid="admin-stats">
                    <div className="adm-stats-grid">
                      <div className="adm-stat-box">
                        <div className="adm-stat-value">{stats.eligibleCouriers}</div>
                        <div>Domiciliarios aprobados y disponibles</div>
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
                    <div style={{ marginTop: "14px" }} data-testid="admin-stats-by-status">
                      <h3 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>Pedidos por estado</h3>
                      <ul className="adm-case-list">
                        {Object.entries(stats.ordersByStatus).map(([statusKey, count]) => (
                          <li key={statusKey} className="adm-case-item">
                            <strong>{orderStatusLabel(statusKey)}</strong>: {count}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
