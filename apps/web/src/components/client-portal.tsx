"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { callProxy, extractTrackingToken } from "@/lib/api-client";
import type { QuotePayload } from "@/lib/contracts";
import { RoleAuthCard, type SessionUser } from "./role-auth-card";

type PublicTrackingSummary = {
  status: string;
  pickupLabel?: string;
  dropoffLabel?: string;
  deliveryPin?: string;
};

export function ClientPortal() {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  // Seguimiento público
  const [trackingInput, setTrackingInput] = useState("");
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const [trackingPreview, setTrackingPreview] = useState<PublicTrackingSummary | null>(null);

  // Cotizador (requiere sesión)
  const [originLng, setOriginLng] = useState("-73.9125");
  const [originLat, setOriginLat] = useState("4.9652");
  const [destLng, setDestLng] = useState("-73.9180");
  const [destLat, setDestLat] = useState("4.9701");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteText, setQuoteText] = useState("");

  const handleAuthenticated = useCallback((user: SessionUser) => {
    setSessionUser(user);
  }, []);

  const handleLoggedOut = useCallback(() => {
    setSessionUser(null);
    setQuoteText("");
  }, []);

  async function handleLookupTracking(e: FormEvent) {
    e.preventDefault();
    setTrackingError("");
    setTrackingPreview(null);
    const token = extractTrackingToken(trackingInput);
    if (!token) {
      setTrackingError("Ingresa el código o enlace de seguimiento de tu pedido.");
      return;
    }
    setTrackingLoading(true);
    try {
      const data = await callProxy<PublicTrackingSummary>(
        `tracking/${encodeURIComponent(token)}`,
        "GET",
      );
      setTrackingPreview(data);
    } catch (err) {
      setTrackingError(
        err instanceof Error
          ? err.message
          : "No encontramos ese enlace de seguimiento. Verifica el código.",
      );
    } finally {
      setTrackingLoading(false);
    }
  }

  function handleOpenTrackingPage() {
    const token = extractTrackingToken(trackingInput);
    if (token) {
      router.push(`/tracking/${encodeURIComponent(token)}`);
    }
  }

  async function handleEstimateDelivery(e: FormEvent) {
    e.preventDefault();
    setQuoteError("");
    setQuoteText("");
    setQuoteLoading(true);
    try {
      const payload: QuotePayload = {
        origin: { longitude: Number(originLng), latitude: Number(originLat) },
        destination: { longitude: Number(destLng), latitude: Number(destLat) },
        at: new Date().toISOString(),
      };
      const data = await callProxy<{
        distanceKm?: number;
        totalCop?: number;
        deliveryFeeCop?: number;
      }>("tariffs/quote", "POST", payload);
      const fee = data.totalCop ?? data.deliveryFeeCop;
      setQuoteText(
        `Distancia estimada: ${String(data.distanceKm ?? "?")} km · Domicilio estimado: $${String(fee ?? "?")} COP`,
      );
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : "No se pudo calcular la tarifa.");
    } finally {
      setQuoteLoading(false);
    }
  }

  return (
    <div className="dg-stack">
      <div className="dg-card">
        <span className="dg-badge" style={{ marginBottom: "8px" }}>
          Soy cliente · Tocancipá
        </span>
        <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.4rem, 3vw, 1.9rem)" }}>
          Tu espacio de cliente en DOMIGOO
        </h1>
        <p className="dg-muted" style={{ margin: 0 }}>
          Ingresa o regístrate con tu correo o celular, sigue tu pedido en vivo y consulta tarifas
          de domicilio en Tocancipá.
        </p>
      </div>

      <RoleAuthCard
        roleTitle="Acceso de cliente"
        roleSubtitle="Usa tu correo o número celular colombiano (+57...) para iniciar sesión o registrarte."
        sessionUser={sessionUser}
        onAuthenticated={handleAuthenticated}
        onLoggedOut={handleLoggedOut}
      />

      <section className="dg-card" aria-labelledby="tracking-lookup-title">
        <h2 id="tracking-lookup-title">Seguir mi pedido</h2>
        <p className="dg-muted">
          Pega el enlace o código de seguimiento que te compartió el restaurante.
        </p>
        <form onSubmit={(e) => void handleLookupTracking(e)} className="dg-stack">
          <label className="dg-field" htmlFor="client-tracking-input">
            <span>Código o enlace de seguimiento</span>
            <input
              id="client-tracking-input"
              className="dg-input"
              type="text"
              value={trackingInput}
              onChange={(e) => {
                setTrackingInput(e.target.value);
              }}
              placeholder="Ej. trk_123... o https://.../tracking/trk_123..."
            />
          </label>
          <div className="dg-btn-row">
            <button type="submit" className="dg-btn" disabled={trackingLoading}>
              {trackingLoading ? "Consultando..." : "Consultar estado"}
            </button>
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              onClick={handleOpenTrackingPage}
              disabled={!extractTrackingToken(trackingInput)}
            >
              Abrir pantalla completa
            </button>
          </div>
        </form>

        {trackingError ? (
          <div role="alert" className="dg-alert dg-alert--error" style={{ marginTop: "12px" }}>
            {trackingError}
          </div>
        ) : null}

        {trackingPreview ? (
          <div className="dg-alert dg-alert--success" style={{ marginTop: "12px" }}>
            Estado actual: <strong>{trackingPreview.status}</strong>
            {trackingPreview.deliveryPin ? ` · PIN de entrega: ${trackingPreview.deliveryPin}` : ""}
          </div>
        ) : null}
      </section>

      <section className="dg-card" aria-labelledby="client-quote-title">
        <h2 id="client-quote-title">Calcular tarifa de domicilio</h2>
        <p className="dg-muted">
          Estima el costo de envío entre dos puntos de Tocancipá (requiere iniciar sesión).
        </p>
        <form onSubmit={(e) => void handleEstimateDelivery(e)} className="dg-stack">
          <div className="dg-grid-2">
            <label className="dg-field" htmlFor="client-origin-lng">
              <span>Longitud origen</span>
              <input
                id="client-origin-lng"
                className="dg-input"
                type="text"
                value={originLng}
                onChange={(e) => {
                  setOriginLng(e.target.value);
                }}
              />
            </label>
            <label className="dg-field" htmlFor="client-origin-lat">
              <span>Latitud origen</span>
              <input
                id="client-origin-lat"
                className="dg-input"
                type="text"
                value={originLat}
                onChange={(e) => {
                  setOriginLat(e.target.value);
                }}
              />
            </label>
            <label className="dg-field" htmlFor="client-dest-lng">
              <span>Longitud destino</span>
              <input
                id="client-dest-lng"
                className="dg-input"
                type="text"
                value={destLng}
                onChange={(e) => {
                  setDestLng(e.target.value);
                }}
              />
            </label>
            <label className="dg-field" htmlFor="client-dest-lat">
              <span>Latitud destino</span>
              <input
                id="client-dest-lat"
                className="dg-input"
                type="text"
                value={destLat}
                onChange={(e) => {
                  setDestLat(e.target.value);
                }}
              />
            </label>
          </div>
          <div className="dg-btn-row">
            <button type="submit" className="dg-btn" disabled={!sessionUser || quoteLoading}>
              {quoteLoading ? "Calculando..." : "Calcular tarifa"}
            </button>
          </div>
        </form>
        {quoteError ? (
          <div role="alert" className="dg-alert dg-alert--error" style={{ marginTop: "12px" }}>
            {quoteError}
          </div>
        ) : null}
        {quoteText ? (
          <div role="status" className="dg-alert dg-alert--success" style={{ marginTop: "12px" }}>
            {quoteText}
          </div>
        ) : null}
      </section>

      <section className="dg-card" aria-labelledby="client-soon-title">
        <h2 id="client-soon-title">Funciones en camino</h2>
        <div className="dg-grid-2">
          <div className="dg-alert dg-alert--soon" style={{ marginBottom: 0 }}>
            <strong>Próximamente:</strong> Catálogo de restaurantes de Tocancipá y carrito para
            pedir directamente desde la web (pendiente de endpoints públicos de menú y creación de
            pedido por cliente en la API).
          </div>
          <div className="dg-alert dg-alert--soon" style={{ marginBottom: 0 }}>
            <strong>Próximamente:</strong> Historial de mis pedidos anteriores (pendiente de
            endpoint de listado de pedidos por cliente en la API).
          </div>
        </div>
      </section>
    </div>
  );
}
