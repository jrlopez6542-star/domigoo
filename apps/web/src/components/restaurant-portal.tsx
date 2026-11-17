"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import { callProxy } from "@/lib/api-client";
import type { CreateRestaurantPayload, QuotePayload } from "@/lib/contracts";
import { RoleAuthCard, type SessionUser } from "./role-auth-card";

type OrderView = {
  id: string;
  status: string;
  foodAmountCop?: number;
  deliveryFeeCop?: number;
  pickupPin?: string;
};

type OrderEvent = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  createdAt: string;
};

export function RestaurantPortal({ appName }: { appName: string }) {
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  // Geolocalización (sucursal / entrega)
  const [showGeoConsent, setShowGeoConsent] = useState(false);
  const [geoConsentChecked, setGeoConsentChecked] = useState(false);
  const [geoConsentId, setGeoConsentId] = useState<string | null>(null);
  const [branchGeoStatus, setBranchGeoStatus] = useState(
    "Coordenadas por defecto: Tocancipá centro.",
  );
  const [dropoffGeoStatus, setDropoffGeoStatus] = useState(
    "Coordenadas por defecto: Tocancipá centro.",
  );

  // 2. Restaurante, establecimiento y sucursal
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [nit, setNit] = useState("");
  const [siteEmail, setSiteEmail] = useState("");
  const [sitePhoneE164, setSitePhoneE164] = useState("");
  const [establishmentName, setEstablishmentName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [branchLongitude, setBranchLongitude] = useState("-73.9125");
  const [branchLatitude, setBranchLatitude] = useState("4.9652");
  const [restaurantId, setRestaurantId] = useState("");
  const [branchId, setBranchId] = useState("");

  // 3. Borrador y cotización
  const [foodAmountCop, setFoodAmountCop] = useState("25000");
  const [deliveryFeeCop, setDeliveryFeeCop] = useState("6000");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [quoteSummary, setQuoteSummary] = useState<string>("");
  const [orderId, setOrderId] = useState("");

  // 4. Publicar
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [dropoffLongitude, setDropoffLongitude] = useState("-73.9180");
  const [dropoffLatitude, setDropoffLatitude] = useState("4.9701");
  const [publishMode, setPublishMode] = useState<"OPEN" | "DIRECT">("OPEN");
  const [courierId, setCourierId] = useState("");

  // 5. Recorrido
  const [orderView, setOrderView] = useState<OrderView | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [trackingUrl, setTrackingUrl] = useState<string>("");

  const handleAuthenticated = useCallback((user: SessionUser) => {
    setSessionUser(user);
  }, []);

  const handleLoggedOut = useCallback(() => {
    setSessionUser(null);
    setOrderView(null);
    setEvents([]);
    setTrackingUrl("");
  }, []);

  async function runAction(label: string, fn: () => Promise<void>) {
    setErrorMessage("");
    setStatusMessage("");
    setBusyAction(label);
    try {
      await fn();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Ocurrió un error inesperado.");
    } finally {
      setBusyAction(null);
    }
  }

  function requestBrowserLocation(target: "branch" | "dropoff") {
    setErrorMessage("");
    setStatusMessage("");
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setErrorMessage("Tu navegador no soporta geolocalización.");
      return;
    }
    setBusyAction(`geo-${target}`);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude.toFixed(6);
        const lat = pos.coords.latitude.toFixed(6);
        if (target === "branch") {
          setBranchLongitude(lng);
          setBranchLatitude(lat);
          setBranchGeoStatus(`Ubicación de sucursal: ${lat}, ${lng}`);
        } else {
          setDropoffLongitude(lng);
          setDropoffLatitude(lat);
          setDropoffGeoStatus(`Ubicación de entrega: ${lat}, ${lng}`);
        }
        setStatusMessage("Ubicación obtenida desde tu dispositivo.");
        setBusyAction(null);
      },
      (err) => {
        setErrorMessage(
          err.code === err.PERMISSION_DENIED
            ? "Permiso de ubicación denegado. Actívalo en tu navegador o escribe la dirección manualmente."
            : "No pudimos obtener tu ubicación actual.",
        );
        setBusyAction(null);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleAllowGeoConsent() {
    setErrorMessage("");
    if (!geoConsentChecked) {
      setErrorMessage("Marca la casilla de autorización de geolocalización antes de continuar.");
      return;
    }
    try {
      if (sessionUser) {
        const granted = await callProxy<{ id: string }>("consents", "POST", {
          purpose: "GEOLOCATION",
          channel: "WEB",
        });
        setGeoConsentId(granted.id);
      }
      setShowGeoConsent(false);
      requestBrowserLocation("dropoff");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo guardar el consentimiento.");
    }
  }

  async function handleRevokeGeoConsent() {
    if (!geoConsentId) {
      return;
    }
    await runAction("revoke-geo", async () => {
      await callProxy<unknown>(`consents/${geoConsentId}/revoke`, "POST", {});
      setGeoConsentId(null);
      setGeoConsentChecked(false);
      setStatusMessage("Consentimiento de geolocalización revocado.");
    });
  }

  async function handleCreateBranch(e: FormEvent) {
    e.preventDefault();
    await runAction("branch", async () => {
      const payload: CreateRestaurantPayload = {
        legalName,
        tradeName,
        nit,
        email: siteEmail,
        phoneE164: sitePhoneE164,
        establishmentName,
        branchName,
        addressLine,
        longitude: Number(branchLongitude),
        latitude: Number(branchLatitude),
      };
      const data = await callProxy<{ id: string; branchId: string }>(
        "restaurants",
        "POST",
        payload,
      );
      setRestaurantId(data.id);
      setBranchId(data.branchId);
      setStatusMessage(`Sucursal creada (${data.branchId}).`);
    });
  }

  async function handleQuote() {
    await runAction("quote", async () => {
      const payload: QuotePayload = {
        origin: {
          longitude: Number(branchLongitude),
          latitude: Number(branchLatitude),
        },
        destination: {
          longitude: Number(dropoffLongitude),
          latitude: Number(dropoffLatitude),
        },
        at: new Date().toISOString(),
      };
      const data = await callProxy<{ deliveryFeeCop: number; distanceMeters?: number }>(
        "tariffs/quote",
        "POST",
        payload,
      );
      setDeliveryFeeCop(String(data.deliveryFeeCop));
      setQuoteSummary(`Domicilio cotizado: $${String(data.deliveryFeeCop)} COP`);
      setStatusMessage("Cotización calculada.");
    });
  }

  async function handleCreateDraft(e: FormEvent) {
    e.preventDefault();
    await runAction("draft", async () => {
      const data = await callProxy<{ id: string; status: string }>("orders", "POST", {
        branchId,
        foodAmountCop: Number(foodAmountCop),
        deliveryFeeCop: Number(deliveryFeeCop),
        paymentMethod,
      });
      setOrderId(data.id);
      setOrderView({ id: data.id, status: data.status });
      setStatusMessage(`Borrador creado (${data.id}).`);
    });
  }

  async function handlePublish(e: FormEvent) {
    e.preventDefault();
    await runAction("publish", async () => {
      const payload =
        publishMode === "DIRECT"
          ? {
              mode: "DIRECT",
              courierId,
              customerName,
              customerPhone,
              dropoffAddress,
              longitude: Number(dropoffLongitude),
              latitude: Number(dropoffLatitude),
            }
          : {
              mode: "OPEN",
              customerName,
              customerPhone,
              dropoffAddress,
              longitude: Number(dropoffLongitude),
              latitude: Number(dropoffLatitude),
            };
      const data = await callProxy<{ status: string }>(
        `orders/${orderId}/publish`,
        "POST",
        payload,
      );
      setOrderView({ id: orderId, status: data.status });
      setStatusMessage(`Pedido publicado: ${data.status}`);
    });
  }

  async function handleRefreshOrder() {
    if (!orderId) return;
    await runAction("refresh", async () => {
      const [view, evs] = await Promise.all([
        callProxy<OrderView>(`orders/${orderId}`, "GET"),
        callProxy<{ events: OrderEvent[] }>(`orders/${orderId}/events`, "GET"),
      ]);
      setOrderView(view);
      setEvents(evs.events);
    });
  }

  async function handleCreateTrackingLink() {
    if (!orderId) return;
    await runAction("tracking", async () => {
      const res = await callProxy<{ token: string }>(`orders/${orderId}/tracking-link`, "POST", {});
      setTrackingUrl(`/tracking/${res.token}`);
      setStatusMessage("Enlace público de seguimiento generado.");
    });
  }

  return (
    <div className="dg-stack">
      <div className="dg-card">
        <span
          className="dg-badge"
          style={{
            marginBottom: "8px",
            background: "var(--dg-blue-soft)",
            color: "var(--dg-blue)",
            borderColor: "#bfdbfe",
          }}
        >
          Soy restaurante · Tocancipá
        </span>
        <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.4rem, 3vw, 1.9rem)" }}>
          {appName} — Portal de Restaurantes
        </h1>
        <p className="dg-muted" style={{ margin: 0 }}>
          Administra tus sucursales, cotiza domicilios, crea borradores y sigue el recorrido de cada
          entrega en tiempo real.
        </p>
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

      <RoleAuthCard
        accountRole="RESTAURANT"
        roleTitle="1. Acceso de restaurante"
        roleSubtitle="Inicia sesión o crea tu cuenta de restaurante con correo o teléfono (+57...)."
        identifierPlaceholder="restaurante@ejemplo.com"
        sessionUser={sessionUser}
        onAuthenticated={handleAuthenticated}
        onLoggedOut={handleLoggedOut}
      />

      <section className="dg-card" aria-labelledby="restaurant-branch-title">
        <h2 id="restaurant-branch-title">2. Sucursal y establecimiento</h2>
        <form
          onSubmit={(e) => {
            void handleCreateBranch(e);
          }}
          className="dg-stack"
        >
          <div className="dg-grid-2">
            <label className="dg-field" htmlFor="rest-legal-name">
              <span>Razón social</span>
              <input
                id="rest-legal-name"
                className="dg-input"
                type="text"
                value={legalName}
                onChange={(e) => {
                  setLegalName(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-trade-name">
              <span>Nombre comercial</span>
              <input
                id="rest-trade-name"
                className="dg-input"
                type="text"
                value={tradeName}
                onChange={(e) => {
                  setTradeName(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-nit">
              <span>NIT</span>
              <input
                id="rest-nit"
                className="dg-input"
                type="text"
                value={nit}
                onChange={(e) => {
                  setNit(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-email">
              <span>Correo del establecimiento</span>
              <input
                id="rest-email"
                className="dg-input"
                type="email"
                value={siteEmail}
                onChange={(e) => {
                  setSiteEmail(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-phone">
              <span>Teléfono E.164</span>
              <input
                id="rest-phone"
                className="dg-input"
                type="text"
                value={sitePhoneE164}
                onChange={(e) => {
                  setSitePhoneE164(e.target.value);
                }}
                placeholder="+573001112233"
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-establishment">
              <span>Establecimiento</span>
              <input
                id="rest-establishment"
                className="dg-input"
                type="text"
                value={establishmentName}
                onChange={(e) => {
                  setEstablishmentName(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-branch-name">
              <span>Nombre de la sucursal</span>
              <input
                id="rest-branch-name"
                className="dg-input"
                type="text"
                value={branchName}
                onChange={(e) => {
                  setBranchName(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-address">
              <span>Dirección de la sucursal</span>
              <input
                id="rest-address"
                className="dg-input"
                type="text"
                value={addressLine}
                onChange={(e) => {
                  setAddressLine(e.target.value);
                }}
                required
              />
            </label>
          </div>

          <p className="dg-muted" style={{ margin: 0 }}>
            {branchGeoStatus}
          </p>

          <div className="dg-btn-row">
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={busyAction === "geo-branch"}
              onClick={() => {
                requestBrowserLocation("branch");
              }}
            >
              {busyAction === "geo-branch" ? "Obteniendo ubicación..." : "Usar mi ubicación"}
            </button>
            <button
              type="submit"
              className="dg-btn"
              disabled={!sessionUser || busyAction === "branch"}
            >
              {busyAction === "branch" ? "Creando sucursal..." : "Crear restaurante y sucursal"}
            </button>
            {restaurantId ? <span className="dg-pill">Restaurante: {restaurantId}</span> : null}
            {branchId ? <span className="dg-pill">Sucursal: {branchId}</span> : null}
          </div>

          <details className="dg-details">
            <summary>Opciones avanzadas (coordenadas de sucursal)</summary>
            <div className="dg-grid-2">
              <label className="dg-field" htmlFor="rest-lng">
                <span>Longitud (solo lectura)</span>
                <input
                  id="rest-lng"
                  className="dg-input"
                  type="text"
                  value={branchLongitude}
                  readOnly
                />
              </label>
              <label className="dg-field" htmlFor="rest-lat">
                <span>Latitud (solo lectura)</span>
                <input
                  id="rest-lat"
                  className="dg-input"
                  type="text"
                  value={branchLatitude}
                  readOnly
                />
              </label>
            </div>
          </details>
        </form>
      </section>

      <section className="dg-card" aria-labelledby="restaurant-draft-title">
        <h2 id="restaurant-draft-title">3. Cotizar y crear borrador de pedido</h2>
        <form
          onSubmit={(e) => {
            void handleCreateDraft(e);
          }}
          className="dg-stack"
        >
          <div className="dg-grid-2">
            <label className="dg-field" htmlFor="rest-branch-id">
              <span>ID de sucursal</span>
              <input
                id="rest-branch-id"
                className="dg-input"
                type="text"
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-payment-method">
              <span>Medio de pago</span>
              <select
                id="rest-payment-method"
                className="dg-select"
                value={paymentMethod}
                onChange={(e) => {
                  setPaymentMethod(e.target.value as "CASH" | "TRANSFER");
                }}
              >
                <option value="CASH">Efectivo</option>
                <option value="TRANSFER">Transferencia</option>
              </select>
            </label>
            <label className="dg-field" htmlFor="rest-food-amount">
              <span>Valor de la comida (COP)</span>
              <input
                id="rest-food-amount"
                className="dg-input"
                type="number"
                value={foodAmountCop}
                onChange={(e) => {
                  setFoodAmountCop(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-delivery-fee">
              <span>Valor del domicilio (COP)</span>
              <input
                id="rest-delivery-fee"
                className="dg-input"
                type="number"
                value={deliveryFeeCop}
                onChange={(e) => {
                  setDeliveryFeeCop(e.target.value);
                }}
                required
              />
            </label>
          </div>
          <div className="dg-btn-row">
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={!sessionUser || busyAction === "quote"}
              onClick={() => {
                void handleQuote();
              }}
            >
              {busyAction === "quote" ? "Cotizando..." : "Cotizar domicilio"}
            </button>
            <button
              type="submit"
              className="dg-btn"
              disabled={!sessionUser || busyAction === "draft"}
            >
              {busyAction === "draft" ? "Creando borrador..." : "Crear borrador"}
            </button>
            {quoteSummary ? <span className="dg-pill">{quoteSummary}</span> : null}
          </div>
        </form>
      </section>

      <section className="dg-card" aria-labelledby="restaurant-publish-title">
        <h2 id="restaurant-publish-title">4. Publicar domicilio</h2>
        <div className="dg-btn-row" style={{ marginBottom: "12px" }}>
          <button
            type="button"
            data-testid="open-geo-consent"
            className="dg-btn dg-btn--secondary"
            onClick={() => {
              setShowGeoConsent(true);
            }}
          >
            Usar ubicación para entrega (con consentimiento)
          </button>
          {geoConsentId ? (
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              onClick={() => {
                void handleRevokeGeoConsent();
              }}
            >
              Revocar geolocalización
            </button>
          ) : null}
        </div>

        {showGeoConsent ? (
          <div
            data-testid="geo-consent-screen"
            className="dg-card"
            style={{ background: "var(--dg-surface-muted)", marginBottom: "14px" }}
          >
            <h3>Autorización de geolocalización</h3>
            <p className="dg-muted">
              Usamos tu ubicación únicamente para ubicar el punto de entrega en Tocancipá. Puedes
              revocar este permiso en cualquier momento o escribir la dirección manualmente.
              Consulta la{" "}
              <Link href="/legal/privacidad" className="dg-footer-link">
                Política de Privacidad
              </Link>
              .
            </p>
            <label className="dg-check-row" style={{ marginBottom: "12px" }}>
              <input
                type="checkbox"
                name="geoConsentChecked"
                checked={geoConsentChecked}
                onChange={(e) => {
                  setGeoConsentChecked(e.target.checked);
                }}
              />
              <span>Autorizo el uso de geolocalización para esta entrega.</span>
            </label>
            <div className="dg-btn-row">
              <button
                type="button"
                data-testid="geo-consent-allow"
                className="dg-btn"
                onClick={() => {
                  void handleAllowGeoConsent();
                }}
              >
                Permitir
              </button>
              <button
                type="button"
                data-testid="geo-consent-manual"
                className="dg-btn dg-btn--secondary"
                onClick={() => {
                  setShowGeoConsent(false);
                }}
              >
                Escribir dirección manualmente
              </button>
            </div>
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            void handlePublish(e);
          }}
          className="dg-stack"
        >
          <div className="dg-grid-2">
            <label className="dg-field" htmlFor="rest-publish-mode">
              <span>Modalidad</span>
              <select
                id="rest-publish-mode"
                className="dg-select"
                value={publishMode}
                onChange={(e) => {
                  setPublishMode(e.target.value as "OPEN" | "DIRECT");
                }}
              >
                <option value="OPEN">Oferta abierta en el radio</option>
                <option value="DIRECT">Asignación directa</option>
              </select>
            </label>
            {publishMode === "DIRECT" ? (
              <label className="dg-field" htmlFor="rest-courier-id">
                <span>ID del domiciliario</span>
                <input
                  id="rest-courier-id"
                  className="dg-input"
                  type="text"
                  value={courierId}
                  onChange={(e) => {
                    setCourierId(e.target.value);
                  }}
                  required
                />
              </label>
            ) : null}
            <label className="dg-field" htmlFor="rest-customer-name">
              <span>Nombre del cliente</span>
              <input
                id="rest-customer-name"
                className="dg-input"
                type="text"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-customer-phone">
              <span>Teléfono del cliente (+57...)</span>
              <input
                id="rest-customer-phone"
                className="dg-input"
                type="text"
                value={customerPhone}
                onChange={(e) => {
                  setCustomerPhone(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="rest-dropoff-address">
              <span>Dirección de entrega</span>
              <input
                id="rest-dropoff-address"
                className="dg-input"
                type="text"
                value={dropoffAddress}
                onChange={(e) => {
                  setDropoffAddress(e.target.value);
                }}
                required
              />
            </label>
          </div>

          <p className="dg-muted" style={{ margin: 0 }}>
            {dropoffGeoStatus}
          </p>

          <details className="dg-details">
            <summary>Opciones avanzadas (ID de pedido y coordenadas de entrega)</summary>
            <div className="dg-grid-2">
              <label className="dg-field" htmlFor="rest-order-id">
                <span>ID del pedido</span>
                <input
                  id="rest-order-id"
                  className="dg-input"
                  type="text"
                  value={orderId}
                  onChange={(e) => {
                    setOrderId(e.target.value);
                  }}
                />
              </label>
              <label className="dg-field" htmlFor="rest-dropoff-lng">
                <span>Longitud de entrega (solo lectura)</span>
                <input
                  id="rest-dropoff-lng"
                  className="dg-input"
                  type="text"
                  value={dropoffLongitude}
                  readOnly
                />
              </label>
              <label className="dg-field" htmlFor="rest-dropoff-lat">
                <span>Latitud de entrega (solo lectura)</span>
                <input
                  id="rest-dropoff-lat"
                  className="dg-input"
                  type="text"
                  value={dropoffLatitude}
                  readOnly
                />
              </label>
            </div>
          </details>

          <div className="dg-btn-row">
            <button
              type="submit"
              className="dg-btn"
              disabled={!sessionUser || !orderId || busyAction === "publish"}
            >
              {busyAction === "publish" ? "Publicando..." : "Publicar domicilio"}
            </button>
          </div>
        </form>
      </section>

      <section className="dg-card" aria-labelledby="restaurant-tracking-title">
        <h2 id="restaurant-tracking-title">5. Recorrido y enlace de seguimiento</h2>
        <div className="dg-btn-row" style={{ marginBottom: "12px" }}>
          <button
            type="button"
            className="dg-btn dg-btn--secondary"
            disabled={!orderId || !sessionUser || busyAction === "refresh"}
            onClick={() => {
              void handleRefreshOrder();
            }}
          >
            Consultar estado y eventos
          </button>
          <button
            type="button"
            className="dg-btn"
            disabled={!orderId || !sessionUser || busyAction === "tracking"}
            onClick={() => {
              void handleCreateTrackingLink();
            }}
          >
            Generar enlace público
          </button>
        </div>
        {orderView ? (
          <div className="dg-alert dg-alert--success">
            Pedido <strong>{orderView.id}</strong> · Estado: <strong>{orderView.status}</strong>
            {orderView.pickupPin ? ` · PIN recogida: ${orderView.pickupPin}` : ""}
          </div>
        ) : null}
        {trackingUrl ? (
          <p>
            Enlace para el cliente:{" "}
            <a href={trackingUrl} className="dg-footer-link">
              {trackingUrl}
            </a>
          </p>
        ) : null}
        {events.length > 0 ? (
          <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
            {events.map((ev) => (
              <li key={ev.id}>
                {ev.fromStatus ?? "INICIO"} → <strong>{ev.toStatus}</strong> ({ev.createdAt})
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="dg-card" aria-labelledby="restaurant-soon-title">
        <h2 id="restaurant-soon-title">Funciones en camino</h2>
        <div className="dg-alert dg-alert--soon" style={{ marginBottom: 0 }}>
          <strong>Próximamente:</strong> Listado paginado de pedidos históricos del restaurante (la
          API actual consulta pedidos por ID `GET /v1/orders/:id`).
        </div>
      </section>
    </div>
  );
}
