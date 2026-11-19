"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Clock, MapPin, Navigation, ShieldCheck, User } from "lucide-react";

export type TrackingPayload = {
  referenceCode: string;
  status: string;
  restaurantName: string;
  courierFirstName: string | null;
  etaMinutes: number | null;
  pickupLocation: { latitude: number; longitude: number } | null;
  courierLocation: { latitude: number; longitude: number; recordedAt: string } | null;
  deliveryPin?: string;
  events: Array<{ fromStatus: string | null; toStatus: string; createdAt: string }>;
};

const TERMINAL_STATUSES = new Set([
  "DELIVERED",
  "CANCELLED_RESTAURANT",
  "CANCELLED_COURIER",
  "CANCELLED_ADMIN",
  "EXPIRED",
  "FAILED",
]);

function getStepIndex(status: string): number {
  switch (status) {
    case "DRAFT":
    case "SEEKING_COURIER":
    case "OFFERED":
      return 0;
    case "ACCEPTED":
      return 1;
    case "ARRIVING_PICKUP":
    case "AT_PICKUP":
    case "PICKED_UP":
      return 2;
    case "AT_DROPOFF":
      return 3;
    case "DELIVERED":
      return 4;
    default:
      return -1;
  }
}

function buildOsmEmbedUrl(lat: number, lng: number): string {
  const delta = 0.008;
  const bbox = `${(lng - delta).toFixed(5)},${(lat - delta).toFixed(5)},${(lng + delta).toFixed(5)},${(lat + delta).toFixed(5)}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function PublicTrackingView({
  appName,
  token,
  initialTracking,
}: {
  appName: string;
  token: string;
  initialTracking: TrackingPayload;
}) {
  const [tracking, setTracking] = useState<TrackingPayload>(initialTracking);
  const [claimState, setClaimState] = useState<"idle" | "saving" | "saved" | "need-auth" | "error">(
    "idle",
  );
  const [claimMessage, setClaimMessage] = useState("");

  const isTerminal = TERMINAL_STATUSES.has(tracking.status);
  const isCancelled = tracking.status.startsWith("CANCELLED") || tracking.status === "EXPIRED";
  const stepIndex = getStepIndex(tracking.status);

  useEffect(() => {
    if (isTerminal) {
      return;
    }
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/proxy/tracking/${encodeURIComponent(token)}`, {
            cache: "no-store",
          });
          if (res.ok) {
            const next = (await res.json()) as TrackingPayload;
            setTracking(next);
          }
        } catch {
          // Silencioso en polling; reintenta en el siguiente ciclo
        }
      })();
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [token, isTerminal]);

  async function handleClaimOrder() {
    setClaimState("saving");
    setClaimMessage("");
    const res = await fetch(`/api/proxy/tracking/${encodeURIComponent(token)}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.status === 401 || res.status === 403) {
      setClaimState("need-auth");
      setClaimMessage("Inicia sesión o crea una cuenta opcional para guardar este pedido.");
      return;
    }
    if (!res.ok) {
      setClaimState("error");
      setClaimMessage("No se pudo guardar el pedido en tu cuenta.");
      return;
    }
    setClaimState("saved");
    setClaimMessage("Solicitud guardada en tu historial.");
  }

  const activeMapPoint =
    !isTerminal && tracking.courierLocation ? tracking.courierLocation : tracking.pickupLocation;

  const steps = [
    {
      title: "Solicitud registrada",
      subtitle:
        stepIndex === 0
          ? "Buscando domiciliario disponible..."
          : `Restaurante ${tracking.restaurantName}`,
    },
    {
      title: "Domiciliario asignado",
      subtitle: tracking.courierFirstName ? tracking.courierFirstName : "Pendiente por asignar",
    },
    {
      title: "En ruta",
      subtitle:
        tracking.status === "PICKED_UP"
          ? "Pedido recogido, en camino hacia ti"
          : "Se dirige al restaurante",
    },
    {
      title: "En entrega",
      subtitle: "Hacia tu dirección",
    },
    {
      title: "Finalizado",
      subtitle: "Servicio completado",
    },
  ];

  return (
    <div className="dg-v2-shell">
      <main
        style={{
          width: "100%",
          maxWidth: 480,
          margin: "0 auto",
          padding: "20px 16px 48px",
          display: "grid",
          gap: 16,
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/"
            className="dg-btn dg-btn--secondary"
            style={{ minHeight: 42, padding: "8px 12px" }}
            aria-label="Volver al inicio"
          >
            <ArrowLeft size={18} />
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#79D5D0", fontWeight: 700 }}>
              {appName} · Tocancipá
            </p>
            <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800 }}>
              Seguimiento #{tracking.referenceCode}
            </h1>
          </div>
          {tracking.etaMinutes !== null && !isTerminal ? (
            <span className="dg-v2-pill-open">
              <Clock size={14} />
              Est. {tracking.etaMinutes} min
            </span>
          ) : null}
        </header>

        {isCancelled ? (
          <div className="dg-alert dg-alert--error" role="alert" style={{ marginBottom: 0 }}>
            Esta solicitud fue cancelada o expiró ({tracking.status}).
          </div>
        ) : null}

        <section className="dg-v2-card" aria-label="Línea de tiempo del servicio">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "1rem", color: "#F5F7FA" }}>
              {tracking.restaurantName}
            </h2>
          </div>

          <div className="dg-v2-timeline">
            {steps.map((step, idx) => {
              const isDone = !isCancelled && stepIndex > idx;
              const isActive = !isCancelled && stepIndex === idx;
              return (
                <div
                  key={step.title}
                  className={`dg-v2-timeline-step ${isDone ? "dg-v2-timeline-step--done" : ""} ${
                    isActive ? "dg-v2-timeline-step--active" : ""
                  }`}
                >
                  <span className="dg-v2-timeline-dot" aria-hidden="true">
                    {isDone || (idx === 4 && tracking.status === "DELIVERED") ? (
                      <Check size={16} />
                    ) : idx === 1 ? (
                      <Navigation size={15} />
                    ) : (
                      <MapPin size={15} />
                    )}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        margin: 0,
                        fontWeight: 700,
                        fontSize: "0.95rem",
                        color: isDone || isActive ? "#F5F7FA" : "#C0C6D4",
                      }}
                    >
                      {step.title}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: "0.83rem", color: "#C0C6D4" }}>
                      {step.subtitle}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {tracking.deliveryPin ? (
          <section
            className="dg-v2-light-card"
            data-testid="tracking-delivery-pin"
            aria-label="PIN de entrega"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ShieldCheck size={22} color="#0E7C77" aria-hidden="true" />
              <div>
                <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 700, color: "#4B4563" }}>
                  PIN de entrega (entrégaselo al domiciliario)
                </p>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontFamily: "var(--domigoo-font-brand)",
                    fontSize: "1.6rem",
                    fontWeight: 800,
                    letterSpacing: "0.14em",
                    color: "#29243E",
                  }}
                >
                  {tracking.deliveryPin}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {activeMapPoint ? (
          <section className="dg-v2-card" aria-label="Mapa de seguimiento">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <h2 style={{ margin: 0, fontSize: "0.95rem", color: "#F5F7FA" }}>
                {!isTerminal && tracking.courierLocation
                  ? "Ubicación en vivo del domiciliario"
                  : "Ubicación de referencia en Tocancipá"}
              </h2>
              {isTerminal ? (
                <span style={{ fontSize: "0.75rem", color: "#C0C6D4" }}>
                  Ubicación en vivo finalizada
                </span>
              ) : null}
            </div>
            <iframe
              title="Mapa de seguimiento en Tocancipá"
              className="dg-v2-map-frame"
              src={buildOsmEmbedUrl(activeMapPoint.latitude, activeMapPoint.longitude)}
              loading="lazy"
            />
          </section>
        ) : null}

        {tracking.courierFirstName && !isCancelled ? (
          <section className="dg-v2-light-card" aria-label="Domiciliario asignado">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "999px",
                    background: "#29243E",
                    color: "#79D5D0",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <User size={20} />
                </span>
                <div>
                  <p style={{ margin: 0, fontWeight: 800, color: "#29243E" }}>
                    {tracking.courierFirstName}
                  </p>
                  <p style={{ margin: 0, fontSize: "0.82rem", color: "#4B4563" }}>Domiciliario</p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="dg-v2-card" aria-label="Guardar solicitud en cuenta opcional">
          <p style={{ margin: "0 0 10px", fontSize: "0.88rem", color: "#C0C6D4" }}>
            No necesitas cuenta para seguir tu solicitud. Si deseas conservarla en tu historial,
            puedes guardarla en tu cuenta opcional.
          </p>
          <button
            type="button"
            className="dg-btn dg-btn--secondary"
            style={{ width: "100%" }}
            disabled={claimState === "saving" || claimState === "saved"}
            onClick={() => {
              void handleClaimOrder();
            }}
            data-testid="tracking-save-account-btn"
          >
            {claimState === "saving"
              ? "Guardando..."
              : claimState === "saved"
                ? "Guardada en tu cuenta"
                : "Guardar este pedido en mi cuenta"}
          </button>
          {claimMessage ? (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: "0.85rem",
                color: claimState === "error" ? "#FCA5A5" : "#79D5D0",
              }}
            >
              {claimMessage}{" "}
              {claimState === "need-auth" ? (
                <Link
                  href={`/cliente/cuenta?claim=${encodeURIComponent(token)}`}
                  style={{ color: "#F5F7FA", textDecoration: "underline", fontWeight: 700 }}
                >
                  Ir a mi cuenta opcional
                </Link>
              ) : null}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
