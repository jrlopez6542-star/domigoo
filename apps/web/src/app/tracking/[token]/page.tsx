import type { Metadata } from "next";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const { appName } = getWebServerConfig();
  return {
    title: `${appName} — Seguimiento de pedido`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

type TrackingPayload = {
  orderId: string;
  status: string;
  deliveryPin?: string;
  dropoffAddress?: string;
  updatedAt?: string;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  SEEKING_COURIER: "Buscando domiciliario",
  OFFERED: "Oferta enviada",
  ACCEPTED: "Domiciliario asignado",
  ARRIVING_PICKUP: "En camino al restaurante",
  AT_PICKUP: "En el restaurante",
  PICKED_UP: "Pedido recogido (en camino)",
  AT_DROPOFF: "En el punto de entrega",
  DELIVERED: "Entregado",
  CANCELLED_RESTAURANT: "Cancelado por el restaurante",
  CANCELLED_COURIER: "Cancelado por el domiciliario",
  CANCELLED_ADMIN: "Cancelado por operaciones",
  EXPIRED: "Expirado",
  FAILED: "Fallido",
};

async function fetchTracking(token: string): Promise<TrackingPayload | null> {
  const { apiBaseUrl } = getWebServerConfig();
  try {
    const res = await fetch(`${apiBaseUrl}/v1/tracking/${encodeURIComponent(token)}`, {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as TrackingPayload;
    return data;
  } catch {
    return null;
  }
}

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { appName } = getWebServerConfig();
  const tracking = await fetchTracking(token);

  if (!tracking) {
    return (
      <main
        style={{
          maxWidth: "34rem",
          margin: "3rem auto",
          padding: "2rem",
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          border: "1px solid #e2e8f0",
        }}
      >
        <p style={{ fontSize: "0.875rem", color: "#475569", margin: 0 }}>{appName}</p>
        <h1 style={{ fontSize: "1.5rem", marginTop: "0.5rem" }}>
          Enlace de seguimiento no disponible
        </h1>
        <p style={{ color: "#475569", lineHeight: 1.5 }}>
          Este enlace ha vencido, fue revocado o no es válido. Solicita uno nuevo al restaurante si
          necesitas consultar tu pedido.
        </p>
      </main>
    );
  }

  const statusLabel = STATUS_LABELS[tracking.status] ?? tracking.status;

  return (
    <main
      style={{
        maxWidth: "34rem",
        margin: "3rem auto",
        padding: "2rem",
        backgroundColor: "#ffffff",
        borderRadius: "12px",
        border: "1px solid #e2e8f0",
      }}
    >
      <p style={{ fontSize: "0.875rem", color: "#475569", margin: 0 }}>{appName}</p>
      <h1 style={{ fontSize: "1.5rem", marginTop: "0.5rem" }}>Seguimiento de tu pedido</h1>

      <div
        data-testid="tracking-status"
        style={{
          marginTop: "1rem",
          padding: "1rem",
          borderRadius: "8px",
          backgroundColor: "#f1f5f9",
        }}
      >
        <div style={{ fontSize: "0.875rem", color: "#475569" }}>Estado actual</div>
        <div style={{ fontSize: "1.125rem", fontWeight: 700, marginTop: "0.25rem" }}>
          {statusLabel} ({tracking.status})
        </div>
      </div>

      {tracking.dropoffAddress ? (
        <p style={{ marginTop: "1rem", color: "#334155" }}>
          <strong>Destino:</strong> {tracking.dropoffAddress}
        </p>
      ) : null}

      {tracking.deliveryPin ? (
        <section
          data-testid="delivery-pin-box"
          style={{
            marginTop: "1.25rem",
            padding: "1rem",
            borderRadius: "8px",
            border: "2px solid #0f766e",
            backgroundColor: "#f0fdfa",
          }}
        >
          <div style={{ fontSize: "0.875rem", color: "#115e59", fontWeight: 600 }}>
            PIN de entrega
          </div>
          <div
            data-testid="delivery-pin-value"
            style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "0.25em" }}
          >
            {tracking.deliveryPin}
          </div>
          <p style={{ fontSize: "0.875rem", color: "#134e4a", marginBottom: 0 }}>
            Entrega este PIN únicamente al domiciliario cuando recibas tu pedido.
          </p>
        </section>
      ) : null}
    </main>
  );
}
