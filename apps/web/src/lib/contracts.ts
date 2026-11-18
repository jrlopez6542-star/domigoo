export type LoginClient = "WEB" | "ADMIN" | "MOBILE";

export type LoginPayload = {
  email?: string;
  phoneE164?: string;
  password: string;
  client: LoginClient;
};

export function buildLoginPayload(
  identifier: string,
  password: string,
  client: LoginClient,
): LoginPayload {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) {
    return { email: trimmed, password, client };
  }
  return { phoneE164: trimmed, password, client };
}

export type CreateRestaurantPayload = {
  legalName: string;
  tradeName: string;
  nit: string;
  email: string;
  phoneE164: string;
  establishmentName: string;
  branchName: string;
  addressLine: string;
  longitude: number;
  latitude: number;
};

export type QuotePayload = {
  origin: { longitude: number; latitude: number };
  destination: { longitude: number; latitude: number };
  at: string;
};

export type PublicBranchHour = {
  weekday: number;
  opensMinute: number;
  closesMinute: number;
  closed: boolean;
};

export type PublicRestaurantItem = {
  id: string;
  restaurantId: string;
  tradeName: string;
  branchName: string;
  addressLine: string;
  neighborhood: string | null;
  city: string;
  publicPhone: string | null;
  acceptingOrders: boolean;
  isOpen: boolean;
  todayHoursLabel: string;
  hours: PublicBranchHour[];
};

export function sanitizePhoneDigits(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = sanitizePhoneDigits(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function buildTelLink(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}

export function buildGoogleMapsNavUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${String(lat)},${String(lng)}`;
}

export function buildWazeNavUrl(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${String(lat)},${String(lng)}&navigate=yes`;
}

export function formatCop(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amount);
}
