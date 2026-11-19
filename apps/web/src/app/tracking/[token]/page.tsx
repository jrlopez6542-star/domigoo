import type { Metadata } from "next";
import Link from "next/link";
import { PublicTrackingView, type TrackingPayload } from "@/components/public-tracking-view";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const { appName } = getWebServerConfig();
  return {
    title: `${appName} — Seguimiento de solicitud`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

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
      <div className="dg-v2-shell">
        <main
          className="dg-v2-card"
          style={{
            maxWidth: "34rem",
            width: "calc(100% - 32px)",
            margin: "3rem auto",
            padding: "2rem",
          }}
        >
          <p style={{ fontSize: "0.875rem", color: "#79D5D0", fontWeight: 700, margin: 0 }}>
            {appName}
          </p>
          <h1 style={{ fontSize: "1.45rem", marginTop: "0.5rem", color: "#F5F7FA" }}>
            Enlace de seguimiento no disponible
          </h1>
          <p style={{ color: "#C0C6D4", lineHeight: 1.5 }}>
            Este enlace ha vencido, fue revocado o no es válido. Solicita uno nuevo al restaurante
            si necesitas consultar tu solicitud.
          </p>
          <Link href="/" className="dg-btn" style={{ marginTop: 12 }}>
            Volver al inicio
          </Link>
        </main>
      </div>
    );
  }

  return <PublicTrackingView appName={appName} token={token} initialTracking={tracking} />;
}
