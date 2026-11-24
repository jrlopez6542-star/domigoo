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
import { Calculator, Home, MapPin, ShieldCheck, UtensilsCrossed } from "lucide-react";
import { callProxy, extractTrackingToken } from "@/lib/api-client";
import type { QuotePayload } from "@/lib/contracts";
import {
  clearStoredActiveRole,
  getStoredActiveRole,
  ROLE_BASE_PATH,
  setStoredActiveRole,
} from "@/lib/role-session";
import { RoleAuthCard, type SessionUser } from "./role-auth-card";
import { RolePanelShell, type RoleNavItem } from "./role-panel-shell";

type PublicTrackingSummary = {
  status: string;
  pickupLabel?: string;
  dropoffLabel?: string;
  deliveryPin?: string;
};

type ClientPortalContextValue = {
  sessionUser: SessionUser | null;
  checkingSession: boolean;
  trackingInput: string;
  setTrackingInput: (val: string) => void;
  trackingLoading: boolean;
  trackingError: string;
  trackingPreview: PublicTrackingSummary | null;
  handleLookupTracking: (e: FormEvent) => Promise<void>;
  handleOpenTrackingPage: () => void;
  originLng: string;
  originLat: string;
  destLng: string;
  destLat: string;
  geoLoading: boolean;
  geoStatus: string;
  quoteLoading: boolean;
  quoteError: string;
  quoteText: string;
  handleUseMyLocation: () => void;
  handleEstimateDelivery: (e: FormEvent) => Promise<void>;
  handleLogout: () => Promise<void>;
  loggingOut: boolean;
};

const ClientPortalContext = createContext<ClientPortalContextValue | null>(null);

const CLIENT_NAV_ITEMS: RoleNavItem[] = [
  {
    href: "/cliente",
    label: "Inicio",
    shortLabel: "Inicio",
    icon: <Home size={18} />,
    testId: "nav-cliente-inicio",
  },
  {
    href: "/cliente/pedir",
    label: "Pedir comida",
    shortLabel: "Pedir",
    icon: <UtensilsCrossed size={18} />,
    testId: "nav-cliente-pedir",
  },
  {
    href: "/cliente/seguir",
    label: "Seguir pedido",
    shortLabel: "Seguir",
    icon: <MapPin size={18} />,
    testId: "nav-cliente-seguir",
  },
  {
    href: "/cliente/tarifa",
    label: "Calcular tarifa",
    shortLabel: "Tarifa",
    icon: <Calculator size={18} />,
    testId: "nav-cliente-tarifa",
  },
  {
    href: "/cliente/cuenta",
    label: "Mi cuenta",
    shortLabel: "Cuenta",
    icon: <ShieldCheck size={18} />,
    testId: "nav-cliente-cuenta",
  },
];

export function ClientPortalShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  // Seguimiento público
  const [trackingInput, setTrackingInput] = useState("");
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const [trackingPreview, setTrackingPreview] = useState<PublicTrackingSummary | null>(null);

  // Cotizador
  const [originLng] = useState("-73.9125");
  const [originLat] = useState("4.9652");
  const [destLng, setDestLng] = useState("-73.9180");
  const [destLat, setDestLat] = useState("4.9701");
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoStatus, setGeoStatus] = useState("Destino por defecto: centro de Tocancipá.");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteText, setQuoteText] = useState("");

  useEffect(() => {
    let active = true;
    let redirected = false;
    const storedRole = getStoredActiveRole();
    callProxy<SessionUser>("auth/me", "GET")
      .then((user) => {
        if (!active || !user.id) {
          return;
        }
        if (storedRole && storedRole !== "CUSTOMER") {
          redirected = true;
          router.replace(ROLE_BASE_PATH[storedRole]);
          return;
        }
        setStoredActiveRole("CUSTOMER");
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
    if (!checkingSession && !sessionUser && pathname !== "/cliente") {
      router.replace("/cliente");
    }
  }, [checkingSession, sessionUser, pathname, router]);

  const handleAuthenticated = useCallback((user: SessionUser) => {
    setStoredActiveRole("CUSTOMER");
    setSessionUser(user);
  }, []);

  const handleLoggedOut = useCallback(() => {
    clearStoredActiveRole();
    setSessionUser(null);
    setQuoteText("");
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
      router.replace("/cliente");
    }
  }, [handleLoggedOut, router]);

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

  if (checkingSession) {
    return (
      <div className="dg-card">
        <p className="dg-muted" style={{ margin: 0 }}>
          Verificando sesión de cliente...
        </p>
      </div>
    );
  }

  if (!sessionUser) {
    if (pathname !== "/cliente") {
      return (
        <div className="dg-card">
          <p className="dg-muted" style={{ margin: 0 }}>
            Redirigiendo al acceso de cliente...
          </p>
        </div>
      );
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
            Ingresa o regístrate con tu correo o celular para acceder a tu panel de cliente.
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
      </div>
    );
  }

  return (
    <ClientPortalContext.Provider
      value={{
        sessionUser,
        checkingSession,
        trackingInput,
        setTrackingInput,
        trackingLoading,
        trackingError,
        trackingPreview,
        handleLookupTracking,
        handleOpenTrackingPage,
        originLng,
        originLat,
        destLng,
        destLat,
        geoLoading,
        geoStatus,
        quoteLoading,
        quoteError,
        quoteText,
        handleUseMyLocation,
        handleEstimateDelivery,
        handleLogout,
        loggingOut,
      }}
    >
      <RolePanelShell
        roleBadge="Cliente"
        roleHeading="Panel de Cliente"
        navItems={CLIENT_NAV_ITEMS}
        sessionUser={sessionUser}
        onLogout={() => void handleLogout()}
        loggingOut={loggingOut}
      >
        {children}
      </RolePanelShell>
    </ClientPortalContext.Provider>
  );
}

function useClientPortal() {
  const ctx = useContext(ClientPortalContext);
  if (!ctx) {
    throw new Error("useClientPortal debe usarse dentro de ClientPortalShell");
  }
  return ctx;
}

export function ClientHomeScreen() {
  const { sessionUser } = useClientPortal();

  return (
    <div className="dg-stack" data-testid="cliente-home-screen">
      <div className="dg-card">
        <span className="dg-badge" style={{ marginBottom: "8px" }}>
          Inicio · Cliente
        </span>
        <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.35rem, 3vw, 1.75rem)" }}>
          ¡Hola, {sessionUser?.email ?? sessionUser?.phoneE164 ?? "Cliente"}!
        </h1>
        <p className="dg-muted" style={{ margin: 0 }}>
          Desde aquí puedes seguir tus pedidos en vivo, calcular tarifas de domicilio en Tocancipá o
          revisar tu cuenta.
        </p>
      </div>

      <div className="dg-grid-2">
        <Link href="/cliente/pedir" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Pedir comida</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Pide directamente al restaurante por WhatsApp y DOMIGOO gestiona tu domicilio.
          </p>
        </Link>

        <Link href="/cliente/seguir" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Seguir pedido</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Consulta el estado en vivo con el código o enlace compartido por el restaurante.
          </p>
        </Link>

        <Link href="/cliente/tarifa" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Calcular tarifa</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Estima el valor del domicilio usando tu ubicación actual o coordenadas.
          </p>
        </Link>

        <Link href="/cliente/cuenta" className="dg-card" style={{ textDecoration: "none" }}>
          <h2 style={{ marginBottom: "6px" }}>Mi cuenta</h2>
          <p className="dg-muted" style={{ margin: 0 }}>
            Revisa tus datos de sesión, autorizaciones de privacidad y enlaces legales.
          </p>
        </Link>
      </div>
    </div>
  );
}

export function ClientPedirScreen() {
  return (
    <div className="dg-stack" data-testid="cliente-pedir-screen">
      <section className="dg-card" aria-labelledby="client-pedir-title">
        <span className="dg-badge" style={{ marginBottom: "8px" }}>
          Cómo funciona · DOMIGOO
        </span>
        <h1 id="client-pedir-title" style={{ margin: "4px 0 8px" }}>
          Pedir comida en Tocancipá
        </h1>
        <p className="dg-muted">
          Pides directamente al restaurante por WhatsApp y DOMIGOO gestiona el domicilio hasta tu
          puerta.
        </p>
        <div className="dg-grid-2">
          <div className="dg-alert dg-alert--soon" style={{ marginBottom: 0 }}>
            <strong>1. Pide por WhatsApp:</strong> Escribe al restaurante de tu preferencia por
            WhatsApp para acordar tu comida; el restaurante registra la solicitud de envío en
            DOMIGOO.
          </div>
          <div className="dg-alert dg-alert--soon" style={{ marginBottom: 0 }}>
            <strong>2. Sigue tu domicilio:</strong> DOMIGOO gestiona el domicilio y el restaurante
            te comparte el enlace de seguimiento en vivo para ver el estado de tu entrega.
          </div>
        </div>
        <div className="dg-btn-row" style={{ marginTop: "16px" }}>
          <Link href="/cliente/seguir" className="dg-btn">
            Seguir un pedido existente
          </Link>
          <Link href="/cliente/tarifa" className="dg-btn dg-btn--secondary">
            Calcular tarifa de domicilio
          </Link>
        </div>
      </section>
    </div>
  );
}

export function ClientSeguirScreen() {
  const {
    trackingInput,
    setTrackingInput,
    trackingLoading,
    trackingError,
    trackingPreview,
    handleLookupTracking,
    handleOpenTrackingPage,
  } = useClientPortal();

  return (
    <div className="dg-stack" data-testid="cliente-seguir-screen">
      <section className="dg-card" aria-labelledby="tracking-lookup-title">
        <h1 id="tracking-lookup-title" style={{ marginBottom: "6px" }}>
          Seguir mi pedido
        </h1>
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
    </div>
  );
}

export function ClientTarifaScreen() {
  const {
    sessionUser,
    originLng,
    originLat,
    destLng,
    destLat,
    geoLoading,
    geoStatus,
    quoteLoading,
    quoteError,
    quoteText,
    handleUseMyLocation,
    handleEstimateDelivery,
  } = useClientPortal();

  return (
    <div className="dg-stack" data-testid="cliente-tarifa-screen">
      <section className="dg-card" aria-labelledby="client-quote-title">
        <h1 id="client-quote-title" style={{ marginBottom: "6px" }}>
          Calcular tarifa de domicilio
        </h1>
        <p className="dg-muted">
          Estima el costo de envío en Tocancipá usando tu ubicación actual.
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
    </div>
  );
}

export function ClientCuentaScreen() {
  const { sessionUser, handleLogout, loggingOut } = useClientPortal();

  return (
    <div className="dg-stack" data-testid="cliente-cuenta-screen">
      <section className="dg-card" aria-labelledby="client-account-title">
        <h1 id="client-account-title" style={{ marginBottom: "6px" }}>
          Mi cuenta y privacidad
        </h1>
        <p className="dg-muted">
          Sesión activa: <strong>{sessionUser?.email ?? sessionUser?.phoneE164}</strong> (Estado:{" "}
          {sessionUser?.status ?? "ACTIVE"}).
        </p>

        <div className="dg-stack" style={{ marginTop: "12px" }}>
          <div className="dg-alert dg-alert--soon" style={{ marginBottom: 0 }}>
            Tus consentimientos de Términos y Tratamiento de Datos quedaron registrados al momento
            de crear tu cuenta conforme a la Ley 1581 de 2012.
          </div>
          <div className="dg-btn-row">
            <Link href="/legal/terminos" className="dg-btn dg-btn--secondary">
              Términos y Condiciones
            </Link>
            <Link href="/legal/privacidad" className="dg-btn dg-btn--secondary">
              Política de Privacidad
            </Link>
            <Link href="/legal/autorizacion" className="dg-btn dg-btn--secondary">
              Autorización de Datos
            </Link>
          </div>
          <div className="dg-btn-row" style={{ marginTop: "8px" }}>
            <button
              type="button"
              className="dg-btn dg-btn--danger"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
            >
              {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
