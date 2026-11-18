"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Home,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Store,
  User,
} from "lucide-react";
import { extractTrackingToken } from "@/lib/api-client";
import {
  buildTelLink,
  buildWhatsAppLink,
  formatCop,
  type PublicRestaurantItem,
} from "@/lib/contracts";
import {
  clearStoredActiveRole,
  getStoredActiveRole,
  ROLE_BASE_PATH,
  setStoredActiveRole,
} from "@/lib/role-session";
import { RoleAuthCard, type SessionUser } from "./role-auth-card";
import { RolePanelShell, type RoleNavItem } from "./role-panel-shell";

type ClaimedOrderItem = {
  id: string;
  referenceCode: string;
  status: string;
  restaurantName: string;
  dropoffAddress: string | null;
  deliveryFeeCop: number;
  createdAt: string;
  deliveredAt: string | null;
  trackingToken: string | null;
};

type ClientPortalContextValue = {
  sessionUser: SessionUser | null;
  checkingSession: boolean;
  trackingInput: string;
  setTrackingInput: (val: string) => void;
  trackingError: string;
  handleOpenTracking: (e: FormEvent) => void;
  handleLogout: () => Promise<void>;
  loggingOut: boolean;
  refreshSession: () => Promise<void>;
};

const ClientPortalContext = createContext<ClientPortalContextValue | null>(null);

const CLIENT_NAV_ITEMS: RoleNavItem[] = [
  {
    href: "/",
    label: "Inicio",
    shortLabel: "Inicio",
    icon: <Home size={18} />,
    testId: "nav-cliente-inicio",
  },
  {
    href: "/cliente",
    label: "Restaurantes",
    shortLabel: "Restaurantes",
    icon: <Store size={18} />,
    testId: "nav-cliente-restaurantes",
  },
  {
    href: "/cliente/seguir",
    label: "Solicitudes",
    shortLabel: "Solicitudes",
    icon: <ClipboardList size={18} />,
    testId: "nav-cliente-solicitudes",
  },
  {
    href: "/cliente/cuenta",
    label: "Perfil",
    shortLabel: "Perfil",
    icon: <User size={18} />,
    testId: "nav-cliente-perfil",
  },
];

export function ClientPortalShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const [trackingInput, setTrackingInput] = useState("");
  const [trackingError, setTrackingError] = useState("");

  const loadSession = useCallback(async () => {
    setCheckingSession(true);
    const res = await fetch("/api/proxy/auth/me", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as SessionUser | { user: SessionUser };
      const resolvedUser = "user" in data ? data.user : data;
      setSessionUser(resolvedUser);
      const storedRole = getStoredActiveRole();
      if (storedRole && storedRole !== "CUSTOMER") {
        router.replace(ROLE_BASE_PATH[storedRole]);
      } else {
        setStoredActiveRole("CUSTOMER");
      }
    } else {
      setSessionUser(null);
    }
    setCheckingSession(false);
  }, [router]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  function handleOpenTracking(e: FormEvent) {
    e.preventDefault();
    setTrackingError("");
    const token = extractTrackingToken(trackingInput);
    if (!token) {
      setTrackingError("Ingresa el código o enlace de seguimiento de tu solicitud.");
      return;
    }
    router.push(`/tracking/${encodeURIComponent(token)}`);
  }

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/proxy/auth/logout", { method: "POST" });
    clearStoredActiveRole();
    setSessionUser(null);
    setLoggingOut(false);
  }

  return (
    <ClientPortalContext.Provider
      value={{
        sessionUser,
        checkingSession,
        trackingInput,
        setTrackingInput,
        trackingError,
        handleOpenTracking,
        handleLogout,
        loggingOut,
        refreshSession: loadSession,
      }}
    >
      <RolePanelShell
        roleBadge="Cliente"
        roleHeading="Cliente · Tocancipá"
        sidebarTitle="Cliente · Tocancipá"
        navItems={CLIENT_NAV_ITEMS}
        sessionUser={sessionUser}
        onLogout={() => {
          void handleLogout();
        }}
        loggingOut={loggingOut}
        currentPath={pathname}
        navAriaLabel="Navegación de cliente"
      >
        {children}
      </RolePanelShell>
    </ClientPortalContext.Provider>
  );
}

function useClientPortal(): ClientPortalContextValue {
  const ctx = useContext(ClientPortalContext);
  if (!ctx) {
    throw new Error("useClientPortal debe usarse dentro de ClientPortalShell");
  }
  return ctx;
}

export function ClientRestaurantsView() {
  const [query, setQuery] = useState("");
  const [restaurants, setRestaurants] = useState<PublicRestaurantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRestaurants = useCallback(async (search: string) => {
    setLoading(true);
    setError("");
    const qs = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
    const res = await fetch(`/api/proxy/public/restaurants${qs}`, { cache: "no-store" });
    if (!res.ok) {
      setError("No se pudieron cargar los restaurantes disponibles.");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { restaurants: PublicRestaurantItem[] };
    setRestaurants(data.restaurants);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadRestaurants("");
  }, [loadRestaurants]);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    void loadRestaurants(query);
  }

  return (
    <div className="dg-stack">
      <div className="dg-v2-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Link
            href="/"
            className="dg-btn dg-btn--secondary"
            style={{ minHeight: 40, padding: "6px 10px" }}
            aria-label="Volver al inicio"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800 }}>Restaurantes</h1>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#C0C6D4" }}>en Tocancipá</p>
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search
              size={18}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#C0C6D4",
                pointerEvents: "none",
              }}
              aria-hidden="true"
            />
            <input
              type="search"
              className="dg-input"
              style={{ paddingLeft: 38 }}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              placeholder="Buscar restaurante..."
              aria-label="Buscar restaurante"
              data-testid="cliente-search-restaurants"
            />
          </div>
          <button type="submit" className="dg-btn" style={{ minHeight: 48 }}>
            Buscar
          </button>
        </form>
      </div>

      {error ? (
        <div className="dg-alert dg-alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="dg-v2-card">
          <p style={{ margin: 0, color: "#C0C6D4" }}>Buscando restaurantes en Tocancipá...</p>
        </div>
      ) : restaurants.length === 0 ? (
        <div className="dg-v2-card" data-testid="cliente-restaurants-empty">
          <p style={{ margin: 0, color: "#C0C6D4" }}>
            No hay restaurantes activos que coincidan con tu búsqueda en este momento.
          </p>
        </div>
      ) : (
        <div className="dg-stack" data-testid="cliente-restaurants-list">
          {restaurants.map((r) => (
            <Link
              key={r.id}
              href={`/cliente/restaurantes/${encodeURIComponent(r.id)}`}
              className="dg-v2-card"
              data-testid={`restaurant-card-${r.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                textDecoration: "none",
              }}
            >
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: "rgba(121, 213, 208, 0.14)",
                  border: "1px solid rgba(121, 213, 208, 0.45)",
                  color: "#79D5D0",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                <Store size={22} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontFamily: "var(--domigoo-font-brand)",
                    fontSize: "1.02rem",
                    fontWeight: 700,
                    color: "#F5F7FA",
                  }}
                >
                  {r.tradeName}
                </p>
                <p style={{ margin: "2px 0 6px", fontSize: "0.84rem", color: "#C0C6D4" }}>
                  {r.city}
                  {r.neighborhood ? ` · ${r.neighborhood}` : ""}
                </p>
                <span className={r.isOpen ? "dg-v2-pill-open" : "dg-v2-pill-closed"}>
                  {r.isOpen ? "Abierto" : "Cerrado"}
                </span>
              </div>
              <ChevronRight size={20} color="#C0C6D4" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClientRestaurantProfileView({ branchId }: { branchId: string }) {
  const [restaurant, setRestaurant] = useState<PublicRestaurantItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const res = await fetch(`/api/proxy/public/restaurants/${encodeURIComponent(branchId)}`, {
        cache: "no-store",
      });
      if (!active) {
        return;
      }
      if (!res.ok) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as PublicRestaurantItem;
      setRestaurant(data);
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [branchId]);

  if (loading) {
    return (
      <div className="dg-v2-card">
        <p style={{ margin: 0, color: "#C0C6D4" }}>Cargando perfil del restaurante...</p>
      </div>
    );
  }

  if (notFound || !restaurant) {
    return (
      <div className="dg-v2-card">
        <h1 style={{ margin: "0 0 8px", fontSize: "1.25rem" }}>Restaurante no disponible</h1>
        <p style={{ margin: "0 0 14px", color: "#C0C6D4" }}>
          No encontramos este restaurante activo en Tocancipá.
        </p>
        <Link href="/cliente" className="dg-btn">
          Volver a restaurantes
        </Link>
      </div>
    );
  }

  const whatsappMsg = `Hola ${restaurant.tradeName}, te contacto desde DOMIGOO para coordinar un pedido a domicilio.`;
  const whatsappUrl = restaurant.publicPhone
    ? buildWhatsAppLink(restaurant.publicPhone, whatsappMsg)
    : null;
  const telUrl = restaurant.publicPhone ? buildTelLink(restaurant.publicPhone) : null;

  return (
    <div className="dg-stack" data-testid="cliente-restaurant-profile">
      <div className="dg-v2-card" style={{ textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <Link
            href="/cliente"
            className="dg-btn dg-btn--secondary"
            style={{ minHeight: 40, padding: "6px 10px" }}
            aria-label="Volver a restaurantes"
          >
            <ArrowLeft size={18} />
          </Link>
        </div>

        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: "rgba(121, 213, 208, 0.16)",
            border: "1.5px solid #79D5D0",
            color: "#79D5D0",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "8px auto 12px",
          }}
          aria-hidden="true"
        >
          <Store size={30} />
        </span>

        <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800 }}>{restaurant.tradeName}</h1>
        <p style={{ margin: "4px 0 10px", fontSize: "0.9rem", color: "#C0C6D4" }}>
          Restaurante · {restaurant.branchName}
        </p>
        <span className={restaurant.isOpen ? "dg-v2-pill-open" : "dg-v2-pill-closed"}>
          {restaurant.isOpen ? "Abierto" : "Cerrado"}
        </span>
      </div>

      <div className="dg-v2-card dg-stack">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <MapPin size={19} color="#79D5D0" style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0, fontWeight: 600, color: "#F5F7FA" }}>{restaurant.addressLine}</p>
            <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#C0C6D4" }}>
              {restaurant.city}
              {restaurant.neighborhood ? ` · ${restaurant.neighborhood}` : ""}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Clock size={19} color="#79D5D0" style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0, fontWeight: 600, color: "#F5F7FA" }}>
              {restaurant.todayHoursLabel}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#C0C6D4" }}>
              Horario en hora local (America/Bogota)
            </p>
          </div>
        </div>
      </div>

      <div className="dg-v2-card dg-stack">
        <h2 style={{ margin: 0, fontSize: "1rem", color: "#F5F7FA" }}>
          Contactar directamente al restaurante
        </h2>
        <p style={{ margin: 0, fontSize: "0.86rem", color: "#C0C6D4" }}>
          Acuerda tu pedido y el pago de la comida directamente con el restaurante. El restaurante
          solicitará tu domicilio y te enviará el enlace de seguimiento.
        </p>

        {restaurant.publicPhone && whatsappUrl && telUrl ? (
          <>
            <div className="dg-btn-row">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="dg-btn"
                style={{ flex: 1 }}
                data-testid="restaurant-connect-whatsapp"
              >
                <MessageCircle size={18} />
                Conectar con el restaurante
              </a>
              <a
                href={telUrl}
                className="dg-btn dg-btn--secondary"
                data-testid="restaurant-call-btn"
              >
                <Phone size={18} />
                Llamar
              </a>
            </div>
          </>
        ) : (
          <div className="dg-alert dg-alert--warn" style={{ marginBottom: 0 }}>
            Este restaurante aún no ha publicado un teléfono público de contacto.
          </div>
        )}
      </div>
    </div>
  );
}

export function ClientTrackingView() {
  const { trackingInput, setTrackingInput, trackingError, handleOpenTracking } = useClientPortal();

  return (
    <div className="dg-stack">
      <section className="dg-v2-card dg-stack" id="seguimiento">
        <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800 }}>Seguir pedido</h1>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#C0C6D4" }}>
          Consulta el estado de tu domicilio con el código o enlace que te compartió el restaurante.
          No necesitas iniciar sesión.
        </p>

        <form onSubmit={handleOpenTracking} className="dg-stack">
          <label className="dg-field">
            Código o enlace de seguimiento
            <input
              className="dg-input"
              value={trackingInput}
              onChange={(e) => {
                setTrackingInput(e.target.value);
              }}
              placeholder="Ej: trk_... o https://.../tracking/..."
              data-testid="cliente-tracking-input"
            />
          </label>
          {trackingError ? (
            <div className="dg-alert dg-alert--error" role="alert" style={{ marginBottom: 0 }}>
              {trackingError}
            </div>
          ) : null}
          <button type="submit" className="dg-btn" data-testid="cliente-tracking-submit">
            <MapPin size={18} />
            Ver seguimiento en vivo
          </button>
        </form>
      </section>
    </div>
  );
}

export function ClientAccountView() {
  const searchParams = useSearchParams();
  const claimToken = searchParams.get("claim");
  const { sessionUser, checkingSession, handleLogout, loggingOut, refreshSession } =
    useClientPortal();
  const [orders, setOrders] = useState<ClaimedOrderItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");

  const loadHistory = useCallback(async () => {
    if (!sessionUser) {
      setOrders([]);
      return;
    }
    setLoadingOrders(true);
    if (claimToken) {
      const claimRes = await fetch(`/api/proxy/tracking/${encodeURIComponent(claimToken)}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (claimRes.ok) {
        setClaimMessage("Tu solicitud fue guardada en tu historial.");
      }
    }
    const res = await fetch("/api/proxy/client/orders", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { orders: ClaimedOrderItem[] };
      setOrders(data.orders);
    }
    setLoadingOrders(false);
  }, [sessionUser, claimToken]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <div className="dg-stack">
      <div className="dg-v2-card">
        <h1 style={{ margin: "0 0 6px", fontSize: "1.3rem", fontWeight: 800 }}>
          Perfil e historial (opcional)
        </h1>
        <p style={{ margin: 0, fontSize: "0.88rem", color: "#C0C6D4" }}>
          Nunca es obligatorio crear cuenta para ver restaurantes o seguir un pedido. Si decides
          iniciar sesión, podrás guardar tus solicitudes en tu historial.
        </p>
      </div>

      {claimMessage ? (
        <div className="dg-alert dg-alert--success" role="status">
          {claimMessage}
        </div>
      ) : null}

      {checkingSession ? (
        <div className="dg-v2-card">
          <p style={{ margin: 0, color: "#C0C6D4" }}>Verificando sesión...</p>
        </div>
      ) : sessionUser ? (
        <>
          <div className="dg-v2-card dg-stack">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, color: "#F5F7FA" }}>
                  {sessionUser.email ?? sessionUser.phoneE164 ?? "Cuenta activa"}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#79D5D0" }}>
                  Sesión iniciada
                </p>
              </div>
              <button
                type="button"
                className="dg-btn dg-btn--secondary"
                disabled={loggingOut}
                onClick={() => {
                  void handleLogout();
                }}
              >
                {loggingOut ? "Cerrando..." : "Cerrar sesión"}
              </button>
            </div>
          </div>

          <section className="dg-v2-card dg-stack" aria-label="Historial de solicitudes guardadas">
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Mis solicitudes guardadas</h2>
            {loadingOrders ? (
              <p style={{ margin: 0, color: "#C0C6D4" }}>Cargando historial...</p>
            ) : orders.length === 0 ? (
              <p style={{ margin: 0, color: "#C0C6D4" }}>
                Aún no has guardado solicitudes en tu cuenta. Desde cualquier enlace de seguimiento
                puedes pulsar &quot;Guardar este pedido en mi cuenta&quot;.
              </p>
            ) : (
              <div className="dg-stack" data-testid="client-saved-orders">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="dg-v2-light-card"
                    style={{ display: "flex", justifyContent: "space-between", gap: 10 }}
                  >
                    <div>
                      <p style={{ margin: 0, fontWeight: 800 }}>
                        #{order.referenceCode} · {order.restaurantName}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#4B4563" }}>
                        Estado: {order.status} · Domicilio: {formatCop(order.deliveryFeeCop)}
                      </p>
                    </div>
                    {order.trackingToken ? (
                      <Link
                        href={`/tracking/${encodeURIComponent(order.trackingToken)}`}
                        className="dg-btn"
                        style={{ minHeight: 40, padding: "8px 12px" }}
                      >
                        Ver
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <RoleAuthCard
          accountRole="CUSTOMER"
          roleTitle="Cuenta opcional de cliente"
          roleSubtitle="Inicia sesión o regístrate con tu correo o teléfono solo si deseas guardar tu historial."
          identifierPlaceholder="cliente@ejemplo.com"
          sessionUser={sessionUser}
          onAuthenticated={() => {
            void refreshSession();
          }}
          onLoggedOut={() => {
            void handleLogout();
          }}
        />
      )}
    </div>
  );
}
