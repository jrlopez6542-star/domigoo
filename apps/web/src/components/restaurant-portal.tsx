"use client";

import { useState, type FormEvent } from "react";

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

export function RestaurantPortal({ appName }: { appName: string }) {
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // 1. Login
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  // 2. Restaurante y sucursal
  const [legalName, setLegalName] = useState("");
  const [nit, setNit] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [address, setAddress] = useState("");
  const [branchLongitude, setBranchLongitude] = useState("-74.0817");
  const [branchLatitude, setBranchLatitude] = useState("4.6097");
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
  const [dropoffLongitude, setDropoffLongitude] = useState("-74.083");
  const [dropoffLatitude, setDropoffLatitude] = useState("4.612");
  const [publishMode, setPublishMode] = useState<"OPEN" | "DIRECT">("OPEN");
  const [courierId, setCourierId] = useState("");

  // 5. Recorrido
  const [orderView, setOrderView] = useState<OrderView | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [trackingUrl, setTrackingUrl] = useState<string>("");

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      const data = await callProxy<{ user?: { id: string } }>("auth/login", "POST", {
        phone,
        password,
        client: "WEB",
      });
      setSessionUserId(data.user?.id ?? "activo");
      setStatusMessage("Sesión iniciada correctamente.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    }
  }

  async function handleCreateBranch(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      const data = await callProxy<{
        id: string;
        branchId: string;
      }>("restaurants", "POST", {
        legalName,
        nit,
        tradeName,
        branchName,
        address,
        longitude: Number(branchLongitude),
        latitude: Number(branchLatitude),
      });
      setRestaurantId(data.id);
      setBranchId(data.branchId);
      setStatusMessage(`Sucursal creada (${data.branchId}).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo crear la sucursal.");
    }
  }

  async function handleQuote() {
    setErrorMessage("");
    setStatusMessage("");
    try {
      const data = await callProxy<{ deliveryFeeCop: number; distanceMeters?: number }>(
        "tariffs/quote",
        "POST",
        {
          branchId,
          longitude: Number(dropoffLongitude),
          latitude: Number(dropoffLatitude),
        },
      );
      setDeliveryFeeCop(String(data.deliveryFeeCop));
      setQuoteSummary(`Domicilio cotizado: $${String(data.deliveryFeeCop)} COP`);
      setStatusMessage("Cotización calculada.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo cotizar el domicilio.");
    }
  }

  async function handleCreateDraft(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      const data = await callProxy<{ id: string; status: string }>("orders", "POST", {
        branchId,
        foodAmountCop: Number(foodAmountCop),
        deliveryFeeCop: Number(deliveryFeeCop),
        paymentMethod,
      });
      setOrderId(data.id);
      setOrderView({ id: data.id, status: data.status });
      setStatusMessage(`Borrador creado (${data.id}).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo crear el borrador.");
    }
  }

  async function handlePublish(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
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
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo publicar el pedido.");
    }
  }

  async function handleRefreshOrder() {
    if (!orderId) return;
    setErrorMessage("");
    try {
      const [view, evs] = await Promise.all([
        callProxy<OrderView>(`orders/${orderId}`, "GET"),
        callProxy<{ events: OrderEvent[] }>(`orders/${orderId}/events`, "GET"),
      ]);
      setOrderView(view);
      setEvents(evs.events);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo consultar el pedido.");
    }
  }

  async function handleCreateTrackingLink() {
    if (!orderId) return;
    setErrorMessage("");
    try {
      const res = await callProxy<{ token: string }>(`orders/${orderId}/tracking-link`, "POST", {});
      setTrackingUrl(`/tracking/${res.token}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo generar el enlace.");
    }
  }

  return (
    <main style={{ maxWidth: "56rem", margin: "2rem auto", padding: "0 1rem" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>{appName} — Portal de Restaurantes</h1>
        <p style={{ color: "#475569", marginTop: "0.25rem" }}>
          Administra tus sucursales, arma borradores y sigue el recorrido de cada domicilio.
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
        <h2 style={{ marginTop: 0 }}>1. Ingreso del restaurante</h2>
        {sessionUserId ? <p data-testid="session-active">Sesión activa: {sessionUserId}</p> : null}
        <form onSubmit={(e) => void handleLogin(e)} style={{ display: "grid", gap: "0.75rem" }}>
          <label>
            Teléfono
            <input
              name="phone"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
              }}
              placeholder="+573001112233"
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
        <h2 style={{ marginTop: 0 }}>2. Crear restaurante y sucursal</h2>
        <form
          onSubmit={(e) => void handleCreateBranch(e)}
          style={{ display: "grid", gap: "0.75rem" }}
        >
          <label>
            Razón social
            <input
              name="legalName"
              value={legalName}
              onChange={(e) => {
                setLegalName(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            NIT
            <input
              name="nit"
              value={nit}
              onChange={(e) => {
                setNit(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Nombre comercial
            <input
              name="tradeName"
              value={tradeName}
              onChange={(e) => {
                setTradeName(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Nombre de la sucursal
            <input
              name="branchName"
              value={branchName}
              onChange={(e) => {
                setBranchName(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Dirección de la sucursal
            <input
              name="address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label>
              Longitud (numérica)
              <input
                name="branchLongitude"
                type="number"
                step="any"
                value={branchLongitude}
                onChange={(e) => {
                  setBranchLongitude(e.target.value);
                }}
                required
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              />
            </label>
            <label>
              Latitud (numérica)
              <input
                name="branchLatitude"
                type="number"
                step="any"
                value={branchLatitude}
                onChange={(e) => {
                  setBranchLatitude(e.target.value);
                }}
                required
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              />
            </label>
          </div>
          <button type="submit">Crear sucursal</button>
        </form>
        {restaurantId ? (
          <p style={{ marginBottom: 0 }}>
            Restaurante: <code>{restaurantId}</code> · Sucursal: <code>{branchId}</code>
          </p>
        ) : null}
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
        <h2 style={{ marginTop: 0 }}>3. Borrador y cotización</h2>
        <form
          onSubmit={(e) => void handleCreateDraft(e)}
          style={{ display: "grid", gap: "0.75rem" }}
        >
          <label>
            ID de sucursal
            <input
              name="branchId"
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label>
              Valor de la comida (COP)
              <input
                name="foodAmountCop"
                type="number"
                value={foodAmountCop}
                onChange={(e) => {
                  setFoodAmountCop(e.target.value);
                }}
                required
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              />
            </label>
            <label>
              Valor del domicilio (COP)
              <input
                name="deliveryFeeCop"
                type="number"
                value={deliveryFeeCop}
                onChange={(e) => {
                  setDeliveryFeeCop(e.target.value);
                }}
                required
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              />
            </label>
          </div>
          <label>
            Medio de pago
            <select
              name="paymentMethod"
              value={paymentMethod}
              onChange={(e) => {
                setPaymentMethod(e.target.value as "CASH" | "TRANSFER");
              }}
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            >
              <option value="CASH">Efectivo</option>
              <option value="TRANSFER">Transferencia</option>
            </select>
          </label>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button type="button" onClick={() => void handleQuote()}>
              Cotizar domicilio
            </button>
            <button type="submit">Guardar borrador</button>
          </div>
          {quoteSummary ? <p style={{ margin: 0 }}>{quoteSummary}</p> : null}
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
        <h2 style={{ marginTop: 0 }}>4. Publicar pedido</h2>
        <form onSubmit={(e) => void handlePublish(e)} style={{ display: "grid", gap: "0.75rem" }}>
          <label>
            ID del pedido
            <input
              name="orderId"
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Modalidad
            <select
              name="publishMode"
              value={publishMode}
              onChange={(e) => {
                setPublishMode(e.target.value as "OPEN" | "DIRECT");
              }}
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            >
              <option value="OPEN">Abierto (todos en el radio)</option>
              <option value="DIRECT">Directo a un domiciliario</option>
            </select>
          </label>
          {publishMode === "DIRECT" ? (
            <label>
              ID del domiciliario
              <input
                name="courierId"
                value={courierId}
                onChange={(e) => {
                  setCourierId(e.target.value);
                }}
                required
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              />
            </label>
          ) : null}
          <label>
            Nombre del cliente
            <input
              name="customerName"
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Teléfono del cliente
            <input
              name="customerPhone"
              value={customerPhone}
              onChange={(e) => {
                setCustomerPhone(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <label>
            Dirección de entrega
            <input
              name="dropoffAddress"
              value={dropoffAddress}
              onChange={(e) => {
                setDropoffAddress(e.target.value);
              }}
              required
              style={{ display: "block", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label>
              Longitud entrega
              <input
                name="dropoffLongitude"
                type="number"
                step="any"
                value={dropoffLongitude}
                onChange={(e) => {
                  setDropoffLongitude(e.target.value);
                }}
                required
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              />
            </label>
            <label>
              Latitud entrega
              <input
                name="dropoffLatitude"
                type="number"
                step="any"
                value={dropoffLatitude}
                onChange={(e) => {
                  setDropoffLatitude(e.target.value);
                }}
                required
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              />
            </label>
          </div>
          <button type="submit">Publicar pedido</button>
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
        <h2 style={{ marginTop: 0 }}>5. Recorrido del pedido</h2>
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
          <button type="button" onClick={() => void handleRefreshOrder()}>
            Actualizar estado
          </button>
          <button type="button" onClick={() => void handleCreateTrackingLink()}>
            Generar enlace de seguimiento
          </button>
        </div>

        {orderView ? (
          <div data-testid="order-status-panel">
            <p>
              <strong>Estado:</strong> <span data-testid="order-status">{orderView.status}</span>
            </p>
            {orderView.pickupPin ? (
              <p>
                <strong>PIN de recogida:</strong> <code>{orderView.pickupPin}</code>
              </p>
            ) : null}
          </div>
        ) : null}

        {trackingUrl ? (
          <p>
            Enlace público: <a href={trackingUrl}>{trackingUrl}</a>
          </p>
        ) : null}

        {events.length > 0 ? (
          <ul>
            {events.map((ev) => (
              <li key={ev.id}>
                {ev.fromStatus ?? "INICIO"} → {ev.toStatus} ({ev.createdAt})
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
