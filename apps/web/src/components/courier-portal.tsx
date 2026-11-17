"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Bike, Home, MapPin, ShieldCheck, UserCheck } from "lucide-react";
import { callProxy } from "@/lib/api-client";
import {
  clearStoredActiveRole,
  getStoredActiveRole,
  ROLE_BASE_PATH,
  setStoredActiveRole,
} from "@/lib/role-session";
import { RoleAuthCard, type SessionUser } from "./role-auth-card";
import { RolePanelShell, type RoleNavItem } from "./role-panel-shell";

type CourierOrderView = {
  id: string;
  status: string;
  deliveryFeeCop?: number;
  pickupAddress?: string;
  dropoffAddress?: string;
  customerPhone?: string;
};

type CourierContextValue = {
  sessionUser: SessionUser | null;
  statusMessage: string;
  errorMessage: string;
  busyAction: string | null;
  loggingOut: boolean;
  handleLogout: () => Promise<void>;
  // Perfil
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  documentType: string;
  setDocumentType: (v: string) => void;
  documentNumber: string;
  setDocumentNumber: (v: string) => void;
  courierId: string;
  handleCreateProfile: (e: FormEvent) => Promise<void>;
  // Disponibilidad y ubicación
  availability: "AVAILABLE" | "OFFLINE";
  longitude: string;
  latitude: string;
  geoStatus: string;
  handleUseMyLocation: () => void;
  handleAvailability: (nextState: "AVAILABLE" | "OFFLINE") => Promise<void>;
  handleSendLocation: (e: FormEvent) => Promise<void>;
  // Entrega
  offerId: string;
  setOfferId: (v: string) => void;
  orderId: string;
  setOrderId: (v: string) => void;
  pickupPin: string;
  setPickupPin: (v: string) => void;
  deliveryPin: string;
  setDeliveryPin: (v: string) => void;
  orderView: CourierOrderView | null;
  handleAcceptOffer: () => Promise<void>;
  handleDeclineOffer: () => Promise<void>;
  handleLoadOrder: () => Promise<void>;
  handleJourneyStep: (action: "arrive-pickup" | "at-pickup" | "at-dropoff") => Promise<void>;
  handleVerifyPin: (kind: "pickup-pin" | "delivery-pin", pin: string) => Promise<void>;
};

const CourierContext = createContext<CourierContextValue | null>(null);

const COURIER_NAV_ITEMS: RoleNavItem[] = [
  {
    href: "/domiciliario",
    label: "Inicio",
    shortLabel: "Inicio",
    icon: <Home size={18} />,
    testId: "nav-domiciliario-inicio",
  },
  {
    href: "/domiciliario/perfil",
    label: "Mi perfil y documentos",
    shortLabel: "Perfil",
    icon: <UserCheck size={18} />,
    testId: "nav-domiciliario-perfil",
  },
  {
    href: "/domiciliario/ubicacion",
    label: "Disponibilidad y ubicación",
    shortLabel: "Ubicación",
    icon: <MapPin size={18} />,
    testId: "nav-domiciliario-ubicacion",
  },
  {
    href: "/domiciliario/entrega",
    label: "Entrega en curso",
    shortLabel: "Entrega",
    icon: <Bike size={18} />,
    testId: "nav-domiciliario-entrega",
  },
  {
    href: "/domiciliario/cuenta",
    label: "Mi cuenta",
    shortLabel: "Cuenta",
    icon: <ShieldCheck size={18} />,
    testId: "nav-domiciliario-cuenta",
  },
];

export function CourierPortalShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
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
  const [geoStatus, setGeoStatus] = useState<string>(
    "Sin ubicación capturada todavía (Tocancipá por defecto).",
  );

  // Oferta y pedido
  const [offerId, setOfferId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [pickupPin, setPickupPin] = useState("");
  const [deliveryPin, setDeliveryPin] = useState("");
  const [orderView, setOrderView] = useState<CourierOrderView | null>(null);

  useEffect(() => {
    let active = true;
    const storedRole = getStoredActiveRole();
    callProxy<SessionUser>("auth/me", "GET")
      .then((user) => {
        if (!active || !user.id) {
          return;
        }
        if (storedRole && storedRole !== "COURIER") {
          router.replace(ROLE_BASE_PATH[storedRole]);
          return;
        }
        setStoredActiveRole("COURIER");
        setSessionUser(user);
      })
      .catch(() => {
        if (active) {
          setSessionUser(null);
        }
      })
      .finally(() => {
        if (active) {
          setCheckingSession(false);
        }
      });
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!checkingSession && !sessionUser && pathname !== "/domiciliario") {
      router.replace("/domiciliario");
    }
  }, [checkingSession, sessionUser, pathname, router]);

  const handleAuthenticated = useCallback((user: SessionUser) => {
    setStoredActiveRole("COURIER");
    setSessionUser(user);
  }, []);

  const handleLoggedOut = useCallback(() => {
    clearStoredActiveRole();
    setSessionUser(null);
    setCourierId("");
    setOrderView(null);
    setAvailability("OFFLINE");
  }, []);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await callProxy<unknown>("auth/logout", "POST");
    } catch {
      // Limpiamos sesión local aunque falle la revocación remota.
    } finally {
      handleLoggedOut();
      setLoggingOut(false);
      router.replace("/domiciliario");
    }
  }, [handleLoggedOut, router]);

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

  function handleUseMyLocation() {
    setErrorMessage("");
    setStatusMessage("");
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setErrorMessage("Tu navegador no soporta geolocalización.");
      return;
    }
    setBusyAction("geo");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude.toFixed(6);
        const lat = pos.coords.latitude.toFixed(6);
        setLongitude(lng);
        setLatitude(lat);
        setGeoStatus(`Ubicación capturada: ${lat}, ${lng}`);
        setStatusMessage("Ubicación obtenida desde tu dispositivo.");
        setBusyAction(null);
      },
      (err) => {
        setErrorMessage(
          err.code === err.PERMISSION_DENIED
            ? "Permiso de ubicación denegado. Actívalo en tu navegador para compartir tu posición."
            : "No pudimos obtener tu ubicación actual. Verifica el GPS e intenta de nuevo.",
        );
        setBusyAction(null);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
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
      setErrorMessage("Primero selecciona o ingresa un pedido en Opciones avanzadas.");
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
      setErrorMessage("Ingresa el PIN y asegúrate de tener un pedido activo.");
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

  if (checkingSession) {
    return (
      <div className="dg-card">
        <p className="dg-muted" style={{ margin: 0 }}>
          Verificando sesión de domiciliario...
        </p>
      </div>
    );
  }

  if (!sessionUser) {
    if (pathname !== "/domiciliario") {
      return (
        <div className="dg-card">
          <p className="dg-muted" style={{ margin: 0 }}>
            Redirigiendo al acceso de domiciliario...
          </p>
        </div>
      );
    }
    return (
      <div className="dg-stack">
        <div className="dg-card">
          <span className="dg-badge" style={{ marginBottom: "8px" }}>
            Soy domiciliario · Tocancipá
          </span>
          <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.4rem, 3vw, 1.9rem)" }}>
            Tu espacio de domiciliario en DOMIGOO
          </h1>
          <p className="dg-muted" style={{ margin: 0 }}>
            Inicia sesión o regístrate para completar tu perfil, activar tu disponibilidad y
            gestionar tus entregas.
          </p>
        </div>

        <RoleAuthCard
          accountRole="COURIER"
          roleTitle="Acceso de domiciliario"
          roleSubtitle="Ingresa con tu celular (+57...) o correo electrónico para trabajar en Tocancipá."
          identifierPlaceholder="+573001234567"
          sessionUser={sessionUser}
          onAuthenticated={handleAuthenticated}
          onLoggedOut={handleLoggedOut}
        />
      </div>
    );
  }

  return (
    <CourierContext.Provider
      value={{
        sessionUser,
        statusMessage,
        errorMessage,
        busyAction,
        loggingOut,
        handleLogout,
        firstName,
        setFirstName,
        lastName,
        setLastName,
        documentType,
        setDocumentType,
        documentNumber,
        setDocumentNumber,
        courierId,
        handleCreateProfile,
        availability,
        longitude,
        latitude,
        geoStatus,
        handleUseMyLocation,
        handleAvailability,
        handleSendLocation,
        offerId,
        setOfferId,
        orderId,
        setOrderId,
        pickupPin,
        setPickupPin,
        deliveryPin,
        setDeliveryPin,
        orderView,
        handleAcceptOffer,
        handleDeclineOffer,
        handleLoadOrder,
        handleJourneyStep,
        handleVerifyPin,
      }}
    >
      <RolePanelShell
        roleBadge="Domiciliario"
        roleHeading="Portal de Domiciliarios"
        navItems={COURIER_NAV_ITEMS}
        sessionUser={sessionUser}
        onLogout={() => void handleLogout()}
        loggingOut={loggingOut}
      >
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

        {children}
      </RolePanelShell>
    </CourierContext.Provider>
  );
}

function useCourierPortal() {
  const ctx = useContext(CourierContext);
  if (!ctx) {
    throw new Error("useCourierPortal debe usarse dentro de CourierPortalShell");
  }
  return ctx;
}

export function CourierHomeScreen() {
  const { availability, courierId, orderView } = useCourierPortal();

  return (
    <div className="dg-stack" data-testid="domiciliario-home-screen">
      <div className="dg-card">
        <span className="dg-badge" style={{ marginBottom: "8px" }}>
          Inicio · Domiciliario
        </span>
        <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.35rem, 3vw, 1.75rem)" }}>
          Tu jornada en Tocancipá
        </h1>
        <p className="dg-muted" style={{ margin: 0 }}>
          Revisa tu estado operativo, configura tu perfil documental, comparte ubicación y avanza en
          tu entrega actual.
        </p>
        <div className="dg-btn-row" style={{ marginTop: "14px" }}>
          <span className="dg-pill">
            Disponibilidad: {availability === "AVAILABLE" ? "Disponible" : "Desconectado"}
          </span>
          <span className="dg-pill">Perfil: {courierId ? courierId : "Pendiente por crear"}</span>
          {orderView ? (
            <span className="dg-pill">
              Entrega activa: {orderView.id} ({orderView.status})
            </span>
          ) : null}
        </div>
      </div>

      <div className="dg-grid-2">
        <Link href="/domiciliario/perfil" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Mi perfil y documentos</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Registra tus datos básicos y documento para validación administrativa.
          </p>
        </Link>

        <Link href="/domiciliario/ubicacion" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Disponibilidad y ubicación</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Activa tu disponibilidad y reporta tu ubicación GPS en Tocancipá.
          </p>
        </Link>

        <Link href="/domiciliario/entrega" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Entrega en curso</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Avanza paso a paso: en camino, en restaurante, PIN recogida, en cliente y PIN entrega.
          </p>
        </Link>

        <Link href="/domiciliario/cuenta" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Mi cuenta</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Consulta tu sesión, términos para domiciliarios y privacidad.
          </p>
        </Link>
      </div>
    </div>
  );
}

export function CourierPerfilScreen() {
  const {
    sessionUser,
    busyAction,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    documentType,
    setDocumentType,
    documentNumber,
    setDocumentNumber,
    courierId,
    handleCreateProfile,
  } = useCourierPortal();

  return (
    <div className="dg-stack" data-testid="domiciliario-perfil-screen">
      <section className="dg-card" aria-labelledby="courier-profile-title">
        <h1 id="courier-profile-title" style={{ marginBottom: "8px" }}>
          Mi perfil y documentos
        </h1>
        <p className="dg-muted">
          Completa tus datos de identificación para habilitar tu perfil operativo.
        </p>
        <form
          onSubmit={(e) => {
            void handleCreateProfile(e);
          }}
          className="dg-stack"
        >
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
                <option value="CC">Cédula de ciudadanía (CC)</option>
                <option value="CE">Cédula de extranjería (CE)</option>
                <option value="PPT">PPT</option>
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
              {busyAction === "profile" ? "Guardando..." : "Guardar perfil"}
            </button>
            {courierId ? <span className="dg-pill">ID domiciliario: {courierId}</span> : null}
          </div>
        </form>
      </section>
    </div>
  );
}

export function CourierUbicacionScreen() {
  const {
    sessionUser,
    busyAction,
    availability,
    longitude,
    latitude,
    geoStatus,
    handleUseMyLocation,
    handleAvailability,
    handleSendLocation,
  } = useCourierPortal();

  return (
    <div className="dg-stack" data-testid="domiciliario-ubicacion-screen">
      <section className="dg-card" aria-labelledby="courier-availability-title">
        <h1 id="courier-availability-title" style={{ marginBottom: "8px" }}>
          Disponibilidad y ubicación
        </h1>
        <div className="dg-btn-row" style={{ marginBottom: "14px" }}>
          <button
            type="button"
            className="dg-btn"
            disabled={!sessionUser || busyAction === "availability"}
            onClick={() => {
              void handleAvailability("AVAILABLE");
            }}
          >
            Conectarme (Disponible)
          </button>
          <button
            type="button"
            className="dg-btn dg-btn--secondary"
            disabled={!sessionUser || busyAction === "availability"}
            onClick={() => {
              void handleAvailability("OFFLINE");
            }}
          >
            Desconectarme
          </button>
          <span className="dg-pill">
            Estado actual: {availability === "AVAILABLE" ? "Disponible" : "Desconectado"}
          </span>
        </div>

        <form
          onSubmit={(e) => {
            void handleSendLocation(e);
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
              disabled={busyAction === "geo"}
              onClick={handleUseMyLocation}
            >
              {busyAction === "geo" ? "Obteniendo ubicación..." : "Usar mi ubicación"}
            </button>
            <button
              type="submit"
              className="dg-btn"
              disabled={!sessionUser || busyAction === "location"}
            >
              {busyAction === "location" ? "Enviando..." : "Reportar ubicación"}
            </button>
          </div>

          <details className="dg-details">
            <summary>Opciones avanzadas (coordenadas)</summary>
            <div className="dg-grid-2">
              <label className="dg-field" htmlFor="courier-lng">
                <span>Longitud (solo lectura)</span>
                <input
                  id="courier-lng"
                  className="dg-input"
                  type="text"
                  value={longitude}
                  readOnly
                />
              </label>
              <label className="dg-field" htmlFor="courier-lat">
                <span>Latitud (solo lectura)</span>
                <input
                  id="courier-lat"
                  className="dg-input"
                  type="text"
                  value={latitude}
                  readOnly
                />
              </label>
            </div>
          </details>
        </form>
      </section>
    </div>
  );
}

export function CourierEntregaScreen() {
  const {
    sessionUser,
    busyAction,
    offerId,
    setOfferId,
    orderId,
    setOrderId,
    pickupPin,
    setPickupPin,
    deliveryPin,
    setDeliveryPin,
    orderView,
    handleAcceptOffer,
    handleDeclineOffer,
    handleLoadOrder,
    handleJourneyStep,
    handleVerifyPin,
  } = useCourierPortal();

  const status = orderView?.status ?? "";
  const stepIndex =
    status === "DELIVERED"
      ? 5
      : status === "AT_DROPOFF"
        ? 4
        : status === "PICKED_UP"
          ? 3
          : status === "AT_PICKUP"
            ? 2
            : 1;

  return (
    <div className="dg-stack" data-testid="domiciliario-entrega-screen">
      <section className="dg-card" aria-labelledby="courier-delivery-title">
        <h1 id="courier-delivery-title" style={{ marginBottom: "8px" }}>
          Entrega en curso
        </h1>

        <div className="dg-stepper" aria-label="Pasos de entrega">
          <div className={`dg-step-pill ${stepIndex > 1 ? "dg-step-pill--done" : ""}`}>
            1. En camino
          </div>
          <div className={`dg-step-pill ${stepIndex > 2 ? "dg-step-pill--done" : ""}`}>
            2. En restaurante
          </div>
          <div className={`dg-step-pill ${stepIndex > 3 ? "dg-step-pill--done" : ""}`}>
            3. PIN recogida
          </div>
          <div className={`dg-step-pill ${stepIndex > 4 ? "dg-step-pill--done" : ""}`}>
            4. En cliente
          </div>
          <div className={`dg-step-pill ${stepIndex === 5 ? "dg-step-pill--done" : ""}`}>
            5. PIN entrega
          </div>
        </div>

        <div className="dg-stack">
          {orderView ? (
            <div className="dg-alert dg-alert--success" style={{ marginBottom: 0 }}>
              Pedido <strong>{orderView.id}</strong> · Estado: <strong>{orderView.status}</strong>
              {orderView.dropoffAddress ? ` · Entrega: ${orderView.dropoffAddress}` : ""}
            </div>
          ) : (
            <p className="dg-muted" style={{ margin: 0 }}>
              Cuando aceptes un domicilio verás aquí los datos de recogida y entrega.
            </p>
          )}

          <div className="dg-btn-row">
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={!sessionUser || busyAction !== null}
              onClick={() => {
                void handleJourneyStep("arrive-pickup");
              }}
            >
              Voy en camino
            </button>
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={!sessionUser || busyAction !== null}
              onClick={() => {
                void handleJourneyStep("at-pickup");
              }}
            >
              Llegué al restaurante
            </button>
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={!sessionUser || busyAction !== null}
              onClick={() => {
                void handleJourneyStep("at-dropoff");
              }}
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
                onClick={() => {
                  void handleVerifyPin("pickup-pin", pickupPin);
                }}
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
                onClick={() => {
                  void handleVerifyPin("delivery-pin", deliveryPin);
                }}
              >
                Confirmar entrega
              </button>
            </div>
          </div>

          <details className="dg-details">
            <summary>Opciones avanzadas (ID de oferta / pedido)</summary>
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
                    onClick={() => {
                      void handleAcceptOffer();
                    }}
                  >
                    Aceptar oferta
                  </button>
                  <button
                    type="button"
                    className="dg-btn dg-btn--secondary"
                    disabled={!sessionUser || busyAction !== null}
                    onClick={() => {
                      void handleDeclineOffer();
                    }}
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
                    onClick={() => {
                      void handleLoadOrder();
                    }}
                  >
                    Consultar pedido
                  </button>
                </div>
              </div>
            </div>
          </details>
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

export function CourierCuentaScreen() {
  const { sessionUser, handleLogout, loggingOut } = useCourierPortal();

  return (
    <div className="dg-stack" data-testid="domiciliario-cuenta-screen">
      <section className="dg-card" aria-labelledby="courier-account-title">
        <h1 id="courier-account-title" style={{ marginBottom: "6px" }}>
          Mi cuenta de domiciliario
        </h1>
        <p className="dg-muted">
          Sesión activa: <strong>{sessionUser?.email ?? sessionUser?.phoneE164}</strong> (Estado:{" "}
          {sessionUser?.status ?? "ACTIVE"}).
        </p>

        <div className="dg-btn-row" style={{ marginTop: "12px" }}>
          <Link href="/legal/domiciliarios" className="dg-btn dg-btn--secondary">
            Términos Domiciliarios
          </Link>
          <Link href="/legal/privacidad" className="dg-btn dg-btn--secondary">
            Política de Privacidad
          </Link>
          <Link href="/legal/autorizacion" className="dg-btn dg-btn--secondary">
            Autorización de Datos
          </Link>
        </div>

        <div className="dg-btn-row" style={{ marginTop: "16px" }}>
          <button
            type="button"
            className="dg-btn dg-btn--danger"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
          </button>
        </div>
      </section>
    </div>
  );
}
