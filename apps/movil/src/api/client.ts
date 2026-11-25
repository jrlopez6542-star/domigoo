export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type CourierOfferView = {
  id: string;
  orderId: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  deliveryFeeCop: number;
  pickupAddress: string;
  dropoffAddress: string;
  customerPhone?: string;
};

export type CourierOrderState = {
  id: string;
  status: "ACCEPTED" | "ARRIVING_PICKUP" | "AT_PICKUP" | "PICKED_UP" | "AT_DROPOFF" | "DELIVERED";
  customerPhone?: string;
  pickupAddress?: string;
  dropoffAddress?: string;
};

export type CurrentLegalDocument = {
  id: string;
  kind: string;
  version: string;
  contentHash?: string;
};

export type RegistrationLegalDocuments = {
  TERMS?: string;
  PRIVACY_NOTICE?: string;
  DOCUMENT_PROCESSING?: string;
};

export const MOBILE_REGISTRATION_OUTDATED_MESSAGE =
  "Los documentos legales se actualizaron. Revisa la versión vigente y vuelve a aceptarlos.";

export const MOBILE_GEO_CONSENT_OUTDATED_MESSAGE =
  "El Consentimiento de geolocalización se actualizó. Revisa la versión vigente y vuelve a confirmarlo.";

export const MOBILE_GEO_CONSENT_UNAVAILABLE_MESSAGE =
  "El documento de autorización ya no está disponible. Recarga e inténtalo de nuevo.";

export const MOBILE_GEO_ALREADY_REVOKED_MESSAGE = "Esta autorización ya estaba revocada.";

export const MOBILE_SESSION_EXPIRED_MESSAGE =
  "Tu sesión no es válida o expiró. Inicia sesión nuevamente.";

const FORBIDDEN_TECHNICAL_PATTERN =
  /\b(Not Found|Unauthorized|Forbidden|Bad Request|Internal Server Error|Error\s+[45]\d{2}|currentLegalDocumentId|TERMS|PRIVACY_NOTICE|DOCUMENT_PROCESSING|GEOLOCATION_CONSENT|TERMS_ACCEPTANCE|DOCUMENT_STORAGE|ORDER_CONTACT)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export class CourierApiError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "CourierApiError";
    this.status = status;
    if (body !== undefined) {
      this.body = body;
    }
  }
}

export class OutdatedLegalDocumentsError extends CourierApiError {
  readonly currentDocuments: CurrentLegalDocument[];

  constructor(message: string, currentDocuments: CurrentLegalDocument[], body?: unknown) {
    super(message, 422, body);
    this.name = "OutdatedLegalDocumentsError";
    this.currentDocuments = currentDocuments;
  }
}

export function buildCourierRegistrationDocuments(
  documents: ReadonlyArray<CurrentLegalDocument>,
): RegistrationLegalDocuments | null {
  const terms = documents.find((d) => d.kind === "TERMS" && Boolean(d.id));
  const privacy = documents.find((d) => d.kind === "PRIVACY_NOTICE" && Boolean(d.id));
  const sensitive = documents.find((d) => d.kind === "DOCUMENT_PROCESSING" && Boolean(d.id));
  if (!terms || !privacy || !sensitive) {
    return null;
  }
  return {
    TERMS: terms.id,
    PRIVACY_NOTICE: privacy.id,
    DOCUMENT_PROCESSING: sensitive.id,
  };
}

function sanitizeMobileMessage(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed || FORBIDDEN_TECHNICAL_PATTERN.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function isOutdatedLegalError(err: unknown): err is CourierApiError {
  if (!(err instanceof CourierApiError) || err.status !== 422) {
    return false;
  }
  if (typeof err.body === "object" && err.body !== null) {
    const body = err.body as Record<string, unknown>;
    if (
      Array.isArray(body["currentDocuments"]) ||
      typeof body["currentLegalDocumentId"] === "string"
    ) {
      return true;
    }
  }
  return err.message.toLowerCase().includes("desactualizada");
}

function extractCurrentDocuments(body: unknown): CurrentLegalDocument[] {
  if (typeof body !== "object" || body === null) {
    return [];
  }
  const raw = (body as Record<string, unknown>)["currentDocuments"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: CurrentLegalDocument[] = [];
  for (const item of raw) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>)["id"] === "string" &&
      typeof (item as Record<string, unknown>)["kind"] === "string" &&
      typeof (item as Record<string, unknown>)["version"] === "string"
    ) {
      result.push({
        id: String((item as Record<string, unknown>)["id"]),
        kind: String((item as Record<string, unknown>)["kind"]),
        version: String((item as Record<string, unknown>)["version"]),
      });
    }
  }
  return result;
}

export class CourierApiClient {
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(
    path: string,
    method: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...extraHeaders,
    };
    if (this.token !== null) {
      headers["authorization"] = `Bearer ${this.token}`;
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
          ? (data as { message: string }).message
          : `Error ${String(res.status)}`;
      throw new CourierApiError(msg, res.status, data);
    }
    return data as T;
  }

  async getCurrentLegalDocuments(): Promise<CurrentLegalDocument[]> {
    const docs = await this.request<{
      documents?: CurrentLegalDocument[];
    }>("/v1/legal-documents/current", "GET");
    return Array.isArray(docs.documents) ? docs.documents : [];
  }

  async login(identifier: string, password: string): Promise<{ token: string }> {
    const trimmed = identifier.trim();
    const payload = trimmed.includes("@")
      ? { email: trimmed, password, client: "MOBILE" }
      : { phoneE164: trimmed, password, client: "MOBILE" };
    const res = await this.request<{ token: string }>("/v1/auth/login", "POST", payload);
    this.token = res.token;
    return res;
  }

  async registerCourier(input: {
    identifier: string;
    password: string;
    consents: {
      termsAccepted: boolean;
      privacyAccepted: boolean;
      sensitiveDataAccepted: boolean;
      marketingAccepted?: boolean;
      version?: string;
      documents?: RegistrationLegalDocuments;
    };
  }): Promise<{ token: string }> {
    const trimmed = input.identifier.trim();
    const base = trimmed.includes("@")
      ? { email: trimmed, password: input.password, client: "MOBILE" }
      : { phoneE164: trimmed, password: input.password, client: "MOBILE" };
    try {
      const res = await this.request<{ token: string }>("/v1/auth/register", "POST", {
        ...base,
        role: "COURIER",
        consents: input.consents,
      });
      this.token = res.token;
      return res;
    } catch (err) {
      if (isOutdatedLegalError(err)) {
        const refreshed = await this.getCurrentLegalDocuments().catch(() =>
          extractCurrentDocuments(err.body),
        );
        throw new OutdatedLegalDocumentsError(
          MOBILE_REGISTRATION_OUTDATED_MESSAGE,
          refreshed.length > 0 ? refreshed : extractCurrentDocuments(err.body),
          err.body,
        );
      }
      if (err instanceof CourierApiError) {
        throw new CourierApiError(
          sanitizeMobileMessage(
            err.message,
            "No fue posible crear tu cuenta. Verifica tus datos e inténtalo de nuevo.",
          ),
          err.status,
          err.body,
        );
      }
      throw err;
    }
  }

  async grantGeolocationConsent(legalDocumentId?: string): Promise<{ consentId: string }> {
    let docId = legalDocumentId;
    if (docId === undefined) {
      const docs = await this.getCurrentLegalDocuments();
      const geoDoc = docs.find((d) => d.kind === "GEOLOCATION_CONSENT");
      if (!geoDoc) {
        throw new CourierApiError(MOBILE_GEO_CONSENT_UNAVAILABLE_MESSAGE, 404);
      }
      docId = geoDoc.id;
    }
    try {
      const consent = await this.request<{ id: string }>("/v1/consents", "POST", {
        legalDocumentId: docId,
        purpose: "GEOLOCATION",
        channel: "MOBILE",
      });
      return { consentId: consent.id };
    } catch (err) {
      if (isOutdatedLegalError(err)) {
        const refreshed = await this.getCurrentLegalDocuments().catch(() => []);
        throw new OutdatedLegalDocumentsError(
          MOBILE_GEO_CONSENT_OUTDATED_MESSAGE,
          refreshed,
          err.body,
        );
      }
      if (err instanceof CourierApiError) {
        if (err.status === 401) {
          throw new CourierApiError(
            sanitizeMobileMessage(err.message, MOBILE_SESSION_EXPIRED_MESSAGE),
            401,
            err.body,
          );
        }
        if (err.status === 404 || err.status === 422) {
          throw new CourierApiError(MOBILE_GEO_CONSENT_UNAVAILABLE_MESSAGE, err.status, err.body);
        }
        throw new CourierApiError(
          sanitizeMobileMessage(
            err.message,
            "No se pudo registrar el Consentimiento de geolocalización. Inténtalo de nuevo.",
          ),
          err.status,
          err.body,
        );
      }
      throw err;
    }
  }

  async revokeGeolocationConsent(consentId: string): Promise<{ revoked: true }> {
    try {
      return await this.request<{ revoked: true }>(`/v1/consents/${consentId}/revoke`, "POST", {});
    } catch (err) {
      if (err instanceof CourierApiError) {
        if (err.status === 404) {
          throw new CourierApiError(MOBILE_GEO_ALREADY_REVOKED_MESSAGE, 404, err.body);
        }
        if (err.status === 401) {
          throw new CourierApiError(
            sanitizeMobileMessage(err.message, MOBILE_SESSION_EXPIRED_MESSAGE),
            401,
            err.body,
          );
        }
        throw new CourierApiError(
          sanitizeMobileMessage(err.message, "No se pudo revocar la ubicación."),
          err.status,
          err.body,
        );
      }
      throw err;
    }
  }

  async createProfile(input: {
    firstName: string;
    lastName: string;
    documentType: string;
    documentNumber: string;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>("/v1/couriers", "POST", input);
  }

  async setAvailability(state: "AVAILABLE" | "OFFLINE"): Promise<{ state: string }> {
    return this.request<{ state: string }>("/v1/couriers/me/availability", "POST", { state });
  }

  async sendLocation(input: {
    hasGeolocationConsent: boolean;
    longitude: number;
    latitude: number;
    accuracyM?: number;
  }): Promise<{ recorded: boolean }> {
    if (!input.hasGeolocationConsent) {
      throw new Error("Se requiere consentimiento de geolocalización antes de enviar la posición.");
    }
    await this.request("/v1/couriers/me/location", "POST", {
      longitude: input.longitude,
      latitude: input.latitude,
      ...(input.accuracyM !== undefined ? { accuracyM: Math.round(input.accuracyM) } : {}),
    });
    return { recorded: true };
  }

  async acceptOffer(offerId: string, idempotencyKey: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(
      `/v1/offers/${offerId}/accept`,
      "POST",
      {},
      { "idempotency-key": idempotencyKey },
    );
  }

  async declineOffer(offerId: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/v1/offers/${offerId}/decline`, "POST", {});
  }

  async advanceStep(
    orderId: string,
    action: "arrive-pickup" | "at-pickup" | "at-dropoff",
  ): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/v1/orders/${orderId}/${action}`, "POST", {});
  }

  async submitPickupPin(orderId: string, pin: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/v1/orders/${orderId}/pickup-pin`, "POST", { pin });
  }

  async submitDeliveryPin(orderId: string, pin: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/v1/orders/${orderId}/delivery-pin`, "POST", {
      pin,
    });
  }
}
