"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ClipboardList, Home, PlusCircle, ShieldCheck, Store } from "lucide-react";
import { callProxy } from "@/lib/api-client";
import type { CreateRestaurantPayload, QuotePayload } from "@/lib/contracts";
import {
  findCurrentDocumentByKind,
  GEO_CONSENT_UNAVAILABLE_MESSAGE,
  resolveGeolocationConsentError,
  resolveRevokeGeolocationError,
  type CurrentLegalDocument,
} from "@/lib/legal-consents";
import { orderStatusLabel } from "@/lib/order-status";
import {
  branchHoursSignature,
  branchStatusLabel,
  buildBranchHoursSlots,
  formatBogotaDateTime,
  getRestaurantInactiveMessage,
  hydrateBranchHoursForm,
  isRestaurantOrBranchInactive,
  parseBranchHoursSignature,
  resolveRestaurantOrderActionError,
  RESTAURANT_INACTIVE_MESSAGE,
  restaurantStatusLabel,
  WEEKDAY_OPTIONS,
  type BranchHourSlot,
} from "@/lib/portal-helpers";
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
  referenceCode?: string;
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

export type RestaurantBranchItem = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  establishmentName: string;
  name: string;
  addressLine: string;
  status: string;
  restaurantStatus?: string;
  hours?: BranchHourSlot[];
};

export type RestaurantOrderSummary = {
  id: string;
  referenceCode: string;
  status: string;
  branchName: string;
  foodAmountCop: number;
  deliveryFeeCop: number;
  paymentMethod: string | null;
  customerName: string | null;
  dropoffAddress: string | null;
  pickupPin?: string;
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
  geoConsentDoc: CurrentLegalDocument | null;
  loadingGeoDoc: boolean;
  loadGeoConsentDocument: () => Promise<CurrentLegalDocument | null>;
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
  branches: RestaurantBranchItem[];
  selectedBranch: RestaurantBranchItem | undefined;
  loadingBranches: boolean;
  restaurantNotActive: boolean;
  restaurantInactiveMessage: string | null;
  hoursWeekdays: number[];
  toggleHoursWeekday: (weekday: number) => void;
  opensTime: string;
  setOpensTime: (v: string) => void;
  closesTime: string;
  setClosesTime: (v: string) => void;
  hoursMixedNotice: string | null;
  loadMyBranches: () => Promise<void>;
  handleCreateBranch: (e: FormEvent) => Promise<void>;
  handleSaveBranchHours: (e: FormEvent) => Promise<void>;
  handleActivateBranch: () => Promise<void>;
  handleSubmitRestaurant: () => Promise<void>;
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
  activeOrderReferenceCode: string | null;
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
  myOrders: RestaurantOrderSummary[];
  loadingOrders: boolean;
  loadMyOrders: () => Promise<void>;
  orderView: OrderView | null;
  events: OrderEvent[];
  trackingUrl: string;
  handleRefreshOrder: (targetOrderId?: string) => Promise<void>;
  handleCreateTrackingLink: (targetOrderId?: string) => Promise<void>;
  confirmCancelOrderId: string | null;
  setConfirmCancelOrderId: (v: string | null) => void;
  cancelReason: string;
  setCancelReason: (v: string) => void;
  cancelError: string;
  setCancelError: (v: string) => void;
  handleCancelOrder: (targetOrderId: string) => Promise<void>;
};

export const RESTAURANT_CANCELLABLE_STATUSES = new Set([
  "SEEKING_COURIER",
  "ACCEPTED",
  "ARRIVING_PICKUP",
  "AT_PICKUP",
]);

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
  const [geoConsentDoc, setGeoConsentDoc] = useState<CurrentLegalDocument | null>(null);
  const [loadingGeoDoc, setLoadingGeoDoc] = useState(false);
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
  const branchIdRef = useRef(branchId);
  const [branches, setBranches] = useState<RestaurantBranchItem[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [hoursWeekdays, setHoursWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [opensTime, setOpensTime] = useState("08:00");
  const [closesTime, setClosesTime] = useState("21:00");
  const [hoursMixedNotice, setHoursMixedNotice] = useState<string | null>(null);

  useEffect(() => {
    branchIdRef.current = branchId;
  }, [branchId]);

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
  const [myOrders, setMyOrders] = useState<RestaurantOrderSummary[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [orderView, setOrderView] = useState<OrderView | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [trackingUrl, setTrackingUrl] = useState<string>("");
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancelError, setCancelError] = useState<string>("");

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
    if (!checkingSession && !sessionUser && pathname !== "/restaurante") {
      router.replace("/restaurante");
    }
  }, [checkingSession, sessionUser, pathname, router]);

  const loadMyBranches = useCallback(async () => {
    setLoadingBranches(true);
    try {
      const data = await callProxy<{ branches?: RestaurantBranchItem[] }>("branches/mine", "GET");
      const list = Array.isArray(data.branches) ? data.branches : [];
      setBranches(list);
      const chosenBranch =
        list.length === 1
          ? list[0]
          : list.length > 1
            ? (list.find((b) => b.id === branchIdRef.current) ?? list[0])
            : undefined;
      if (chosenBranch) {
        setBranchId(chosenBranch.id);
        setRestaurantId(chosenBranch.restaurantId);
      }
    } catch {
      // Si el listado no responde en mocks parciales, conservamos el branchId actual.
    } finally {
      setLoadingBranches(false);
    }
  }, []);

  const loadMyOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const data = await callProxy<{ orders?: RestaurantOrderSummary[] }>("orders/mine", "GET");
      const list = Array.isArray(data.orders) ? data.orders : [];
      setMyOrders(list);
    } catch {
      // Mantiene el estado actual si aún no hay membresía o falla la consulta.
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    if (sessionUser) {
      void loadMyBranches();
      void loadMyOrders();
    }
  }, [sessionUser, loadMyBranches, loadMyOrders]);

  const handleAuthenticated = useCallback((user: SessionUser) => {
    setStoredActiveRole("RESTAURANT");
    setSessionUser(user);
  }, []);

  const handleLoggedOut = useCallback(() => {
    clearStoredActiveRole();
    setSessionUser(null);
    setBranches([]);
    setBranchId("");
    setRestaurantId("");
    setMyOrders([]);
    setOrderView(null);
    setEvents([]);
    setTrackingUrl("");
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

  const loadGeoConsentDocument = useCallback(async (): Promise<CurrentLegalDocument | null> => {
    setLoadingGeoDoc(true);
    try {
      const docs = await callProxy<{
        documents?: CurrentLegalDocument[];
      }>("legal-documents/current", "GET");
      const found = findCurrentDocumentByKind(docs.documents, "GEOLOCATION_CONSENT");
      setGeoConsentDoc(found);
      return found;
    } catch {
      setGeoConsentDoc(null);
      return null;
    } finally {
      setLoadingGeoDoc(false);
    }
  }, []);

  useEffect(() => {
    if (!showGeoConsent) {
      return;
    }
    void loadGeoConsentDocument();
  }, [showGeoConsent, loadGeoConsentDocument]);

  async function handleAllowGeoConsent() {
    setErrorMessage("");
    if (!geoConsentChecked) {
      setErrorMessage("Marca la casilla de autorización de geolocalización antes de continuar.");
      return;
    }
    try {
      if (sessionUser) {
        let geoDoc = geoConsentDoc;
        if (!geoDoc?.id) {
          const docs = await callProxy<{
            documents?: CurrentLegalDocument[];
          }>("legal-documents/current", "GET");
          geoDoc = docs.documents?.find((doc) => doc.kind === "GEOLOCATION_CONSENT") ?? null;
          setGeoConsentDoc(geoDoc);
        }
        if (!geoDoc?.id) {
          setErrorMessage(GEO_CONSENT_UNAVAILABLE_MESSAGE);
          return;
        }
        const granted = await callProxy<{ id: string }>("consents", "POST", {
          legalDocumentId: geoDoc.id,
          purpose: "GEOLOCATION",
          channel: "WEB",
        });
        setGeoConsentId(granted.id);
      }
      setShowGeoConsent(false);
      requestBrowserLocation("dropoff");
    } catch (err) {
      const resolved = resolveGeolocationConsentError(err);
      if (resolved.shouldUncheckConsent) {
        setGeoConsentChecked(false);
      }
      if (resolved.shouldRefetchCurrent) {
        await loadGeoConsentDocument();
      }
      setErrorMessage(resolved.message);
    }
  }

  async function handleRevokeGeoConsent() {
    if (!geoConsentId) {
      return;
    }
    await runAction("revoke-geo", async () => {
      try {
        await callProxy<unknown>(`consents/${encodeURIComponent(geoConsentId)}/revoke`, "POST", {});
        setGeoConsentId(null);
        setGeoConsentChecked(false);
        setStatusMessage("Consentimiento de geolocalización revocado.");
      } catch (err) {
        const resolved = resolveRevokeGeolocationError(err);
        if (resolved.alreadyRevoked) {
          setGeoConsentId(null);
          setGeoConsentChecked(false);
          setStatusMessage(resolved.message);
          return;
        }
        throw new Error(resolved.message, { cause: err });
      }
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
      const data = await callProxy<{ id: string; branchId: string; status?: string }>(
        "restaurants",
        "POST",
        payload,
      );
      setRestaurantId(data.id);
      setBranchId(data.branchId);
      setBranches((prev) => [
        {
          id: data.branchId,
          restaurantId: data.id,
          restaurantName: tradeName || legalName,
          establishmentName,
          name: branchName,
          addressLine,
          status: "DRAFT",
          restaurantStatus: data.status ?? "DRAFT",
        },
        ...prev.filter((b) => b.id !== data.branchId),
      ]);
      await loadMyBranches();
      setStatusMessage("Sucursal creada y seleccionada.");
    });
  }

  function toggleHoursWeekday(weekday: number) {
    setHoursWeekdays((prev) =>
      prev.includes(weekday)
        ? prev.filter((day) => day !== weekday)
        : [...prev, weekday].sort((a, b) => a - b),
    );
  }

  const selectedBranch = branches.find((b) => b.id === branchId) ?? branches[0];
  const selectedBranchId = selectedBranch?.id;
  const selectedBranchHoursSignature = branchHoursSignature(selectedBranch?.hours);
  const restaurantInactiveMessage = getRestaurantInactiveMessage(selectedBranch);
  const restaurantNotActive = isRestaurantOrBranchInactive(selectedBranch);
  const activeOrderReferenceCode =
    orderView?.referenceCode ??
    myOrders.find((item) => item.id === (orderView?.id ?? orderId))?.referenceCode ??
    null;

  useEffect(() => {
    if (!selectedBranchId) {
      return;
    }
    const hydrated = hydrateBranchHoursForm(
      parseBranchHoursSignature(selectedBranchHoursSignature),
    );
    setHoursWeekdays(hydrated.weekdays);
    setOpensTime(hydrated.opensTime);
    setClosesTime(hydrated.closesTime);
    setHoursMixedNotice(hydrated.notice);
  }, [selectedBranchId, selectedBranchHoursSignature]);

  async function handleSaveBranchHours(e: FormEvent) {
    e.preventDefault();
    const targetBranchId = selectedBranch?.id ?? branchId;
    if (!targetBranchId) {
      setErrorMessage("Primero crea o selecciona una sucursal.");
      return;
    }
    const built = buildBranchHoursSlots({
      weekdays: hoursWeekdays,
      opensTime,
      closesTime,
    });
    if (!built.ok) {
      setErrorMessage(built.message);
      return;
    }
    await runAction("hours", async () => {
      await callProxy<{ replaced: number }>(
        `branches/${encodeURIComponent(targetBranchId)}/hours`,
        "PUT",
        { slots: built.slots },
      );
      await loadMyBranches();
      setStatusMessage("Horario guardado correctamente.");
    });
  }

  async function handleActivateBranch() {
    const targetBranchId = selectedBranch?.id ?? branchId;
    if (!targetBranchId) {
      setErrorMessage("Primero crea o selecciona una sucursal.");
      return;
    }
    await runAction("activate-branch", async () => {
      await callProxy<{ status: string }>(
        `branches/${encodeURIComponent(targetBranchId)}/activate`,
        "POST",
        {},
      );
      await loadMyBranches();
      setStatusMessage("Sucursal activada correctamente.");
    });
  }

  async function handleSubmitRestaurant() {
    const targetRestaurantId = selectedBranch?.restaurantId ?? restaurantId;
    if (!targetRestaurantId) {
      setErrorMessage("Primero crea tu restaurante y sucursal.");
      return;
    }
    await runAction("submit-restaurant", async () => {
      await callProxy<{ status: string }>(
        `restaurants/${encodeURIComponent(targetRestaurantId)}/submit`,
        "POST",
        {},
      );
      await loadMyBranches();
      setStatusMessage("Registro enviado a revisión. DOMIGOO revisará tu solicitud.");
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
    if (!branchId) {
      setErrorMessage("Primero crea o selecciona una sucursal en Mi negocio.");
      return;
    }
    if (restaurantNotActive) {
      setErrorMessage(restaurantInactiveMessage ?? RESTAURANT_INACTIVE_MESSAGE);
      return;
    }
    await runAction("draft", async () => {
      try {
        const data = await callProxy<{ id: string; status: string }>("orders", "POST", {
          branchId,
          foodAmountCop: Number(foodAmountCop),
          deliveryFeeCop: Number(deliveryFeeCop),
          paymentMethod,
        });
        setOrderId(data.id);
        setOrderView({ id: data.id, status: data.status });
        setStatusMessage("Borrador creado.");
      } catch (err) {
        throw new Error(
          resolveRestaurantOrderActionError(err, "No se pudo crear el borrador.", selectedBranch),
          { cause: err },
        );
      }
    });
  }

  async function handlePublish(e: FormEvent) {
    e.preventDefault();
    if (restaurantNotActive) {
      setErrorMessage(restaurantInactiveMessage ?? RESTAURANT_INACTIVE_MESSAGE);
      return;
    }
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
      try {
        const data = await callProxy<{ status: string }>(
          `orders/${encodeURIComponent(orderId)}/publish`,
          "POST",
          payload,
        );
        setOrderView({ id: orderId, status: data.status });
        setStatusMessage(`Pedido publicado: ${orderStatusLabel(data.status)}`);
        await loadMyOrders();
      } catch (err) {
        throw new Error(
          resolveRestaurantOrderActionError(err, "No se pudo publicar el pedido.", selectedBranch),
          { cause: err },
        );
      }
    });
  }

  async function handleRefreshOrder(targetOrderId?: string) {
    const id = targetOrderId ?? orderId;
    if (!id) return;
    setOrderId(id);
    await runAction("refresh", async () => {
      const [view, evs] = await Promise.all([
        callProxy<OrderView>(`orders/${encodeURIComponent(id)}`, "GET"),
        callProxy<{ events: OrderEvent[] }>(`orders/${encodeURIComponent(id)}/events`, "GET"),
      ]);
      setOrderView(view);
      setEvents(evs.events);
    });
  }

  async function handleCreateTrackingLink(targetOrderId?: string) {
    const id = targetOrderId ?? orderId;
    if (!id) return;
    setOrderId(id);
    await runAction("tracking", async () => {
      const res = await callProxy<{ token: string }>(
        `orders/${encodeURIComponent(id)}/tracking-link`,
        "POST",
        {},
      );
      setTrackingUrl(`/tracking/${encodeURIComponent(res.token)}`);
      setStatusMessage("Enlace público de seguimiento generado.");
    });
  }

  async function handleCancelOrder(targetOrderId: string) {
    const trimmedReason = cancelReason.trim();
    if (!targetOrderId || !trimmedReason) return;
    setCancelError("");
    await runAction("cancel", async () => {
      try {
        const res = await callProxy<{ status: string }>(
          `orders/${encodeURIComponent(targetOrderId)}/cancel`,
          "POST",
          { reason: trimmedReason },
        );
        setConfirmCancelOrderId(null);
        setCancelReason("");
        setCancelError("");
        if (orderView?.id === targetOrderId) {
          setOrderView({ ...orderView, status: res.status });
        }
        setStatusMessage(`Pedido cancelado: ${orderStatusLabel(res.status)}`);
        await loadMyOrders();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No se pudo cancelar el pedido.";
        setCancelError(msg);
        throw err;
      }
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
        geoConsentDoc,
        loadingGeoDoc,
        loadGeoConsentDocument,
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
        branches,
        selectedBranch,
        loadingBranches,
        restaurantNotActive,
        restaurantInactiveMessage,
        hoursWeekdays,
        toggleHoursWeekday,
        opensTime,
        setOpensTime,
        closesTime,
        setClosesTime,
        hoursMixedNotice,
        loadMyBranches,
        handleCreateBranch,
        handleSaveBranchHours,
        handleActivateBranch,
        handleSubmitRestaurant,
        foodAmountCop,
        setFoodAmountCop,
        deliveryFeeCop,
        setDeliveryFeeCop,
        paymentMethod,
        setPaymentMethod,
        quoteSummary,
        orderId,
        setOrderId,
        activeOrderReferenceCode,
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
        myOrders,
        loadingOrders,
        loadMyOrders,
        orderView,
        events,
        trackingUrl,
        handleRefreshOrder,
        handleCreateTrackingLink,
        confirmCancelOrderId,
        setConfirmCancelOrderId,
        cancelReason,
        setCancelReason,
        cancelError,
        setCancelError,
        handleCancelOrder,
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
  const {
    selectedBranch,
    orderId,
    activeOrderReferenceCode,
    orderView,
    restaurantNotActive,
    restaurantInactiveMessage,
  } = useRestaurantPortal();

  return (
    <div className="dg-stack" data-testid="restaurante-home-screen">
      {restaurantNotActive ? (
        <div
          role="status"
          className="dg-alert dg-alert--info"
          data-testid="restaurante-inactivo-banner"
          style={{ marginBottom: 0 }}
        >
          {restaurantInactiveMessage ?? RESTAURANT_INACTIVE_MESSAGE}
        </div>
      ) : null}

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
            Sucursal:{" "}
            {selectedBranch
              ? `${selectedBranch.restaurantName} — ${selectedBranch.name}`
              : "Pendiente por configurar"}
          </span>
          <span className="dg-pill">
            Pedido activo:{" "}
            {orderId
              ? `${activeOrderReferenceCode ? `#${activeOrderReferenceCode}` : "En curso"} (${orderView?.status ? orderStatusLabel(orderView.status) : "—"})`
              : "Ninguno"}
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
    setBranchId,
    branches,
    selectedBranch,
    restaurantNotActive,
    restaurantInactiveMessage,
    hoursWeekdays,
    toggleHoursWeekday,
    opensTime,
    setOpensTime,
    closesTime,
    setClosesTime,
    hoursMixedNotice,
    requestBrowserLocation,
    handleCreateBranch,
    handleSaveBranchHours,
    handleActivateBranch,
    handleSubmitRestaurant,
  } = useRestaurantPortal();

  const activeBranch = selectedBranch;

  return (
    <div className="dg-stack" data-testid="restaurante-negocio-screen">
      {activeBranch ? (
        <section
          className="dg-card dg-stack"
          aria-labelledby="restaurant-onboarding-title"
          data-testid="restaurante-alta-card"
        >
          <div>
            <span className="dg-badge" style={{ marginBottom: "8px" }}>
              Activación · Sucursal
            </span>
            <h2 id="restaurant-onboarding-title" style={{ margin: "4px 0 6px" }}>
              Estado y horario de tu negocio
            </h2>
            <p className="dg-muted" style={{ margin: 0 }}>
              Configura el horario de tu sucursal, actívala y envía tu registro para que DOMIGOO lo
              apruebe.
            </p>
          </div>

          {branches.length > 1 ? (
            <label className="dg-field" htmlFor="negocio-branch-select">
              <span>Sucursal a configurar</span>
              <select
                id="negocio-branch-select"
                className="dg-select"
                value={activeBranch.id}
                onChange={(e) => {
                  setBranchId(e.target.value);
                }}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.restaurantName} — {b.name} ({branchStatusLabel(b.status)})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="dg-btn-row">
            <span className="dg-pill" data-testid="restaurant-status-pill">
              Restaurante: {restaurantStatusLabel(activeBranch.restaurantStatus)}
            </span>
            <span className="dg-pill" data-testid="branch-status-pill">
              Sucursal ({activeBranch.name}): {branchStatusLabel(activeBranch.status)}
            </span>
          </div>

          {restaurantNotActive ? (
            <div role="status" className="dg-alert dg-alert--info" style={{ marginBottom: 0 }}>
              {restaurantInactiveMessage ?? RESTAURANT_INACTIVE_MESSAGE}
            </div>
          ) : null}

          <form
            onSubmit={(e) => {
              void handleSaveBranchHours(e);
            }}
            className="dg-stack"
            data-testid="branch-hours-form"
          >
            {hoursMixedNotice ? (
              <div
                role="status"
                className="dg-alert dg-alert--info"
                data-testid="branch-hours-mixed-notice"
                style={{ marginBottom: 0 }}
              >
                {hoursMixedNotice}
              </div>
            ) : null}
            <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <legend
                style={{
                  fontSize: "0.92rem",
                  fontWeight: 600,
                  marginBottom: "8px",
                  color: "var(--dg-text)",
                }}
              >
                Días de atención
              </legend>
              <div className="dg-weekday-grid">
                {WEEKDAY_OPTIONS.map((day) => (
                  <label key={day.weekday} className="dg-weekday-option">
                    <input
                      type="checkbox"
                      checked={hoursWeekdays.includes(day.weekday)}
                      onChange={() => {
                        toggleHoursWeekday(day.weekday);
                      }}
                    />
                    <span>{day.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="dg-grid-2">
              <label className="dg-field" htmlFor="branch-opens-time">
                <span>Hora de apertura</span>
                <input
                  id="branch-opens-time"
                  className="dg-input"
                  type="time"
                  value={opensTime}
                  onChange={(e) => {
                    setOpensTime(e.target.value);
                  }}
                  required
                />
              </label>
              <label className="dg-field" htmlFor="branch-closes-time">
                <span>Hora de cierre</span>
                <input
                  id="branch-closes-time"
                  className="dg-input"
                  type="time"
                  value={closesTime}
                  onChange={(e) => {
                    setClosesTime(e.target.value);
                  }}
                  required
                />
              </label>
            </div>

            <div className="dg-btn-row">
              <button
                type="submit"
                className="dg-btn"
                data-testid="save-branch-hours-btn"
                disabled={!sessionUser || busyAction === "hours"}
              >
                {busyAction === "hours" ? "Guardando horario..." : "Guardar horario"}
              </button>

              {activeBranch.status !== "ACTIVE" ? (
                <button
                  type="button"
                  className="dg-btn dg-btn--accent"
                  data-testid="activate-branch-btn"
                  disabled={!sessionUser || busyAction === "activate-branch"}
                  onClick={() => {
                    void handleActivateBranch();
                  }}
                >
                  {busyAction === "activate-branch" ? "Activando sucursal..." : "Activar sucursal"}
                </button>
              ) : null}

              {activeBranch.restaurantStatus === "DRAFT" ? (
                <button
                  type="button"
                  className="dg-btn dg-btn--secondary"
                  data-testid="submit-restaurant-btn"
                  disabled={!sessionUser || busyAction === "submit-restaurant"}
                  onClick={() => {
                    void handleSubmitRestaurant();
                  }}
                >
                  {busyAction === "submit-restaurant"
                    ? "Enviando registro..."
                    : "Enviar registro a revisión"}
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

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
            {activeBranch?.restaurantName ? (
              <span className="dg-pill">Restaurante: {activeBranch.restaurantName}</span>
            ) : null}
            {activeBranch?.name ? (
              <span className="dg-pill">Sucursal: {activeBranch.name}</span>
            ) : null}
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
    errorMessage,
    busyAction,
    branchId,
    setBranchId,
    branches,
    loadingBranches,
    restaurantNotActive,
    restaurantInactiveMessage,
    foodAmountCop,
    setFoodAmountCop,
    deliveryFeeCop,
    setDeliveryFeeCop,
    paymentMethod,
    setPaymentMethod,
    quoteSummary,
    orderId,
    handleQuote,
    handleCreateDraft,
    showGeoConsent,
    setShowGeoConsent,
    geoConsentChecked,
    setGeoConsentChecked,
    geoConsentId,
    geoConsentDoc,
    loadingGeoDoc,
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

  const selectedBranch = branches.find((b) => b.id === branchId) ?? branches[0];
  const hasNoBranches = !loadingBranches && branches.length === 0 && !branchId;

  return (
    <div className="dg-stack" data-testid="restaurante-nuevo-domicilio-screen">
      <div className="dg-card">
        <h1 style={{ marginBottom: "10px" }}>Nuevo domicilio</h1>

        {hasNoBranches ? (
          <div
            className="dg-alert dg-alert--info"
            data-testid="restaurante-sin-sucursales"
            style={{ marginBottom: "16px" }}
          >
            <div className="dg-stack" style={{ gap: "10px" }}>
              <div>
                <strong>Aún no tienes ninguna sucursal registrada.</strong>
                <p className="dg-muted" style={{ margin: "4px 0 0" }}>
                  Crea tu negocio y sucursal primero para poder cotizar y publicar domicilios.
                </p>
              </div>
              <div>
                <Link href="/restaurante/negocio" className="dg-btn">
                  Ir a Mi negocio
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        {restaurantNotActive ? (
          <div
            role="alert"
            className="dg-alert dg-alert--info"
            data-testid="restaurante-inactivo-banner"
            style={{ marginBottom: "16px" }}
          >
            {restaurantInactiveMessage ?? RESTAURANT_INACTIVE_MESSAGE}
          </div>
        ) : null}

        {branches.length > 1 ? (
          <div style={{ marginBottom: "16px" }}>
            <label className="dg-field" htmlFor="rest-branch-select">
              <span>Sucursal de recogida</span>
              <select
                id="rest-branch-select"
                className="dg-select"
                data-testid="rest-branch-select"
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                }}
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} — {branch.addressLine}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : selectedBranch ? (
          <div style={{ marginBottom: "12px" }}>
            <span className="dg-pill" data-testid="rest-branch-auto">
              Sucursal: {selectedBranch.name} — {selectedBranch.addressLine}
            </span>
          </div>
        ) : null}

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
                disabled={!sessionUser || busyAction === "quote" || hasNoBranches}
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
                disabled={
                  !sessionUser || busyAction === "draft" || hasNoBranches || restaurantNotActive
                }
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
              {orderId ? <span className="dg-pill">Borrador listo para publicar</span> : null}
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
                  <Link href="/legal/privacidad" className="dg-inline-link">
                    Política de Privacidad
                  </Link>
                  .
                </p>
                {geoConsentDoc ? (
                  <p
                    className="dg-muted"
                    data-testid="geo-consent-version"
                    style={{ marginTop: 0, marginBottom: "10px" }}
                  >
                    Consentimiento de geolocalización — Versión vigente: {geoConsentDoc.version}
                  </p>
                ) : loadingGeoDoc ? (
                  <p className="dg-muted" style={{ marginTop: 0, marginBottom: "10px" }}>
                    Cargando versión vigente del Consentimiento de geolocalización...
                  </p>
                ) : null}
                {errorMessage ? (
                  <div
                    role="alert"
                    className="dg-alert dg-alert--error"
                    style={{ marginBottom: "12px" }}
                  >
                    {errorMessage}
                  </div>
                ) : null}
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
                <summary>Opciones avanzadas (coordenadas de entrega)</summary>
                <div className="dg-grid-2">
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
                  disabled={
                    !sessionUser || !orderId || busyAction === "publish" || restaurantNotActive
                  }
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
    activeOrderReferenceCode,
    myOrders,
    loadingOrders,
    loadMyOrders,
    orderView,
    events,
    trackingUrl,
    handleRefreshOrder,
    handleCreateTrackingLink,
    confirmCancelOrderId,
    setConfirmCancelOrderId,
    cancelReason,
    setCancelReason,
    cancelError,
    setCancelError,
    handleCancelOrder,
  } = useRestaurantPortal();

  return (
    <div className="dg-stack" data-testid="restaurante-pedidos-screen">
      <section className="dg-card" aria-labelledby="restaurant-tracking-title">
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
          <h1 id="restaurant-tracking-title" style={{ margin: 0 }}>
            Pedidos activos y seguimiento
          </h1>
          <button
            type="button"
            className="dg-btn dg-btn--secondary"
            disabled={!sessionUser || loadingOrders}
            onClick={() => {
              void loadMyOrders();
            }}
          >
            {loadingOrders ? "Actualizando..." : "Actualizar pedidos"}
          </button>
        </div>

        {myOrders.length === 0 ? (
          <p className="dg-muted" style={{ marginBottom: "12px" }}>
            {loadingOrders
              ? "Cargando pedidos..."
              : "Aún no tienes pedidos registrados. Crea uno en Nuevo domicilio."}
          </p>
        ) : (
          <div
            className="dg-stack"
            style={{ marginBottom: "14px" }}
            data-testid="restaurant-orders-list"
          >
            {myOrders.map((item) => {
              const isSelected = item.id === orderId;
              const isCancellable = RESTAURANT_CANCELLABLE_STATUSES.has(item.status);
              const isConfirmingCancel = confirmCancelOrderId === item.id;
              return (
                <article
                  key={item.id}
                  data-testid={`restaurant-order-card-${item.id}`}
                  className="dg-card"
                  style={{
                    margin: 0,
                    padding: "14px",
                    borderColor: isSelected ? "var(--dg-accent, #0f766e)" : undefined,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                      marginBottom: "6px",
                    }}
                  >
                    <strong>
                      Pedido #{item.referenceCode} · {item.branchName}
                    </strong>
                    <span className="dg-pill">{orderStatusLabel(item.status)}</span>
                  </div>
                  <p className="dg-muted" style={{ margin: "0 0 8px" }}>
                    {item.customerName ? `Cliente: ${item.customerName} · ` : ""}
                    {item.dropoffAddress ? `Destino: ${item.dropoffAddress} · ` : ""}
                    Domicilio: ${item.deliveryFeeCop.toLocaleString("es-CO")} COP
                    {item.pickupPin ? ` · PIN recogida: ${item.pickupPin}` : ""}
                  </p>
                  <div className="dg-btn-row">
                    <button
                      type="button"
                      className="dg-btn dg-btn--secondary"
                      disabled={!sessionUser || busyAction === "refresh"}
                      onClick={() => {
                        void handleRefreshOrder(item.id);
                      }}
                    >
                      Consultar estado y eventos
                    </button>
                    <button
                      type="button"
                      className="dg-btn"
                      disabled={!sessionUser || busyAction === "tracking"}
                      onClick={() => {
                        void handleCreateTrackingLink(item.id);
                      }}
                    >
                      Generar enlace público
                    </button>
                    {isCancellable && !isConfirmingCancel ? (
                      <button
                        type="button"
                        data-testid={`cancel-order-btn-${item.id}`}
                        className="dg-btn dg-btn--secondary"
                        style={{ minHeight: "44px", minWidth: "44px" }}
                        disabled={!sessionUser || busyAction === "cancel"}
                        onClick={() => {
                          setConfirmCancelOrderId(item.id);
                          setCancelReason("");
                          setCancelError("");
                        }}
                      >
                        Cancelar pedido
                      </button>
                    ) : null}
                  </div>
                  {isCancellable && isConfirmingCancel ? (
                    <div
                      data-testid={`cancel-confirm-${item.id}`}
                      style={{
                        marginTop: "10px",
                        padding: "12px",
                        border: "1px solid var(--dg-border)",
                        borderRadius: "var(--dg-radius-sm)",
                        display: "grid",
                        gap: "8px",
                        minWidth: 0,
                      }}
                    >
                      {cancelError ? (
                        <div role="alert" className="dg-alert dg-alert--error">
                          {cancelError}
                        </div>
                      ) : null}
                      <label className="dg-field" htmlFor={`cancel-reason-${item.id}`}>
                        <span>Motivo de cancelación</span>
                        <input
                          id={`cancel-reason-${item.id}`}
                          className="dg-input"
                          type="text"
                          value={cancelReason}
                          maxLength={200}
                          onChange={(e) => {
                            setCancelReason(e.target.value);
                          }}
                          placeholder="Ej: Cliente solicitó cancelar"
                          disabled={busyAction === "cancel"}
                          required
                        />
                      </label>
                      <div className="dg-btn-row">
                        <button
                          type="button"
                          data-testid={`confirm-cancel-btn-${item.id}`}
                          className="dg-btn"
                          style={{ minHeight: "44px", minWidth: "44px" }}
                          disabled={!sessionUser || busyAction === "cancel" || !cancelReason.trim()}
                          onClick={() => {
                            void handleCancelOrder(item.id);
                          }}
                        >
                          {busyAction === "cancel" ? "Cancelando..." : "Confirmar cancelación"}
                        </button>
                        <button
                          type="button"
                          className="dg-btn dg-btn--secondary"
                          style={{ minHeight: "44px", minWidth: "44px" }}
                          disabled={busyAction === "cancel"}
                          onClick={() => {
                            setConfirmCancelOrderId(null);
                            setCancelReason("");
                            setCancelError("");
                          }}
                        >
                          Volver
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        {orderView ? (
          <div className="dg-alert dg-alert--success">
            {activeOrderReferenceCode ? (
              <>
                Pedido <strong>#{activeOrderReferenceCode}</strong> ·{" "}
              </>
            ) : (
              "Pedido · "
            )}
            Estado: <strong>{orderStatusLabel(orderView.status)}</strong>
            {orderView.pickupPin ? ` · PIN recogida: ${orderView.pickupPin}` : ""}
          </div>
        ) : null}
        {trackingUrl ? (
          <p>
            Enlace para el cliente:{" "}
            <a href={trackingUrl} className="dg-inline-link">
              {trackingUrl}
            </a>
          </p>
        ) : null}
        {events.length > 0 ? (
          <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
            {events.map((ev) => (
              <li key={ev.id}>
                {ev.fromStatus ? orderStatusLabel(ev.fromStatus) : "Inicio"} →{" "}
                <strong>{orderStatusLabel(ev.toStatus)}</strong> (
                {formatBogotaDateTime(ev.createdAt)})
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="dg-card" aria-labelledby="restaurant-soon-title">
        <h2 id="restaurant-soon-title">Funciones en camino</h2>
        <div className="dg-alert dg-alert--soon" style={{ marginBottom: 0 }}>
          <strong>Próximamente:</strong> Filtros avanzados e historial exportable de pedidos del
          restaurante.
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
