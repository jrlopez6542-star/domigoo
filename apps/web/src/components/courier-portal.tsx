"use client";

import { useCallback, useState, type FormEvent } from "react";
import { callProxy } from "@/lib/api-client";
import { RoleAuthCard, type SessionUser } from "./role-auth-card";

type CourierOrderView = {
  id: string;
  status: string;
  deliveryFeeCop?: number;
  pickupAddress?: string;
  dropoffAddress?: string;
  customerPhone?: string;
};

export function CourierPortal() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Perfil de domiciliario
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [documentType, setDocumentType] = useState("CC");
  const [documentNumber, setDocumentNumber] = useState("");
  const [courierId, setCourierId] = useState("");

  // Disponibilidad y ubicación
  const [availability, setAvailability] = useState<"AVAILABLE" | "OFFLINE">("OFFLINE");
  const [longitude, setLongitude] = useState("-73.9130");
  const [latitude, setLatitude] = useState("4.9660");

  // Oferta y pedido
  const [offerId, setOfferId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [pickupPin, setPickupPin] = useState("");
  const [deliveryPin, setDeliveryPin] = useState("");
  const [orderView, setOrderView] = useState<CourierOrderView | null>(null);

  const handleAuthenticated = useCallback((user: SessionUser) => {
    setSessionUser(user);
  }, []);

  const handleLoggedOut = useCallback(() => {
    setSessionUser(null);
    setCourierId("");
    setOrderView(null);
    setAvailability("OFFLINE");
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

  async function handleCreateProfile(e: FormEvent) {
    e.preventDefault();
    await runAction("profile", async () => {
      const data = await callProxy<{ id: string; status: string }>("couriers", "POST", {
        firstName,
        lastName,
        documentType,
        documentNumber,
      });
      setCourierId(data.id);
      setStatusMessage(`Perfil de domiciliario creado (${data.status}). ID: ${data.id}`);
    });
  }

  async function handleAvailability(nextState: "AVAILABLE" | "OFFLINE") {
    await runAction("availability", async () => {
      const data = await callProxy<{ state: "AVAILABLE" | "OFFLINE" }>(
        "couriers/me/availability",
        "POST",
        { state: nextState },
      );
      setAvailability(data.state);
      setStatusMessage(
        data.state === "AVAILABLE"
          ? "Ahora estás disponible para recibir domicilios."
          : "Pasaste a estado desconectado.",
      );
    });
  }

  async function handleSendLocation(e: FormEvent) {
    e.preventDefault();
    await runAction("location", async () => {
      await callProxy<{ recorded: true }>("couriers/me/location", "POST", {
        longitude: Number(longitude),
        latitude: Number(latitude),
      });
      setStatusMessage("Ubicación reportada correctamente.");
    });
  }

  async function handleAcceptOffer() {
    if (!offerId.trim()) {
      setErrorMessage("Ingresa el ID de la oferta.");
      return;
    }
    await runAction("accept-offer", async () => {
      const res = await fetch(`/api/proxy/offers/${encodeURIComponent(offerId.trim())}/accept`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `web-${offerId.trim()}-${String(Date.now())}`,
        },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        orderId?: string;
        status?: string;
      };
      if (!res.ok) {
        throw new Error(data.message ?? `Error ${String(res.status)}`);
      }
      if (data.orderId) {
        setOrderId(data.orderId);
      }
      setStatusMessage(`Oferta aceptada (${data.status ?? "ACCEPTED"}).`);
    });
  }

  async function handleDeclineOffer() {
    if (!offerId.trim()) {
      setErrorMessage("Ingresa el ID de la oferta.");
      return;
    }
    await runAction("decline-offer", async () => {
      const data = await callProxy<{ status: string }>(
        `offers/${encodeURIComponent(offerId.trim())}/decline`,
        "POST",
        {},
      );
      setStatusMessage(`Oferta rechazada (${data.status}).`);
    });
  }

  async function handleLoadOrder() {
    if (!orderId.trim()) {
      setErrorMessage("Ingresa el ID del pedido.");
      return;
    }
    await runAction("load-order", async () => {
      const data = await callProxy<CourierOrderView>(
        `orders/${encodeURIComponent(orderId.trim())}`,
        "GET",
      );
      setOrderView(data);
      setStatusMessage(`Pedido en estado ${data.status}.`);
    });
  }

  async function handleJourneyStep(action: "arrive-pickup" | "at-pickup" | "at-dropoff") {
    if (!orderId.trim()) {
      setErrorMessage("Ingresa el ID del pedido.");
      return;
    }
    await runAction(action, async () => {
      const data = await callProxy<{ status: string }>(
        `orders/${encodeURIComponent(orderId.trim())}/${action}`,
        "POST",
        {},
      );
      setStatusMessage(`Estado actualizado: ${data.status}.`);
      const updated = await callProxy<CourierOrderView>(
        `orders/${encodeURIComponent(orderId.trim())}`,
        "GET",
      );
      setOrderView(updated);
    });
  }

  async function handleVerifyPin(kind: "pickup-pin" | "delivery-pin", pin: string) {
    if (!orderId.trim() || !pin.trim()) {
      setErrorMessage("Ingresa el ID del pedido y el PIN.");
      return;
    }
    await runAction(kind, async () => {
      const data = await callProxy<{ status: string }>(
        `orders/${encodeURIComponent(orderId.trim())}/${kind}`,
        "POST",
        { pin: pin.trim() },
      );
      setStatusMessage(`PIN verificado. Nuevo estado: ${data.status}.`);
      const updated = await callProxy<CourierOrderView>(
        `orders/${encodeURIComponent(orderId.trim())}`,
        "GET",
      );
      setOrderView(updated);
    });
  }

  return (
    <div className="dg-stack">
      <div className="dg-card">
        <span
          className="dg-badge"
          style={{
            marginBottom: "8px",
            background: "var(--dg-orange-soft)",
            color: "var(--dg-orange)",
            borderColor: "#fed7aa",
          }}
        >
          Soy domiciliario · Tocancipá
        </span>
        <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.4rem, 3vw, 1.9rem)" }}>
          Panel de domiciliario DOMIGOO
        </h1>
        <p className="dg-muted" style={{ margin: 0 }}>
          Inicia sesión o regístrate, completa tu perfil, activa tu disponibilidad y gestiona tus
          entregas en Tocancipá.
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
        roleTitle="Acceso de domiciliario"
        roleSubtitle="Ingresa con tu celular colombiano (+57...) o correo y contraseña."
        identifierPlaceholder="+573001234567"
        sessionUser={sessionUser}
        onAuthenticated={handleAuthenticated}
        onLoggedOut={handleLoggedOut}
      />

      <section className="dg-card" aria-labelledby="courier-profile-title">
        <h2 id="courier-profile-title">1. Perfil de domiciliario</h2>
        <p className="dg-muted">
          Registra tus datos básicos si aún no tienes perfil. Requiere consentimiento vigente de
          tratamiento de documentos.
        </p>
        <form onSubmit={(e) => void handleCreateProfile(e)} className="dg-stack">
          <div className="dg-grid-2">
            <label className="dg-field" htmlFor="courier-first-name">
              <span>Nombres</span>
              <input
                id="courier-first-name"
                className="dg-input"
                type="text"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="courier-last-name">
              <span>Apellidos</span>
              <input
                id="courier-last-name"
                className="dg-input"
                type="text"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                }}
                required
              />
            </label>
            <label className="dg-field" htmlFor="courier-doc-type">
              <span>Tipo de documento</span>
              <select
                id="courier-doc-type"
                className="dg-select"
                value={documentType}
                onChange={(e) => {
                  setDocumentType(e.target.value);
                }}
              >
                <option value="CC">Cédula de Ciudadanía (CC)</option>
                <option value="CE">Cédula de Extranjería (CE)</option>
                <option value="PPT">Permiso por Protección Temporal (PPT)</option>
              </select>
            </label>
            <label className="dg-field" htmlFor="courier-doc-number">
              <span>Número de documento</span>
              <input
                id="courier-doc-number"
                className="dg-input"
                type="text"
                value={documentNumber}
                onChange={(e) => {
                  setDocumentNumber(e.target.value);
                }}
                required
              />
            </label>
          </div>
          <div className="dg-btn-row">
            <button
              type="submit"
              className="dg-btn"
              disabled={!sessionUser || busyAction === "profile"}
            >
              {busyAction === "profile" ? "Guardando..." : "Crear perfil de domiciliario"}
            </button>
            {courierId ? <span className="dg-pill">ID: {courierId}</span> : null}
          </div>
        </form>
      </section>

      <section className="dg-card" aria-labelledby="courier-avail-title">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          <h2 id="courier-avail-title" style={{ margin: 0 }}>
            2. Disponibilidad y ubicación
          </h2>
          <span className="dg-pill">
            Estado: {availability === "AVAILABLE" ? "Disponible" : "Desconectado"}
          </span>
        </div>
        <div className="dg-btn-row" style={{ marginBottom: "14px" }}>
          <button
            type="button"
            className="dg-btn"
            disabled={!sessionUser || busyAction === "availability"}
            onClick={() => void handleAvailability("AVAILABLE")}
          >
            Pasar a disponible
          </button>
          <button
            type="button"
            className="dg-btn dg-btn--secondary"
            disabled={!sessionUser || busyAction === "availability"}
            onClick={() => void handleAvailability("OFFLINE")}
          >
            Desconectarme
          </button>
        </div>

        <form onSubmit={(e) => void handleSendLocation(e)} className="dg-stack">
          <div className="dg-grid-2">
            <label className="dg-field" htmlFor="courier-lng">
              <span>Longitud</span>
              <input
                id="courier-lng"
                className="dg-input"
                type="text"
                value={longitude}
                onChange={(e) => {
                  setLongitude(e.target.value);
                }}
              />
            </label>
            <label className="dg-field" htmlFor="courier-lat">
              <span>Latitud</span>
              <input
                id="courier-lat"
                className="dg-input"
                type="text"
                value={latitude}
                onChange={(e) => {
                  setLatitude(e.target.value);
                }}
              />
            </label>
          </div>
          <div className="dg-btn-row">
            <button
              type="submit"
              className="dg-btn dg-btn--secondary"
              disabled={!sessionUser || busyAction === "location"}
            >
              {busyAction === "location" ? "Enviando..." : "Enviar ubicación actual"}
            </button>
          </div>
        </form>
      </section>

      <section className="dg-card" aria-labelledby="courier-orders-title">
        <h2 id="courier-orders-title">3. Ofertas y recorrido de entrega</h2>
        <div className="dg-stack">
          <div className="dg-grid-2">
            <label className="dg-field" htmlFor="courier-offer-id">
              <span>ID de oferta</span>
              <input
                id="courier-offer-id"
                className="dg-input"
                type="text"
                value={offerId}
                onChange={(e) => {
                  setOfferId(e.target.value);
                }}
                placeholder="UUID de la oferta"
              />
            </label>
            <div className="dg-btn-row" style={{ alignSelf: "end" }}>
              <button
                type="button"
                className="dg-btn"
                disabled={!sessionUser || busyAction !== null}
                onClick={() => void handleAcceptOffer()}
              >
                Aceptar oferta
              </button>
              <button
                type="button"
                className="dg-btn dg-btn--secondary"
                disabled={!sessionUser || busyAction !== null}
                onClick={() => void handleDeclineOffer()}
              >
                Rechazar
              </button>
            </div>
          </div>

          <div className="dg-grid-2">
            <label className="dg-field" htmlFor="courier-order-id">
              <span>ID de pedido asignado</span>
              <input
                id="courier-order-id"
                className="dg-input"
                type="text"
                value={orderId}
                onChange={(e) => {
                  setOrderId(e.target.value);
                }}
                placeholder="UUID del pedido"
              />
            </label>
            <div className="dg-btn-row" style={{ alignSelf: "end" }}>
              <button
                type="button"
                className="dg-btn dg-btn--secondary"
                disabled={!sessionUser || busyAction !== null}
                onClick={() => void handleLoadOrder()}
              >
                Consultar pedido
              </button>
            </div>
          </div>

          {orderView ? (
            <div className="dg-alert dg-alert--success">
              Estado: <strong>{orderView.status}</strong>
              {orderView.pickupAddress ? ` · Recogida: ${orderView.pickupAddress}` : ""}
              {orderView.dropoffAddress ? ` · Entrega: ${orderView.dropoffAddress}` : ""}
            </div>
          ) : null}

          <div className="dg-btn-row">
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={!sessionUser || busyAction !== null}
              onClick={() => void handleJourneyStep("arrive-pickup")}
            >
              Voy en camino
            </button>
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={!sessionUser || busyAction !== null}
              onClick={() => void handleJourneyStep("at-pickup")}
            >
              Llegué al restaurante
            </button>
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={!sessionUser || busyAction !== null}
              onClick={() => void handleJourneyStep("at-dropoff")}
            >
              Llegué al cliente
            </button>
          </div>

          <div className="dg-grid-2">
            <div className="dg-btn-row" style={{ alignItems: "end" }}>
              <label className="dg-field" htmlFor="courier-pickup-pin" style={{ flex: 1 }}>
                <span>PIN de recogida</span>
                <input
                  id="courier-pickup-pin"
                  className="dg-input"
                  type="text"
                  value={pickupPin}
                  onChange={(e) => {
                    setPickupPin(e.target.value);
                  }}
                  placeholder="4-6 dígitos"
                />
              </label>
              <button
                type="button"
                className="dg-btn"
                disabled={!sessionUser || busyAction !== null}
                onClick={() => void handleVerifyPin("pickup-pin", pickupPin)}
              >
                Confirmar recogida
              </button>
            </div>

            <div className="dg-btn-row" style={{ alignItems: "end" }}>
              <label className="dg-field" htmlFor="courier-delivery-pin" style={{ flex: 1 }}>
                <span>PIN de entrega</span>
                <input
                  id="courier-delivery-pin"
                  className="dg-input"
                  type="text"
                  value={deliveryPin}
                  onChange={(e) => {
                    setDeliveryPin(e.target.value);
                  }}
                  placeholder="4-6 dígitos"
                />
              </label>
              <button
                type="button"
                className="dg-btn"
                disabled={!sessionUser || busyAction !== null}
                onClick={() => void handleVerifyPin("delivery-pin", deliveryPin)}
              >
                Confirmar entrega
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="dg-card" aria-labelledby="courier-soon-title">
        <h2 id="courier-soon-title">Funciones en camino</h2>
        <div className="dg-alert dg-alert--soon" style={{ marginBottom: 0 }}>
          <strong>Próximamente:</strong> Bandeja automática de ofertas cercanas en tiempo real
          (pendiente de endpoint `GET /v1/offers` en la API para listar ofertas pendientes sin
          ingresar el ID manualmente).
        </div>
      </section>
    </div>
  );
}
