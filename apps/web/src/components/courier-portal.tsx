"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Bell, Bike, History, Home, Navigation, UserCheck, Wallet } from "lucide-react";
import { callProxy } from "@/lib/api-client";
import { buildGoogleMapsNavUrl, buildWazeNavUrl, formatCop } from "@/lib/contracts";
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
  referenceCode?: string;
  status: string;
  deliveryFeeCop?: number;
  pickupAddress?: string;
  dropoffAddress?: string;
  customerPhone?: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  createdAt?: string;
};

export type AvailableOfferItem = {
  offerId: string;
  orderId: string;
  referenceCode: string;
  restaurantName: string;
  branchName: string;
  pickupAddress: string;
  dropoffAddress: string;
  deliveryFeeCop: number;
  distanceKm?: number | null;
  etaMinutes?: number | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  expiresAt: string;
};

export type CourierEarningsSummary = {
  deliveredCount: number;
  totalDeliveryFeeCop: number;
  note: string;
  recentDeliveries: Array<{
    id: string;
    referenceCode: string;
    restaurantName: string;
    deliveryFeeCop: number;
    deliveredAt: string | null;
  }>;
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
  locationConsentAccepted: boolean;
  setLocationConsentAccepted: (v: boolean) => void;
  handleUseMyLocation: () => void;
  handleAvailability: (nextState: "AVAILABLE" | "OFFLINE") => Promise<void>;
  handleSendLocation: (e: FormEvent) => Promise<void>;
  // Ofertas, Servicios, Historial y Ganancias
  availableOffers: AvailableOfferItem[];
  loadingOffers: boolean;
  loadAvailableOffers: () => Promise<void>;
  allOrders: CourierOrderView[];
  earnings: CourierEarningsSummary | null;
  loadingEarnings: boolean;
  loadEarnings: () => Promise<void>;
  orderId: string;
  setOrderId: (v: string) => void;
  pickupPin: string;
  setPickupPin: (v: string) => void;
  deliveryPin: string;
  setDeliveryPin: (v: string) => void;
  orderView: CourierOrderView | null;
  handleAcceptOffer: (targetOfferId: string) => Promise<void>;
  handleDeclineOffer: (targetOfferId: string) => Promise<void>;
  loadMyActiveOrder: () => Promise<void>;
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
    href: "/domiciliario/ofertas",
    label: "Ofertas",
    shortLabel: "Ofertas",
    icon: <Bell size={18} />,
    testId: "nav-domiciliario-ofertas",
  },
  {
    href: "/domiciliario/servicios",
    label: "Servicios",
    shortLabel: "Servicios",
    icon: <Bike size={18} />,
    testId: "nav-domiciliario-servicios",
  },
  {
    href: "/domiciliario/historial",
    label: "Historial",
    shortLabel: "Historial",
    icon: <History size={18} />,
    testId: "nav-domiciliario-historial",
  },
  {
    href: "/domiciliario/ganancias",
    label: "Ganancias",
    shortLabel: "Ganancias",
    icon: <Wallet size={18} />,
    testId: "nav-domiciliario-ganancias",
  },
  {
    href: "/domiciliario/perfil",
    label: "Perfil",
    shortLabel: "Perfil",
    icon: <UserCheck size={18} />,
    testId: "nav-domiciliario-perfil",
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
  const [locationConsentAccepted, setLocationConsentAccepted] = useState(false);

  // Oferta, pedido, historial y ganancias
  const [availableOffers, setAvailableOffers] = useState<AvailableOfferItem[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [allOrders, setAllOrders] = useState<CourierOrderView[]>([]);
  const [earnings, setEarnings] = useState<CourierEarningsSummary | null>(null);
  const [loadingEarnings, setLoadingEarnings] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [pickupPin, setPickupPin] = useState("");
  const [deliveryPin, setDeliveryPin] = useState("");
  const [orderView, setOrderView] = useState<CourierOrderView | null>(null);

  useEffect(() => {
    let active = true;
    let redirected = false;
    const storedRole = getStoredActiveRole();
    callProxy<SessionUser>("auth/me", "GET")
      .then((user) => {
        if (!active || !user.id) {
          return;
        }
        if (storedRole && storedRole !== "COURIER") {
          redirected = true;
          router.replace(ROLE_BASE_PATH[storedRole]);
          return;
        }
        setStoredActiveRole("COURIER");
        setSessionUser(user);
      })
      .catch(() => {
        if (active) {
          clearStoredActiveRole();
          setSessionUser(null);
        }
      })
      .finally(() => {
        if (active && !redirected) {
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

  const loadAvailableOffers = useCallback(async () => {
    setLoadingOffers(true);
    try {
      const data = await callProxy<{ offers?: AvailableOfferItem[] }>("offers/available", "GET");
      setAvailableOffers(Array.isArray(data.offers) ? data.offers : []);
    } catch {
      // En mocks parciales o sin perfil aún, mantenemos la lista actual.
    } finally {
      setLoadingOffers(false);
    }
  }, []);

  const loadMyActiveOrder = useCallback(async () => {
    try {
      const data = await callProxy<{ orders?: CourierOrderView[] }>("orders/mine", "GET");
      const list = Array.isArray(data.orders) ? data.orders : [];
      setAllOrders(list);
      const activeOrder =
        list.find(
          (item) =>
            ![
              "DELIVERED",
              "EXPIRED",
              "CANCELLED",
              "CANCELLED_RESTAURANT",
              "CANCELLED_COURIER",
              "CANCELLED_ADMIN",
              "FAILED",
            ].includes(item.status),
        ) ?? list[0];
      if (activeOrder) {
        setOrderId(activeOrder.id);
        setOrderView(activeOrder);
      }
    } catch {
      // Mantiene el estado actual si aún no tiene perfil o falla la consulta.
    }
  }, []);

  const loadEarnings = useCallback(async () => {
    setLoadingEarnings(true);
    try {
      const data = await callProxy<CourierEarningsSummary>("couriers/me/earnings", "GET");
      setEarnings(data);
    } catch {
      // Si aún no tiene perfil de domiciliario, dejamos earnings en null.
    } finally {
      setLoadingEarnings(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionUser) {
      return;
    }
    void loadAvailableOffers();
    void loadMyActiveOrder();
    void loadEarnings();
    const timer = setInterval(() => {
      void loadAvailableOffers();
    }, 10000);
    return () => {
      clearInterval(timer);
    };
  }, [sessionUser, loadAvailableOffers, loadMyActiveOrder, loadEarnings]);

  const handleAuthenticated = useCallback((user: SessionUser) => {
    setStoredActiveRole("COURIER");
    setSessionUser(user);
  }, []);

  const handleLoggedOut = useCallback(() => {
    clearStoredActiveRole();
    setSessionUser(null);
    setCourierId("");
    setAvailableOffers([]);
    setOrderView(null);
    setAvailability("OFFLINE");
  }, []);

  const handleLogout = useCallback(async () => {
    clearStoredActiveRole();
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
    const hasActiveOrder =
      Boolean(orderView) &&
      ![
        "DELIVERED",
        "EXPIRED",
        "CANCELLED",
        "CANCELLED_RESTAURANT",
        "CANCELLED_COURIER",
        "CANCELLED_ADMIN",
        "FAILED",
      ].includes(orderView?.status ?? "");
    if (!hasActiveOrder) {
      setErrorMessage(
        "Solo puedes compartir tu ubicación mientras tengas un servicio activo en curso.",
      );
      return;
    }
    if (!locationConsentAccepted) {
      setErrorMessage(
        "Debes autorizar el envío de ubicación en tiempo real durante el servicio activo.",
      );
      return;
    }
    await runAction("location", async () => {
      await callProxy<{ recorded: true }>("couriers/me/location", "POST", {
        longitude: Number(longitude),
        latitude: Number(latitude),
      });
      setStatusMessage("Ubicación reportada correctamente.");
    });
  }

  async function handleAcceptOffer(targetOfferId: string) {
    if (!targetOfferId.trim()) {
      return;
    }
    await runAction(`accept-${targetOfferId}`, async () => {
      const res = await fetch(
        `/api/proxy/offers/${encodeURIComponent(targetOfferId.trim())}/accept`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `web-${targetOfferId.trim()}-${String(Date.now())}`,
          },
          body: JSON.stringify({}),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        orderId?: string;
        status?: string;
        orderStatus?: string;
      };
      if (!res.ok) {
        if (res.status === 409) {
          setAvailableOffers((prev) => prev.filter((item) => item.offerId !== targetOfferId));
          throw new Error(data.message ?? "Esta oferta ya fue tomada por otro domiciliario.");
        }
        throw new Error(data.message ?? `Error ${String(res.status)}`);
      }
      setAvailableOffers((prev) => prev.filter((item) => item.offerId !== targetOfferId));
      if (data.orderId) {
        setOrderId(data.orderId);
        try {
          const loaded = await callProxy<CourierOrderView>(
            `orders/${encodeURIComponent(data.orderId)}`,
            "GET",
          );
          setOrderView(loaded);
        } catch {
          setOrderView({
            id: data.orderId,
            status: data.orderStatus ?? data.status ?? "ACCEPTED",
          });
        }
      }
      setStatusMessage(`Oferta aceptada (${data.orderStatus ?? data.status ?? "ACCEPTED"}).`);
      router.push("/domiciliario/entrega");
    });
  }

  async function handleDeclineOffer(targetOfferId: string) {
    if (!targetOfferId.trim()) {
      return;
    }
    await runAction(`decline-${targetOfferId}`, async () => {
      const data = await callProxy<{ status: string }>(
        `offers/${encodeURIComponent(targetOfferId.trim())}/decline`,
        "POST",
        {},
      );
      setAvailableOffers((prev) => prev.filter((item) => item.offerId !== targetOfferId));
      setStatusMessage(`Oferta rechazada (${data.status}).`);
    });
  }

  async function handleJourneyStep(action: "arrive-pickup" | "at-pickup" | "at-dropoff") {
    if (!orderId.trim()) {
      setErrorMessage("Primero acepta una oferta disponible para tener un pedido activo.");
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
      if (kind === "delivery-pin") {
        void loadEarnings();
        void loadMyActiveOrder();
      }
    });
  }

  const navItemsWithBadge = useMemo(
    () =>
      COURIER_NAV_ITEMS.map((item) =>
        item.href === "/domiciliario/ofertas" ? { ...item, badge: availableOffers.length } : item,
      ),
    [availableOffers.length],
  );

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
        locationConsentAccepted,
        setLocationConsentAccepted,
        handleUseMyLocation,
        handleAvailability,
        handleSendLocation,
        availableOffers,
        loadingOffers,
        loadAvailableOffers,
        allOrders,
        earnings,
        loadingEarnings,
        loadEarnings,
        orderId,
        setOrderId,
        pickupPin,
        setPickupPin,
        deliveryPin,
        setDeliveryPin,
        orderView,
        handleAcceptOffer,
        handleDeclineOffer,
        loadMyActiveOrder,
        handleJourneyStep,
        handleVerifyPin,
      }}
    >
      <RolePanelShell
        roleBadge="Domiciliario"
        roleHeading="Portal de Domiciliarios"
        navItems={navItemsWithBadge}
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

function CourierAvailableOffersSection() {
  const {
    sessionUser,
    busyAction,
    availableOffers,
    loadingOffers,
    loadAvailableOffers,
    handleAcceptOffer,
    handleDeclineOffer,
  } = useCourierPortal();

  return (
    <section
      className="dg-card"
      aria-labelledby="courier-offers-title"
      data-testid="courier-offers-section"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "12px",
        }}
      >
        <div>
          <h2 id="courier-offers-title" style={{ margin: 0 }}>
            Ofertas disponibles
          </h2>
          <p className="dg-muted" style={{ margin: "4px 0 0", fontSize: "0.875rem" }}>
            Actualización automática cada 10 s.
          </p>
        </div>
        <button
          type="button"
          className="dg-btn dg-btn--secondary"
          data-testid="courier-refresh-offers"
          disabled={!sessionUser || loadingOffers}
          onClick={() => {
            void loadAvailableOffers();
          }}
        >
          {loadingOffers ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {availableOffers.length === 0 ? (
        <div
          className="dg-alert dg-alert--info"
          data-testid="courier-no-offers"
          style={{ margin: 0 }}
        >
          No hay ofertas disponibles por ahora. Activa tu disponibilidad para recibir solicitudes.
        </div>
      ) : (
        <div className="dg-stack" style={{ gap: "12px" }}>
          {availableOffers.map((offer) => (
            <article
              key={offer.offerId}
              className="dg-card dg-request-card"
              data-testid={`courier-offer-card-${offer.offerId}`}
              style={{
                padding: "16px",
                borderColor: "rgba(121, 213, 208, 0.45)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div className="dg-stack" style={{ gap: "4px" }}>
                  <strong style={{ fontSize: "1.05rem" }}>
                    {offer.restaurantName}
                    {offer.branchName ? ` · ${offer.branchName}` : ""}
                  </strong>
                  <span className="dg-muted">Retiro: {offer.pickupAddress}</span>
                  <span className="dg-muted">
                    Entrega: {offer.dropoffAddress || "Por confirmar"}
                  </span>
                  <div className="dg-btn-row" style={{ marginTop: "4px", gap: "8px" }}>
                    {offer.distanceKm != null ? (
                      <span className="dg-pill">Distancia: {offer.distanceKm.toFixed(1)} km</span>
                    ) : null}
                    {offer.etaMinutes != null ? (
                      <span className="dg-pill">ETA aprox: {offer.etaMinutes} min</span>
                    ) : null}
                  </div>
                </div>
                <span className="dg-pill" style={{ fontWeight: 700 }}>
                  {formatCop(offer.deliveryFeeCop)}
                </span>
              </div>
              <div className="dg-btn-row" style={{ marginTop: "12px" }}>
                <button
                  type="button"
                  className="dg-btn"
                  data-testid={`courier-accept-offer-${offer.offerId}`}
                  disabled={!sessionUser || busyAction !== null}
                  onClick={() => {
                    void handleAcceptOffer(offer.offerId);
                  }}
                >
                  {busyAction === `accept-${offer.offerId}` ? "Aceptando..." : "Aceptar oferta"}
                </button>
                <button
                  type="button"
                  className="dg-btn dg-btn--secondary"
                  data-testid={`courier-decline-offer-${offer.offerId}`}
                  disabled={!sessionUser || busyAction !== null}
                  onClick={() => {
                    void handleDeclineOffer(offer.offerId);
                  }}
                >
                  {busyAction === `decline-${offer.offerId}` ? "Rechazando..." : "Rechazar"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function CourierHomeScreen() {
  const {
    sessionUser,
    busyAction,
    availability,
    handleAvailability,
    availableOffers,
    orderView,
    earnings,
  } = useCourierPortal();

  return (
    <div className="dg-stack" data-testid="domiciliario-home-screen">
      <div className="dg-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <span className="dg-badge" style={{ marginBottom: "8px" }}>
              Inicio · Domiciliario
            </span>
            <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.35rem, 3vw, 1.75rem)" }}>
              Tu jornada en Tocancipá
            </h1>
          </div>
          <div className="dg-btn-row">
            <button
              type="button"
              className={availability === "AVAILABLE" ? "dg-btn" : "dg-btn dg-btn--secondary"}
              disabled={!sessionUser || busyAction === "availability"}
              onClick={() => {
                void handleAvailability(availability === "AVAILABLE" ? "OFFLINE" : "AVAILABLE");
              }}
              data-testid="courier-availability-toggle"
            >
              {availability === "AVAILABLE"
                ? "Disponible (clic para desconectar)"
                : "Desconectado (activar)"}
            </button>
          </div>
        </div>

        <div className="dg-kpi-grid" style={{ marginTop: "14px" }}>
          <div className="dg-kpi-card">
            <span className="dg-kpi-label">Estado</span>
            <strong className="dg-kpi-value">
              {availability === "AVAILABLE" ? "Disponible" : "Desconectado"}
            </strong>
          </div>
          <div className="dg-kpi-card">
            <span className="dg-kpi-label">Ofertas activas</span>
            <strong className="dg-kpi-value">{availableOffers.length}</strong>
          </div>
          <div className="dg-kpi-card">
            <span className="dg-kpi-label">Entregas completadas</span>
            <strong className="dg-kpi-value">{earnings ? earnings.deliveredCount : "—"}</strong>
          </div>
        </div>

        {orderView ? (
          <div
            className="dg-alert dg-alert--success"
            style={{ marginTop: "12px", marginBottom: 0 }}
          >
            Servicio activo: <strong>{orderView.id}</strong> ({orderView.status}){" "}
            <Link href="/domiciliario/servicios" className="dg-footer-link">
              Ir a servicios
            </Link>
          </div>
        ) : null}
      </div>

      <CourierAvailableOffersSection />

      <div className="dg-grid-2">
        <Link
          href="/domiciliario/servicios"
          className="dg-card dg-action-card"
          style={{ textDecoration: "none" }}
        >
          <h2 style={{ marginBottom: "6px" }}>Servicios y navegación</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Abre Google Maps o Waze, valida PIN de recogida/entrega y comparte ubicación.
          </p>
        </Link>

        <Link
          href="/domiciliario/ganancias"
          className="dg-card dg-action-card"
          style={{ textDecoration: "none" }}
        >
          <h2 style={{ marginBottom: "6px" }}>Ganancias (informativo)</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Resumen de tus domicilios entregados con pago directo del cliente.
          </p>
        </Link>
      </div>
    </div>
  );
}

export function CourierOfertasScreen() {
  const { sessionUser, busyAction, availability, handleAvailability } = useCourierPortal();

  return (
    <div className="dg-stack" data-testid="domiciliario-ofertas-screen">
      <section className="dg-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>Ofertas disponibles</h1>
            <p className="dg-muted" style={{ margin: "4px 0 0" }}>
              Acepta una oferta antes de que otro domiciliario la tome.
            </p>
          </div>
          <button
            type="button"
            className={availability === "AVAILABLE" ? "dg-btn" : "dg-btn dg-btn--secondary"}
            disabled={!sessionUser || busyAction === "availability"}
            onClick={() => {
              void handleAvailability(availability === "AVAILABLE" ? "OFFLINE" : "AVAILABLE");
            }}
          >
            {availability === "AVAILABLE" ? "Disponible" : "Desconectado"}
          </button>
        </div>
      </section>
      <CourierAvailableOffersSection />
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
    locationConsentAccepted,
    setLocationConsentAccepted,
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
          <p className="dg-muted" style={{ margin: 0, fontSize: "0.875rem" }}>
            Por privacidad, tu ubicación solo se comparte mientras tengas un servicio activo en
            curso y hayas autorizado el permiso.
          </p>
          <label className="dg-check-row">
            <input
              type="checkbox"
              checked={locationConsentAccepted}
              onChange={(e) => {
                setLocationConsentAccepted(e.target.checked);
              }}
              data-testid="courier-location-consent"
            />
            <span>
              Autorizo compartir mi ubicación durante este servicio activo para seguimiento en vivo.
            </span>
          </label>
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
    pickupPin,
    setPickupPin,
    deliveryPin,
    setDeliveryPin,
    orderView,
    loadMyActiveOrder,
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

  const navLat =
    status === "PICKED_UP" || status === "AT_DROPOFF"
      ? (orderView?.dropoffLat ?? 4.966)
      : (orderView?.pickupLat ?? 4.9652);
  const navLng =
    status === "PICKED_UP" || status === "AT_DROPOFF"
      ? (orderView?.dropoffLng ?? -73.918)
      : (orderView?.pickupLng ?? -73.9125);

  const googleMapsUrl = buildGoogleMapsNavUrl(navLat, navLng);
  const wazeUrl = buildWazeNavUrl(navLat, navLng);

  return (
    <div className="dg-stack" data-testid="domiciliario-entrega-screen">
      {!orderView ? <CourierAvailableOffersSection /> : null}

      <section className="dg-card" aria-labelledby="courier-delivery-title">
        <h1 id="courier-delivery-title" style={{ marginBottom: "8px" }}>
          Servicio en curso
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
              Solicitud <strong>{orderView.id}</strong> · Estado:{" "}
              <strong>{orderView.status}</strong>
              {orderView.pickupAddress ? ` · Retiro: ${orderView.pickupAddress}` : ""}
              {orderView.dropoffAddress ? ` · Entrega: ${orderView.dropoffAddress}` : ""}
            </div>
          ) : (
            <p className="dg-muted" style={{ margin: 0 }}>
              Acepta una oferta disponible para iniciar tu servicio paso a paso.
            </p>
          )}

          {orderView && status !== "DELIVERED" ? (
            <div className="dg-btn-row">
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="dg-btn dg-btn--secondary"
              >
                <Navigation size={16} />
                Navegar en Google Maps
              </a>
              <a
                href={wazeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="dg-btn dg-btn--secondary"
              >
                <Navigation size={16} />
                Navegar en Waze
              </a>
            </div>
          ) : null}

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

          <div className="dg-btn-row">
            <button
              type="button"
              className="dg-btn dg-btn--secondary"
              disabled={!sessionUser || busyAction !== null}
              onClick={() => {
                void loadMyActiveOrder();
              }}
            >
              Actualizar servicio activo
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function CourierServiciosScreen() {
  return (
    <div className="dg-stack" data-testid="domiciliario-servicios-screen">
      <CourierEntregaScreen />
      <CourierUbicacionScreen />
    </div>
  );
}

export function CourierHistorialScreen() {
  const { allOrders, loadMyActiveOrder } = useCourierPortal();
  const completed = allOrders.filter(
    (o) => o.status === "DELIVERED" || o.status.startsWith("CANCELLED") || o.status === "EXPIRED",
  );

  return (
    <div className="dg-stack" data-testid="domiciliario-historial-screen">
      <section className="dg-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            marginBottom: "12px",
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ margin: 0 }}>Historial de servicios</h1>
          <button
            type="button"
            className="dg-btn dg-btn--secondary"
            onClick={() => void loadMyActiveOrder()}
          >
            Actualizar
          </button>
        </div>

        {completed.length === 0 ? (
          <p className="dg-muted" style={{ margin: 0 }}>
            Aún no tienes servicios finalizados en tu historial.
          </p>
        ) : (
          <div className="dg-stack">
            {completed.map((item) => (
              <article key={item.id} className="dg-card" style={{ margin: 0, padding: "14px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <strong>{item.referenceCode ? `#S-${item.referenceCode}` : item.id}</strong>
                  <span className="dg-pill">{item.status}</span>
                </div>
                <p className="dg-muted" style={{ margin: "6px 0 0" }}>
                  {item.dropoffAddress ? `Entrega: ${item.dropoffAddress} · ` : ""}
                  {item.deliveryFeeCop != null
                    ? `Domicilio: ${formatCop(item.deliveryFeeCop)}`
                    : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function CourierGananciasScreen() {
  const { earnings, loadingEarnings, loadEarnings } = useCourierPortal();

  return (
    <div className="dg-stack" data-testid="domiciliario-ganancias-screen">
      <section className="dg-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            marginBottom: "12px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <span className="dg-badge" style={{ marginBottom: "6px" }}>
              Resumen informativo
            </span>
            <h1 style={{ margin: 0 }}>Ganancias por domicilios</h1>
          </div>
          <button
            type="button"
            className="dg-btn dg-btn--secondary"
            disabled={loadingEarnings}
            onClick={() => void loadEarnings()}
          >
            {loadingEarnings ? "Actualizando..." : "Actualizar"}
          </button>
        </div>

        <div className="dg-alert dg-alert--info" style={{ marginBottom: "14px" }}>
          {earnings?.note ??
            "Pago directo del cliente, DOMIGOO no recauda dinero ni cobra comisiones."}
        </div>

        <div className="dg-kpi-grid">
          <div className="dg-kpi-card">
            <span className="dg-kpi-label">Domicilios entregados</span>
            <strong className="dg-kpi-value" data-testid="earnings-delivered-count">
              {earnings ? earnings.deliveredCount : 0}
            </strong>
          </div>
          <div className="dg-kpi-card">
            <span className="dg-kpi-label">Total informativo</span>
            <strong className="dg-kpi-value" data-testid="earnings-total-cop">
              {earnings ? formatCop(earnings.totalDeliveryFeeCop) : "$0 COP"}
            </strong>
          </div>
        </div>

        {earnings && earnings.recentDeliveries.length > 0 ? (
          <div className="dg-stack" style={{ marginTop: "14px" }}>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Entregas recientes</h2>
            {earnings.recentDeliveries.map((item) => (
              <article key={item.id} className="dg-card" style={{ margin: 0, padding: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <strong>
                    #S-{item.referenceCode} · {item.restaurantName}
                  </strong>
                  <span className="dg-pill">{formatCop(item.deliveryFeeCop)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="dg-muted" style={{ margin: "12px 0 0" }}>
            Aún no registras entregas completadas.
          </p>
        )}
      </section>
    </div>
  );
}

export function CourierCuentaScreen() {
  const { sessionUser } = useCourierPortal();

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
      </section>
    </div>
  );
}
