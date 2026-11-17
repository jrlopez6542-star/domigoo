"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  buildLoginPayload,
  type CreateRestaurantPayload,
  type QuotePayload,
} from "@/lib/contracts";

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

  // 1. Ingreso y registro (correo o teléfono E.164)
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [registerRole, setRegisterRole] = useState<"RESTAURANT" | "CUSTOMER" | "COURIER">(
    "RESTAURANT",
  );
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [sensitiveDataAccepted, setSensitiveDataAccepted] = useState(false);
  const [marketingAccepted, setMarketingAccepted] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  // Geolocalización (clientes / dirección de entrega)
  const [showGeoConsent, setShowGeoConsent] = useState(false);
  const [geoConsentChecked, setGeoConsentChecked] = useState(false);
  const [geoConsentId, setGeoConsentId] = useState<string | null>(null);
  const [geoRevokedMessage, setGeoRevokedMessage] = useState<string>("");

  // 2. Restaurante, establecimiento y sucursal
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [nit, setNit] = useState("");
  const [siteEmail, setSiteEmail] = useState("");
  const [sitePhoneE164, setSitePhoneE164] = useState("");
  const [establishmentName, setEstablishmentName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [addressLine, setAddressLine] = useState("");
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
      const payload = buildLoginPayload(identifier, password, "WEB");
      const data = await callProxy<{ id?: string; user?: { id: string } }>(
        "auth/login",
        "POST",
        payload,
      );
      setSessionUserId(data.id ?? data.user?.id ?? "activo");
      setStatusMessage("Sesión iniciada correctamente.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    if (!termsAccepted || !privacyAccepted) {
      setErrorMessage(
        "Debes aceptar los Términos y Condiciones y la Autorización de Tratamiento de Datos Personales.",
      );
      return;
    }
    if (registerRole === "COURIER" && !sensitiveDataAccepted) {
      setErrorMessage(
        "Los domiciliarios deben autorizar el tratamiento de datos sensibles para verificar su identidad.",
      );
      return;
    }
    try {
      const base = buildLoginPayload(identifier, password, "WEB");
      const data = await callProxy<{ id?: string; legalVersion?: string }>(
        "auth/register",
        "POST",
        {
          ...base,
          role: registerRole,
          consents: {
            version: "0.1-borrador",
            termsAccepted,
            privacyAccepted,
            sensitiveDataAccepted,
            marketingAccepted,
          },
        },
      );
      setSessionUserId(data.id ?? "activo");
      setStatusMessage(
        `Cuenta registrada con consentimiento guardado (versión ${data.legalVersion ?? "0.1-borrador"}).`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo registrar la cuenta.");
    }
  }

  async function handlePermitGeolocation() {
    setErrorMessage("");
    setGeoRevokedMessage("");
    if (!geoConsentChecked) {
      setErrorMessage(
        "Marca la casilla de autorización de ubicación antes de permitir el acceso al GPS.",
      );
      return;
    }
    try {
      if (sessionUserId) {
        const docs = await callProxy<{
          documents: Array<{ id: string; kind: string }>;
        }>("legal-documents/current", "GET");
        const geoDoc = docs.documents.find((d) => d.kind === "GEOLOCATION_CONSENT");
        if (geoDoc) {
          const consent = await callProxy<{ id: string }>("consents", "POST", {
            legalDocumentId: geoDoc.id,
            purpose: "GEOLOCATION",
            channel: "WEB",
          });
          setGeoConsentId(consent.id);
        }
      }
      if (typeof navigator !== "undefined" && "geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setDropoffLatitude(pos.coords.latitude.toFixed(6));
            setDropoffLongitude(pos.coords.longitude.toFixed(6));
            setShowGeoConsent(false);
            setStatusMessage("Ubicación obtenida y consentimiento de geolocalización registrado.");
          },
          () => {
            setShowGeoConsent(false);
            setStatusMessage(
              "No se pudo obtener la ubicación del navegador; puedes escribir tu dirección manualmente.",
            );
          },
        );
      } else {
        setShowGeoConsent(false);
        setStatusMessage("Consentimiento registrado. Puedes escribir tu dirección manualmente.");
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudo registrar el consentimiento de ubicación.",
      );
    }
  }

  async function handleRevokeGeolocation() {
    setErrorMessage("");
    try {
      if (geoConsentId) {
        await callProxy("consents/" + geoConsentId + "/revoke", "POST");
      }
      setGeoConsentId(null);
      setGeoConsentChecked(false);
      setGeoRevokedMessage(
        "Ubicación desactivada. DOMIGOO dejó de recibir la ubicación de este dispositivo. Los datos ya recogidos se conservarán solo durante los plazos de la Política de Tratamiento de Datos. Puedes volver a activarla cuando quieras.",
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudo revocar el consentimiento de ubicación.",
      );
    }
  }

  async function handleCreateBranch(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
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
      const data = await callProxy<{
        id: string;
        branchId: string;
      }>("restaurants", "POST", payload);
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <h2 style={{ margin: 0 }}>1. Ingreso del restaurante</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
              }}
              style={{ fontWeight: authMode === "login" ? 700 : 400 }}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              data-testid="tab-register"
              onClick={() => {
                setAuthMode("register");
              }}
              style={{ fontWeight: authMode === "register" ? 700 : 400 }}
            >
              Crear cuenta
            </button>
          </div>
        </div>
        {sessionUserId ? <p data-testid="session-active">Sesión activa: {sessionUserId}</p> : null}
        <form
          onSubmit={(e) => {
            if (authMode === "register") {
              void handleRegister(e);
            } else {
              void handleLogin(e);
            }
          }}
          style={{ display: "grid", gap: "0.75rem" }}
        >
          {authMode === "register" ? (
            <label>
              Perfil de cuenta
              <select
                name="registerRole"
                value={registerRole}
                onChange={(e) => {
                  setRegisterRole(e.target.value as "RESTAURANT" | "CUSTOMER" | "COURIER");
                }}
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              >
                <option value="RESTAURANT">Restaurante</option>
                <option value="CUSTOMER">Cliente</option>
                <option value="COURIER">Domiciliario independiente</option>
              </select>
            </label>
          ) : null}
          <label>
            Correo o teléfono (+57...)
            <input
              name="identifier"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
              }}
              placeholder="restaurante@ejemplo.com o +573001112233"
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
          {authMode === "register" ? (
            <div
              data-testid="register-consents"
              style={{
                display: "grid",
                gap: "0.6rem",
                padding: "0.75rem",
                backgroundColor: "#f8fafc",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                fontSize: "0.9rem",
              }}
            >
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  name="termsAccepted"
                  checked={termsAccepted}
                  onChange={(e) => {
                    setTermsAccepted(e.target.checked);
                  }}
                />
                <span>
                  Soy mayor de 18 años y acepto los{" "}
                  <Link
                    href="/legal/terminos"
                    style={{ color: "#1d4ed8", textDecoration: "underline" }}
                  >
                    Términos y Condiciones
                  </Link>{" "}
                  de DOMIGOO. (Obligatoria)
                </span>
              </label>

              <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  name="privacyAccepted"
                  checked={privacyAccepted}
                  onChange={(e) => {
                    setPrivacyAccepted(e.target.checked);
                  }}
                />
                <span>
                  Autorizo a DOMIGOO a tratar mis datos personales para crear mi cuenta, gestionar
                  pedidos y entregas, atender PQR y cumplir la ley, y a transmitirlos a sus
                  proveedores de nube en Estados Unidos, según la{" "}
                  <Link
                    href="/legal/privacidad"
                    style={{ color: "#1d4ed8", textDecoration: "underline" }}
                  >
                    Política de Tratamiento de Datos
                  </Link>
                  .{" "}
                  <Link
                    href="/legal/autorizacion"
                    style={{ color: "#1d4ed8", textDecoration: "underline" }}
                  >
                    Ver autorización completa
                  </Link>{" "}
                  (Obligatoria)
                </span>
              </label>

              {registerRole === "COURIER" ? (
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    name="sensitiveDataAccepted"
                    checked={sensitiveDataAccepted}
                    onChange={(e) => {
                      setSensitiveDataAccepted(e.target.checked);
                    }}
                  />
                  <span>
                    Autorizo de forma explícita el tratamiento de mis datos sensibles (fotografía e
                    imagen de mi documento de identidad) para verificar mi identidad y requisitos
                    como domiciliario. Sé que no estoy obligado a autorizarlo, pero sin esta
                    verificación no se puede habilitar mi cuenta. (Obligatoria para domiciliarios)
                  </span>
                </label>
              ) : null}

              <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  name="marketingAccepted"
                  checked={marketingAccepted}
                  onChange={(e) => {
                    setMarketingAccepted(e.target.checked);
                  }}
                />
                <span>
                  Quiero recibir promociones y novedades de DOMIGOO por correo, SMS o
                  notificaciones. Puedo retirarme cuando quiera. (Opcional)
                </span>
              </label>
            </div>
          ) : null}
          <button type="submit">{authMode === "register" ? "Registrarme" : "Entrar"}</button>
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
          onSubmit={(e) => {
            void handleCreateBranch(e);
          }}
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label>
              Correo de contacto
              <input
                name="email"
                type="email"
                value={siteEmail}
                onChange={(e) => {
                  setSiteEmail(e.target.value);
                }}
                required
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              />
            </label>
            <label>
              Teléfono de contacto (+57...)
              <input
                name="phoneE164"
                value={sitePhoneE164}
                onChange={(e) => {
                  setSitePhoneE164(e.target.value);
                }}
                placeholder="+573001112233"
                required
                style={{ display: "block", width: "100%", padding: "0.5rem" }}
              />
            </label>
          </div>
          <label>
            Nombre del establecimiento
            <input
              name="establishmentName"
              value={establishmentName}
              onChange={(e) => {
                setEstablishmentName(e.target.value);
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
              name="addressLine"
              value={addressLine}
              onChange={(e) => {
                setAddressLine(e.target.value);
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
          onSubmit={(e) => {
            void handleCreateDraft(e);
          }}
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
            <button
              type="button"
              onClick={() => {
                void handleQuote();
              }}
            >
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
        <form
          onSubmit={(e) => {
            void handlePublish(e);
          }}
          style={{ display: "grid", gap: "0.75rem" }}
        >
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <button
              type="button"
              data-testid="open-geo-consent"
              onClick={() => {
                setShowGeoConsent((prev) => !prev);
              }}
            >
              Usar mi ubicación actual
            </button>
            {geoConsentId ? (
              <button
                type="button"
                data-testid="revoke-geo-consent"
                onClick={() => {
                  void handleRevokeGeolocation();
                }}
              >
                Revocar permiso de ubicación
              </button>
            ) : null}
          </div>
          {geoRevokedMessage ? (
            <p
              data-testid="geo-revoked-notice"
              style={{
                margin: 0,
                padding: "0.65rem",
                backgroundColor: "#f8fafc",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "0.88rem",
              }}
            >
              {geoRevokedMessage}
            </p>
          ) : null}
          {showGeoConsent ? (
            <div
              data-testid="geo-consent-screen"
              style={{
                padding: "1rem",
                backgroundColor: "#f8fafc",
                border: "1px solid #94a3b8",
                borderRadius: "8px",
                display: "grid",
                gap: "0.65rem",
                fontSize: "0.9rem",
              }}
            >
              <strong>¿Usar tu ubicación para tu dirección de entrega?</strong>
              <p style={{ margin: 0 }}>
                Si lo permites, usaremos la ubicación de tu dispositivo solo cuando estás agregando
                o confirmando una dirección para ubicarla en el mapa y confirmar cobertura. No
                seguimos tu ubicación en segundo plano. Si eliges &quot;Escribir dirección
                manualmente&quot;, puedes continuar normalmente. Más información en la{" "}
                <Link
                  href="/legal/privacidad"
                  style={{ color: "#1d4ed8", textDecoration: "underline" }}
                >
                  Política de Tratamiento de Datos
                </Link>
                .
              </p>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  name="geoConsentChecked"
                  checked={geoConsentChecked}
                  onChange={(e) => {
                    setGeoConsentChecked(e.target.checked);
                  }}
                />
                <span>
                  Autorizo a DOMIGOO a usar la ubicación de mi dispositivo para los fines indicados.
                </span>
              </label>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  data-testid="geo-consent-allow"
                  onClick={() => {
                    void handlePermitGeolocation();
                  }}
                >
                  Permitir
                </button>
                <button
                  type="button"
                  data-testid="geo-consent-manual"
                  onClick={() => {
                    setShowGeoConsent(false);
                    setStatusMessage("Modo de dirección manual activo.");
                  }}
                >
                  Escribir dirección manualmente
                </button>
              </div>
            </div>
          ) : null}
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
          <button
            type="button"
            onClick={() => {
              void handleRefreshOrder();
            }}
          >
            Actualizar estado
          </button>
          <button
            type="button"
            onClick={() => {
              void handleCreateTrackingLink();
            }}
          >
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
