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
import { ClipboardList, Home, PlusCircle, ShieldCheck, Store } from "lucide-react";
import { callProxy } from "@/lib/api-client";
import type { CreateRestaurantPayload, QuotePayload } from "@/lib/contracts";
import {
  clearStoredActiveRole,
  getStoredActiveRole,
  ROLE_BASE_PATH,
  setStoredActiveRole,
} from "@/lib/role-session";
import { RoleAuthCard, type SessionUser } from "./role-auth-card";
import { RolePanelShell, type RoleNavItem } from "./role-panel-shell";

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

type RestaurantContextValue = {
  appName: string;
  sessionUser: SessionUser | null;
  statusMessage: string;
  errorMessage: string;
  busyAction: string | null;
  loggingOut: boolean;
  handleLogout: () => Promise<void>;
  // Geo
  showGeoConsent: boolean;
  setShowGeoConsent: (v: boolean) => void;
  geoConsentChecked: boolean;
  setGeoConsentChecked: (v: boolean) => void;
  geoConsentId: string | null;
  branchGeoStatus: string;
  dropoffGeoStatus: string;
  requestBrowserLocation: (target: "branch" | "dropoff") => void;
  handleAllowGeoConsent: () => Promise<void>;
  handleRevokeGeoConsent: () => Promise<void>;
  // Branch
  legalName: string;
  setLegalName: (v: string) => void;
  tradeName: string;
  setTradeName: (v: string) => void;
  nit: string;
  setNit: (v: string) => void;
  siteEmail: string;
  setSiteEmail: (v: string) => void;
  sitePhoneE164: string;
  setSitePhoneE164: (v: string) => void;
  establishmentName: string;
  setEstablishmentName: (v: string) => void;
  branchName: string;
  setBranchName: (v: string) => void;
  addressLine: string;
  setAddressLine: (v: string) => void;
  branchLongitude: string;
  branchLatitude: string;
  restaurantId: string;
  branchId: string;
  setBranchId: (v: string) => void;
  handleCreateBranch: (e: FormEvent) => Promise<void>;
  // Order wizard
  foodAmountCop: string;
  setFoodAmountCop: (v: string) => void;
  deliveryFeeCop: string;
  setDeliveryFeeCop: (v: string) => void;
  paymentMethod: "CASH" | "TRANSFER";
  setPaymentMethod: (v: "CASH" | "TRANSFER") => void;
  quoteSummary: string;
  orderId: string;
  setOrderId: (v: string) => void;
  handleQuote: () => Promise<void>;
  handleCreateDraft: (e: FormEvent) => Promise<void>;
  // Publish
  customerName: string;
  setCustomerName: (v: string) => void;
  customerPhone: string;
  setCustomerPhone: (v: string) => void;
  dropoffAddress: string;
  setDropoffAddress: (v: string) => void;
  dropoffLongitude: string;
  dropoffLatitude: string;
  publishMode: "OPEN" | "DIRECT";
  setPublishMode: (v: "OPEN" | "DIRECT") => void;
  courierId: string;
  setCourierId: (v: string) => void;
  handlePublish: (e: FormEvent) => Promise<void>;
  // Tracking
  orderView: OrderView | null;
  events: OrderEvent[];
  trackingUrl: string;
  handleRefreshOrder: () => Promise<void>;
  handleCreateTrackingLink: () => Promise<void>;
};

const RestaurantContext = createContext<RestaurantContextValue | null>(null);

const RESTAURANT_NAV_ITEMS: RoleNavItem[] = [
  {
    href: "/restaurante",
    label: "Inicio",
    shortLabel: "Inicio",
    icon: <Home size={18} />,
    testId: "nav-restaurante-inicio",
  },
  {
    href: "/restaurante/negocio",
    label: "Mi negocio y sucursal",
    shortLabel: "Negocio",
    icon: <Store size={18} />,
    testId: "nav-restaurante-negocio",
  },
  {
    href: "/restaurante/nuevo-domicilio",
    label: "Nuevo domicilio",
    shortLabel: "Nuevo",
    icon: <PlusCircle size={18} />,
    testId: "nav-restaurante-nuevo",
  },
  {
    href: "/restaurante/pedidos",
    label: "Pedidos activos",
    shortLabel: "Pedidos",
    icon: <ClipboardList size={18} />,
    testId: "nav-restaurante-pedidos",
  },
  {
    href: "/restaurante/cuenta",
    label: "Mi cuenta",
    shortLabel: "Cuenta",
    icon: <ShieldCheck size={18} />,
    testId: "nav-restaurante-cuenta",
  },
];

export function RestaurantPortalShell({
  appName,
  children,
}: {
  appName: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  // Geolocalización
  const [showGeoConsent, setShowGeoConsent] = useState(false);
  const [geoConsentChecked, setGeoConsentChecked] = useState(false);
  const [geoConsentId, setGeoConsentId] = useState<string | null>(null);
  const [branchGeoStatus, setBranchGeoStatus] = useState(
    "Coordenadas por defecto: Tocancipá centro.",
  );
  const [dropoffGeoStatus, setDropoffGeoStatus] = useState(
    "Coordenadas por defecto: Tocancipá centro.",
  );

  // Sucursal
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

  // Borrador y cotización
  const [foodAmountCop, setFoodAmountCop] = useState("25000");
  const [deliveryFeeCop, setDeliveryFeeCop] = useState("6000");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [quoteSummary, setQuoteSummary] = useState<string>("");
  const [orderId, setOrderId] = useState("");

  // Publicar
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [dropoffLongitude, setDropoffLongitude] = useState("-73.9180");
  const [dropoffLatitude, setDropoffLatitude] = useState("4.9701");
  const [publishMode, setPublishMode] = useState<"OPEN" | "DIRECT">("OPEN");
  const [courierId, setCourierId] = useState("");

  // Recorrido
  const [orderView, setOrderView] = useState<OrderView | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [trackingUrl, setTrackingUrl] = useState<string>("");

  useEffect(() => {
    let active = true;
    let redirected = false;
    const storedRole = getStoredActiveRole();
    callProxy<SessionUser>("auth/me", "GET")
      .then((user) => {
        if (!active || !user.id) {
          return;
        }
        if (storedRole && storedRole !== "RESTAURANT") {
          redirected = true;
          router.replace(ROLE_BASE_PATH[storedRole]);
          return;
        }
        setStoredActiveRole("RESTAURANT");
        setSessionUser(user);
      })
      .catch(() => {
        if (active) {
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
    if (!checkingSession && !sessionUser && pathname !== "/restaurante") {
      router.replace("/restaurante");
    }
  }, [checkingSession, sessionUser, pathname, router]);

  const handleAuthenticated = useCallback((user: SessionUser) => {
    setStoredActiveRole("RESTAURANT");
    setSessionUser(user);
  }, []);

  const handleLoggedOut = useCallback(() => {
    clearStoredActiveRole();
    setSessionUser(null);
    setOrderView(null);
    setEvents([]);
    setTrackingUrl("");
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
      router.replace("/restaurante");
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

  if (checkingSession) {
    return (
      <div className="dg-card">
        <p className="dg-muted" style={{ margin: 0 }}>
          Verificando sesión de restaurante...
        </p>
      </div>
    );
  }

  if (!sessionUser) {
    if (pathname !== "/restaurante") {
      return (
        <div className="dg-card">
          <p className="dg-muted" style={{ margin: 0 }}>
            Redirigiendo al acceso de restaurante...
          </p>
        </div>
      );
    }
    return (
      <div className="dg-stack">
        <div className="dg-card">
          <span className="dg-badge" style={{ marginBottom: "8px" }}>
            Soy restaurante · Tocancipá
          </span>
          <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.4rem, 3vw, 1.9rem)" }}>
            {appName} — Portal de Restaurantes
          </h1>
          <p className="dg-muted" style={{ margin: 0 }}>
            Inicia sesión o registra tu restaurante para administrar sucursales y domicilios.
          </p>
        </div>

        <RoleAuthCard
          accountRole="RESTAURANT"
          roleTitle="Acceso de restaurante"
          roleSubtitle="Inicia sesión o crea tu cuenta de restaurante con correo o teléfono (+57...)."
          identifierPlaceholder="restaurante@ejemplo.com"
          sessionUser={sessionUser}
          onAuthenticated={handleAuthenticated}
          onLoggedOut={handleLoggedOut}
        />
      </div>
    );
  }

  return (
    <RestaurantContext.Provider
      value={{
        appName,
        sessionUser,
        statusMessage,
        errorMessage,
        busyAction,
        loggingOut,
        handleLogout,
        showGeoConsent,
        setShowGeoConsent,
        geoConsentChecked,
        setGeoConsentChecked,
        geoConsentId,
        branchGeoStatus,
        dropoffGeoStatus,
        requestBrowserLocation,
        handleAllowGeoConsent,
        handleRevokeGeoConsent,
        legalName,
        setLegalName,
        tradeName,
        setTradeName,
        nit,
        setNit,
        siteEmail,
        setSiteEmail,
        sitePhoneE164,
        setSitePhoneE164,
        establishmentName,
        setEstablishmentName,
        branchName,
        setBranchName,
        addressLine,
        setAddressLine,
        branchLongitude,
        branchLatitude,
        restaurantId,
        branchId,
        setBranchId,
        handleCreateBranch,
        foodAmountCop,
        setFoodAmountCop,
        deliveryFeeCop,
        setDeliveryFeeCop,
        paymentMethod,
        setPaymentMethod,
        quoteSummary,
        orderId,
        setOrderId,
        handleQuote,
        handleCreateDraft,
        customerName,
        setCustomerName,
        customerPhone,
        setCustomerPhone,
        dropoffAddress,
        setDropoffAddress,
        dropoffLongitude,
        dropoffLatitude,
        publishMode,
        setPublishMode,
        courierId,
        setCourierId,
        handlePublish,
        orderView,
        events,
        trackingUrl,
        handleRefreshOrder,
        handleCreateTrackingLink,
      }}
    >
      <RolePanelShell
        roleBadge="Restaurante"
        roleHeading={`${appName} — Portal de Restaurantes`}
        navItems={RESTAURANT_NAV_ITEMS}
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
    </RestaurantContext.Provider>
  );
}

function useRestaurantPortal() {
  const ctx = useContext(RestaurantContext);
  if (!ctx) {
    throw new Error("useRestaurantPortal debe usarse dentro de RestaurantPortalShell");
  }
  return ctx;
}

export function RestaurantHomeScreen() {
  const { branchId, orderId, orderView } = useRestaurantPortal();

  return (
    <div className="dg-stack" data-testid="restaurante-home-screen">
      <div className="dg-card">
        <span className="dg-badge" style={{ marginBottom: "8px" }}>
          Inicio · Restaurante
        </span>
        <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.35rem, 3vw, 1.75rem)" }}>
          Resumen de tu operación
        </h1>
        <p className="dg-muted" style={{ margin: 0 }}>
          Configura tu sucursal, crea y publica nuevos domicilios por pasos y consulta el recorrido
          en tiempo real.
        </p>
        <div className="dg-btn-row" style={{ marginTop: "14px" }}>
          <span className="dg-pill">
            Sucursal: {branchId ? branchId : "Pendiente por configurar"}
          </span>
          <span className="dg-pill">
            Pedido activo: {orderId ? `${orderId} (${orderView?.status ?? "—"})` : "Ninguno"}
          </span>
        </div>
      </div>

      <div className="dg-grid-2">
        <Link href="/restaurante/negocio" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Mi negocio y sucursal</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Registra razón social, NIT, establecimiento y ubicación de tu sucursal.
          </p>
        </Link>

        <Link
          href="/restaurante/nuevo-domicilio"
          className="dg-card"
          style={{ textDecoration: "none" }}
        >
          <h2 style={{ marginBottom: "6px" }}>Nuevo domicilio</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Asistente por pasos: cotizar envío, crear borrador y publicar oferta.
          </p>
        </Link>

        <Link href="/restaurante/pedidos" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Pedidos activos y seguimiento</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Consulta estado, PIN de recogida, eventos y genera el enlace público.
          </p>
        </Link>

        <Link href="/restaurante/cuenta" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Mi cuenta</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Revisa tu sesión, permisos de geolocalización y documentos legales.
          </p>
        </Link>
      </div>
    </div>
  );
}

export function RestaurantNegocioScreen() {
  const {
    sessionUser,
    busyAction,
    legalName,
    setLegalName,
    tradeName,
    setTradeName,
    nit,
    setNit,
    siteEmail,
    setSiteEmail,
    sitePhoneE164,
    setSitePhoneE164,
    establishmentName,
    setEstablishmentName,
    branchName,
    setBranchName,
    addressLine,
    setAddressLine,
    branchLongitude,
    branchLatitude,
    branchGeoStatus,
    restaurantId,
    branchId,
    requestBrowserLocation,
    handleCreateBranch,
  } = useRestaurantPortal();

  return (
    <div className="dg-stack" data-testid="restaurante-negocio-screen">
      <section className="dg-card" aria-labelledby="restaurant-branch-title">
        <h1 id="restaurant-branch-title" style={{ marginBottom: "8px" }}>
          Mi negocio y sucursal
        </h1>
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
    </div>
  );
}

export function RestaurantNuevoDomicilioScreen() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const {
    sessionUser,
    busyAction,
    branchId,
    setBranchId,
    foodAmountCop,
    setFoodAmountCop,
    deliveryFeeCop,
    setDeliveryFeeCop,
    paymentMethod,
    setPaymentMethod,
    quoteSummary,
    orderId,
    setOrderId,
    handleQuote,
    handleCreateDraft,
    showGeoConsent,
    setShowGeoConsent,
    geoConsentChecked,
    setGeoConsentChecked,
    geoConsentId,
    dropoffGeoStatus,
    handleAllowGeoConsent,
    handleRevokeGeoConsent,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    dropoffAddress,
    setDropoffAddress,
    dropoffLongitude,
    dropoffLatitude,
    publishMode,
    setPublishMode,
    courierId,
    setCourierId,
    handlePublish,
  } = useRestaurantPortal();

  return (
    <div className="dg-stack" data-testid="restaurante-nuevo-domicilio-screen">
      <div className="dg-card">
        <h1 style={{ marginBottom: "10px" }}>Nuevo domicilio</h1>
        <div className="dg-stepper" role="group" aria-label="Pasos para crear un domicilio">
          <button
            type="button"
            className={`dg-step-pill ${quoteSummary ? "dg-step-pill--done" : ""}`}
            aria-current={step === 1 ? "step" : undefined}
            data-testid="wizard-step-1"
            onClick={() => {
              setStep(1);
            }}
          >
            1. Cotizar
          </button>
          <button
            type="button"
            className={`dg-step-pill ${orderId ? "dg-step-pill--done" : ""}`}
            aria-current={step === 2 ? "step" : undefined}
            data-testid="wizard-step-2"
            onClick={() => {
              setStep(2);
            }}
          >
            2. Borrador
          </button>
          <button
            type="button"
            className="dg-step-pill"
            aria-current={step === 3 ? "step" : undefined}
            data-testid="wizard-step-3"
            onClick={() => {
              setStep(3);
            }}
          >
            3. Publicar
          </button>
        </div>

        {step === 1 ? (
          <div className="dg-stack" data-testid="wizard-panel-1">
            <h2>Paso 1: Cotizar domicilio</h2>
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
                type="button"
                className="dg-btn"
                onClick={() => {
                  setStep(2);
                }}
              >
                Siguiente: Confirmar borrador
              </button>
              {quoteSummary ? <span className="dg-pill">{quoteSummary}</span> : null}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <form
            onSubmit={(e) => {
              void handleCreateDraft(e);
            }}
            className="dg-stack"
            data-testid="wizard-panel-2"
          >
            <h2>Paso 2: Confirmar y crear borrador</h2>
            <div className="dg-grid-2">
              <label className="dg-field" htmlFor="rest-branch-id-step2">
                <span>ID de sucursal</span>
                <input
                  id="rest-branch-id-step2"
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
              <label className="dg-field" htmlFor="rest-delivery-fee-step2">
                <span>Valor del domicilio (COP)</span>
                <input
                  id="rest-delivery-fee-step2"
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
                type="submit"
                className="dg-btn"
                disabled={!sessionUser || busyAction === "draft"}
              >
                {busyAction === "draft" ? "Creando borrador..." : "Crear borrador"}
              </button>
              <button
                type="button"
                className="dg-btn dg-btn--secondary"
                onClick={() => {
                  setStep(3);
                }}
              >
                Siguiente: Publicar domicilio
              </button>
              {orderId ? <span className="dg-pill">Borrador: {orderId}</span> : null}
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <div className="dg-stack" data-testid="wizard-panel-3">
            <h2>Paso 3: Publicar domicilio</h2>
            <div className="dg-btn-row">
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
                style={{ background: "var(--dg-surface-muted)" }}
              >
                <h3>Autorización de geolocalización</h3>
                <p className="dg-muted">
                  Usamos tu ubicación únicamente para ubicar el punto de entrega en Tocancipá.
                  Puedes revocar este permiso en cualquier momento o escribir la dirección
                  manualmente. Consulta la{" "}
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
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RestaurantPedidosScreen() {
  const {
    sessionUser,
    busyAction,
    orderId,
    setOrderId,
    orderView,
    events,
    trackingUrl,
    handleRefreshOrder,
    handleCreateTrackingLink,
  } = useRestaurantPortal();

  return (
    <div className="dg-stack" data-testid="restaurante-pedidos-screen">
      <section className="dg-card" aria-labelledby="restaurant-tracking-title">
        <h1 id="restaurant-tracking-title" style={{ marginBottom: "8px" }}>
          Pedidos activos y seguimiento
        </h1>
        <div className="dg-stack" style={{ marginBottom: "12px" }}>
          <label className="dg-field" htmlFor="rest-pedidos-order-id">
            <span>ID del pedido</span>
            <input
              id="rest-pedidos-order-id"
              className="dg-input"
              type="text"
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value);
              }}
              placeholder="Ej. ord_..."
            />
          </label>
        </div>
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

export function RestaurantCuentaScreen() {
  const { sessionUser, geoConsentId, handleRevokeGeoConsent, handleLogout, loggingOut } =
    useRestaurantPortal();

  return (
    <div className="dg-stack" data-testid="restaurante-cuenta-screen">
      <section className="dg-card" aria-labelledby="restaurant-account-title">
        <h1 id="restaurant-account-title" style={{ marginBottom: "6px" }}>
          Mi cuenta de restaurante
        </h1>
        <p className="dg-muted">
          Sesión activa: <strong>{sessionUser?.email ?? sessionUser?.phoneE164}</strong> (Estado:{" "}
          {sessionUser?.status ?? "ACTIVE"}).
        </p>

        <div className="dg-btn-row" style={{ marginTop: "12px" }}>
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
          <Link href="/legal/restaurantes" className="dg-btn dg-btn--secondary">
            Términos Restaurantes
          </Link>
          <Link href="/legal/privacidad" className="dg-btn dg-btn--secondary">
            Política de Privacidad
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
