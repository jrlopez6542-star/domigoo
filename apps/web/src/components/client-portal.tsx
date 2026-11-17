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
  const [originLng] = useState("-73.9125");
  const [originLat] = useState("4.9652");
  const [destLng, setDestLng] = useState("-73.9180");
  const [destLat, setDestLat] = useState("4.9701");
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoStatus, setGeoStatus] = useState("Destino por defecto: centro de Tocancipá.");
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

  function handleUseMyLocation() {
    setQuoteError("");
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setQuoteError("Tu navegador no soporta geolocalización.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude.toFixed(6);
        const lat = pos.coords.latitude.toFixed(6);
        setDestLng(lng);
        setDestLat(lat);
        setGeoStatus(`Tu ubicación de entrega: ${lat}, ${lng}`);
        setGeoLoading(false);
      },
      (err) => {
        setQuoteError(
          err.code === err.PERMISSION_DENIED
            ? "Permiso de ubicación denegado. Actívalo en tu navegador o usa la ubicación por defecto."
            : "No pudimos obtener tu ubicación actual.",
        );
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

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
        accountRole="CUSTOMER"
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
        <form
          onSubmit={(e) => {
            void handleLookupTracking(e);
          }}
          className="dg-stack"
        >
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
          Estima el costo de envío en Tocancipá usando tu ubicación actual (requiere iniciar
          sesión).
        </p>
        <form
          onSubmit={(e) => {
            void handleEstimateDelivery(e);
          }}
          className="dg-stack"
        >
          <p className="dg-muted" style={{ margin: 0 }}>
            {geoStatus}
          </p>
          <div className="dg-btn-row">
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={geoLoading}
              onClick={handleUseMyLocation}
            >
              {geoLoading ? "Obteniendo ubicación..." : "Usar mi ubicación"}
            </button>
            <button type="submit" className="dg-btn" disabled={!sessionUser || quoteLoading}>
              {quoteLoading ? "Calculando..." : "Calcular tarifa"}
            </button>
          </div>

          <details className="dg-details">
            <summary>Opciones avanzadas (coordenadas)</summary>
            <div className="dg-grid-2">
              <label className="dg-field" htmlFor="client-origin-lng">
                <span>Longitud origen (solo lectura)</span>
                <input
                  id="client-origin-lng"
                  className="dg-input"
                  type="text"
                  value={originLng}
                  readOnly
                />
              </label>
              <label className="dg-field" htmlFor="client-origin-lat">
                <span>Latitud origen (solo lectura)</span>
                <input
                  id="client-origin-lat"
                  className="dg-input"
                  type="text"
                  value={originLat}
                  readOnly
                />
              </label>
              <label className="dg-field" htmlFor="client-dest-lng">
                <span>Longitud destino (solo lectura)</span>
                <input
                  id="client-dest-lng"
                  className="dg-input"
                  type="text"
                  value={destLng}
                  readOnly
                />
              </label>
              <label className="dg-field" htmlFor="client-dest-lat">
                <span>Latitud destino (solo lectura)</span>
                <input
                  id="client-dest-lat"
                  className="dg-input"
                  type="text"
                  value={destLat}
                  readOnly
                />
              </label>
            </div>
          </details>
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
