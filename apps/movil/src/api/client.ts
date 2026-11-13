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

export class CourierApiClient {
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
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
      throw new Error(msg);
    }
    return data as T;
  }

  async login(phone: string, password: string): Promise<{ token: string }> {
    const res = await this.request<{ token: string }>("/v1/auth/login", "POST", {
      phone,
      password,
      client: "MOBILE",
    });
    this.token = res.token;
    return res;
  }

  async createProfile(input: {
    firstName: string;
    lastName: string;
    documentType: string;
    documentNumber: string;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>("/v1/couriers", "POST", input);
  }

  async setAvailability(status: "AVAILABLE" | "OFFLINE"): Promise<{ status: string }> {
    return this.request<{ status: string }>("/v1/couriers/me/availability", "POST", { status });
  }

  async sendLocation(input: {
    hasGeolocationConsent: boolean;
    longitude: number;
    latitude: number;
  }): Promise<{ recorded: boolean }> {
    if (!input.hasGeolocationConsent) {
      throw new Error("Se requiere consentimiento de geolocalización antes de enviar la posición.");
    }
    await this.request("/v1/couriers/me/location", "POST", {
      longitude: input.longitude,
      latitude: input.latitude,
    });
    return { recorded: true };
  }

  async acceptOffer(offerId: string, idempotencyKey: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/v1/offers/${offerId}/accept`, "POST", {
      idempotencyKey,
    });
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
