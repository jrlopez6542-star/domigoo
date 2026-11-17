"use client";

import { useState, type FormEvent } from "react";
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

export function AdminPortal({ appName }: { appName: string }) {
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
      setAdminUserId(data.id ?? data.user?.id ?? "activo");
      setStatusMessage("Sesión administrativa iniciada.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
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

  return (
    <main style={{ maxWidth: "56rem", margin: "2rem auto", padding: "0 1rem" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>{appName} — Panel Administrativo</h1>
        <p style={{ color: "#475569", marginTop: "0.25rem" }}>
          Revisión documental, reconocimiento de declaraciones de suscripción y operación.
        </p>
      </header>

      {statusMessage ? (
        <div
          role="status"
          style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#ecfdf5",
            border: "1px solid #10b981",
            borderRadius: "8px",
            marginBottom: "1rem",
          }}
        >
          {statusMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#fef2f2",
            border: "1px solid #ef4444",
            borderRadius: "8px",
            marginBottom: "1rem",
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      <section
        style={{
          backgroundColor: "#ffffff",
          padding: "1.25rem",
          borderRadius: "10px",
          border: "1px solid #e2e8f0",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ marginTop: 0 }}>1. Ingreso administrativo</h2>
        {adminUserId ? <p data-testid="admin-session">Sesión activa: {adminUserId}</p> : null}
        <form
          onSubmit={(e) => {
            void handleLogin(e);
          }}
          style={{ display: "grid", gap: "0.75rem" }}
        >
          <label>
            Correo o teléfono (+57...)
            <input
              name="identifier"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
              }}
              placeholder="admin@ejemplo.com o +573001112233"
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <button type="submit">Entrar</button>
        </form>
      </section>

      <section
        style={{
          backgroundColor: "#ffffff",
          padding: "1.25rem",
          borderRadius: "10px",
          border: "1px solid #e2e8f0",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ marginTop: 0 }}>2. Bandeja de verificación de domiciliarios</h2>
        <button
          type="button"
          onClick={() => {
            void handleLoadCases();
          }}
        >
          Cargar casos
        </button>

        {cases.length > 0 ? (
          <ul data-testid="verification-cases-list">
            {cases.map((c) => (
              <li key={c.id}>
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
          style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}
        >
          <label>
            ID del caso
            <input
              name="caseId"
              value={caseId}
              onChange={(e) => {
                setCaseId(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Resultado (outcome)
            <select
              name="outcome"
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value as VerificationOutcome);
              }}
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            >
              <option value="APPROVED">Aprobar (APPROVED)</option>
              <option value="REJECTED">Rechazar (REJECTED)</option>
              <option value="NEEDS_CHANGES">Solicitar cambios (NEEDS_CHANGES)</option>
            </select>
          </label>
          <label>
            Código de motivo (reasonCode)
            <input
              name="reasonCode"
              value={reasonCode}
              onChange={(e) => {
                setReasonCode(e.target.value);
              }}
              pattern="[A-Za-z0-9_]{1,64}"
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Comentario (comment)
            <input
              name="comment"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <button type="submit">Registrar decisión</button>
        </form>
      </section>

      <section
        style={{
          backgroundColor: "#ffffff",
          padding: "1.25rem",
          borderRadius: "10px",
          border: "1px solid #e2e8f0",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ marginTop: 0 }}>3. Reconocimiento de declaración de suscripción</h2>
        <p style={{ color: "#475569", fontSize: "0.875rem" }}>
          DOMIGOO no procesa pagos electrónicos desde este panel. Aquí únicamente se reconoce una
          declaración de transferencia o pago reportada por el restaurante.
        </p>
        <form
          onSubmit={(e) => {
            void handleAcknowledgeDeclaration(e);
          }}
          style={{ display: "grid", gap: "0.75rem" }}
        >
          <label>
            ID de declaración
            <input
              name="declarationId"
              value={declarationId}
              onChange={(e) => {
                setDeclarationId(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Referencia o nota de verificación
            <input
              name="ackReference"
              value={ackReference}
              onChange={(e) => {
                setAckReference(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <button type="submit">Reconocer declaración de pago</button>
        </form>
      </section>

      <section
        style={{
          backgroundColor: "#ffffff",
          padding: "1.25rem",
          borderRadius: "10px",
          border: "1px solid #e2e8f0",
        }}
      >
        <h2 style={{ marginTop: 0 }}>4. Estadísticas operativas</h2>
        <button
          type="button"
          onClick={() => {
            void handleLoadStats();
          }}
        >
          Consultar estadísticas
        </button>
        {stats ? (
          <div data-testid="admin-stats" style={{ marginTop: "1rem" }}>
            <p>Domiciliarios aprobados y disponibles: {stats.eligibleCouriers}</p>
            <p>Incidentes abiertos: {stats.openIncidents}</p>
            <p>
              Mediana de aceptación (segundos):{" "}
              {stats.medianAcceptSeconds !== null ? stats.medianAcceptSeconds : "Sin datos"}
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
