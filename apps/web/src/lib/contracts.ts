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
