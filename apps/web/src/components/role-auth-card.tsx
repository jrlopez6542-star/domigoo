"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { callProxy } from "@/lib/api-client";
import { buildLoginPayload } from "@/lib/contracts";

export type SessionUser = {
  id: string;
  email: string | null;
  phoneE164: string | null;
  status: string;
};

export type AccountRole = "CUSTOMER" | "RESTAURANT" | "COURIER";

export function RoleAuthCard({
  accountRole,
  roleTitle,
  roleSubtitle,
  identifierPlaceholder,
  sessionUser,
  onAuthenticated,
  onLoggedOut,
}: {
  accountRole: AccountRole;
  roleTitle: string;
  roleSubtitle: string;
  identifierPlaceholder?: string;
  sessionUser: SessionUser | null;
  onAuthenticated: (user: SessionUser) => void;
  onLoggedOut: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [sensitiveDataAccepted, setSensitiveDataAccepted] = useState(false);
  const [marketingAccepted, setMarketingAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const modo = new URLSearchParams(window.location.search).get("modo");
      if (modo === "registro") {
        setMode("register");
      } else if (modo === "login") {
        setMode("login");
      }
    }
    let active = true;
    callProxy<SessionUser>("auth/me", "GET")
      .then((user) => {
        if (active && user.id) {
          onAuthenticated(user);
        }
      })
      .catch(() => {
        // Sin sesión previa; es esperado.
      })
      .finally(() => {
        if (active) {
          setCheckingSession(false);
        }
      });
    return () => {
      active = false;
    };
  }, [onAuthenticated]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    if (mode === "register") {
      if (!termsAccepted || !privacyAccepted) {
        setErrorMessage(
          "Debes aceptar los Términos y Condiciones y la Autorización de Tratamiento de Datos Personales.",
        );
        return;
      }
      if (accountRole === "COURIER" && !sensitiveDataAccepted) {
        setErrorMessage(
          "Para registrarte como domiciliario debes autorizar el tratamiento de datos sensibles.",
        );
        return;
      }
    }
    setLoading(true);
    try {
      const credentials = buildLoginPayload(identifier, password, "WEB");
      const endpoint = mode === "login" ? "auth/login" : "auth/register";
      const payload =
        mode === "register"
          ? {
              ...credentials,
              role: accountRole,
              consents: {
                termsAccepted,
                privacyAccepted,
                ...(accountRole === "COURIER" ? { sensitiveDataAccepted } : {}),
                marketingAccepted,
              },
            }
          : credentials;
      const data = await callProxy<SessionUser>(endpoint, "POST", payload);
      onAuthenticated(data);
      setPassword("");
      setStatusMessage(
        mode === "login"
          ? "Sesión iniciada correctamente."
          : "Cuenta creada y sesión iniciada correctamente.",
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "No fue posible autenticar. Verifica tus datos e intenta de nuevo.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setErrorMessage("");
    setStatusMessage("");
    setLoading(true);
    try {
      await callProxy<unknown>("auth/logout", "POST");
    } catch {
      // Aunque falle la revocación remota, limpiamos estado local.
    } finally {
      onLoggedOut();
      setMode("login");
      setLoading(false);
      setStatusMessage("Sesión cerrada.");
    }
  }

  return (
    <section className="dg-card" aria-labelledby="auth-card-title">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "12px",
        }}
      >
        <div>
          <h2 id="auth-card-title" style={{ marginBottom: "4px" }}>
            {roleTitle}
          </h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            {roleSubtitle}
          </p>
        </div>
        {sessionUser ? (
          <span className="dg-pill" data-testid="session-badge">
            Sesión activa: {sessionUser.email ?? sessionUser.phoneE164 ?? sessionUser.id}
          </span>
        ) : null}
      </div>

      {statusMessage ? (
        <div role="status" aria-live="polite" className="dg-alert dg-alert--success">
          {statusMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div role="alert" aria-live="polite" className="dg-alert dg-alert--error">
          {errorMessage}
        </div>
      ) : null}

      {checkingSession ? (
        <p className="dg-muted">Verificando sesión activa...</p>
      ) : sessionUser ? (
        <div className="dg-btn-row">
          <button
            type="button"
            className="dg-btn dg-btn--secondary"
            onClick={() => void handleLogout()}
            disabled={loading}
          >
            {loading ? "Cerrando sesión..." : "Cerrar sesión"}
          </button>
        </div>
      ) : (
        <>
          <div className="dg-tabs" role="tablist" aria-label="Modo de acceso">
            <button
              type="button"
              role="tab"
              data-testid="tab-login"
              aria-selected={mode === "login"}
              className="dg-tab"
              onClick={() => {
                setMode("login");
                setErrorMessage("");
              }}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              role="tab"
              data-testid="tab-register"
              aria-selected={mode === "register"}
              className="dg-tab"
              onClick={() => {
                setMode("register");
                setErrorMessage("");
              }}
            >
              Crear cuenta
            </button>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="dg-stack">
            <div className="dg-grid-2">
              <label className="dg-field" htmlFor="auth-identifier">
                <span>Correo electrónico o celular (+57...)</span>
                <input
                  id="auth-identifier"
                  className="dg-input"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                  }}
                  placeholder={identifierPlaceholder ?? "correo@ejemplo.com o +573001234567"}
                  required
                />
              </label>

              <label className="dg-field" htmlFor="auth-password">
                <span>Contraseña (mínimo 12 caracteres)</span>
                <input
                  id="auth-password"
                  className="dg-input"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={12}
                  maxLength={72}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                  placeholder="••••••••••••"
                  required
                />
              </label>
            </div>

            {mode === "register" ? (
              <div className="dg-check-group" data-testid="register-consents">
                <label className="dg-check-row">
                  <input
                    type="checkbox"
                    name="termsAccepted"
                    checked={termsAccepted}
                    onChange={(e) => {
                      setTermsAccepted(e.target.checked);
                    }}
                  />
                  <span>
                    Acepto los{" "}
                    <Link href="/legal/terminos" className="dg-footer-link">
                      Términos y Condiciones
                    </Link>{" "}
                    de DOMIGOO. (Obligatorio)
                  </span>
                </label>

                <label className="dg-check-row">
                  <input
                    type="checkbox"
                    name="privacyAccepted"
                    checked={privacyAccepted}
                    onChange={(e) => {
                      setPrivacyAccepted(e.target.checked);
                    }}
                  />
                  <span>
                    Autorizo el{" "}
                    <Link href="/legal/autorizacion" className="dg-footer-link">
                      Tratamiento de Datos Personales
                    </Link>{" "}
                    conforme a la{" "}
                    <Link href="/legal/privacidad" className="dg-footer-link">
                      Política de Privacidad
                    </Link>
                    . (Obligatorio)
                  </span>
                </label>

                {accountRole === "COURIER" ? (
                  <label className="dg-check-row">
                    <input
                      type="checkbox"
                      name="sensitiveDataAccepted"
                      checked={sensitiveDataAccepted}
                      onChange={(e) => {
                        setSensitiveDataAccepted(e.target.checked);
                      }}
                    />
                    <span>
                      Autorizo el tratamiento de datos sensibles para verificación de domiciliarios
                      según los{" "}
                      <Link href="/legal/domiciliarios" className="dg-footer-link">
                        Términos de Domiciliarios
                      </Link>
                      . (Obligatorio)
                    </span>
                  </label>
                ) : null}

                <label className="dg-check-row">
                  <input
                    type="checkbox"
                    name="marketingAccepted"
                    checked={marketingAccepted}
                    onChange={(e) => {
                      setMarketingAccepted(e.target.checked);
                    }}
                  />
                  <span>
                    Deseo recibir novedades y comunicaciones comerciales de DOMIGOO. (Opcional)
                  </span>
                </label>
              </div>
            ) : null}

            <div className="dg-btn-row">
              <button type="submit" className="dg-btn" disabled={loading}>
                {loading
                  ? mode === "login"
                    ? "Ingresando..."
                    : "Creando cuenta..."
                  : mode === "login"
                    ? "Ingresar"
                    : "Registrarme"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
