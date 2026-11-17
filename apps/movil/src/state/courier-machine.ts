import type { CourierOfferView, CourierOrderState } from "../api/client.js";

export type ScreenName =
  | "LOGIN"
  | "PROFILE"
  | "GEOLOCATION_CONSENT"
  | "AVAILABILITY"
  | "OFFER"
  | "JOURNEY"
  | "PIN_PICKUP"
  | "PIN_DELIVERY"
  | "DONE";

export type CourierMachineState = {
  screen: ScreenName;
  hasProfile: boolean;
  hasGeolocationConsent: boolean;
  geolocationConsentId: string | null;
  available: boolean;
  offer: CourierOfferView | null;
  order: CourierOrderState | null;
};

export function initialCourierState(): CourierMachineState {
  return {
    screen: "LOGIN",
    hasProfile: false,
    hasGeolocationConsent: false,
    geolocationConsentId: null,
    available: false,
    offer: null,
    order: null,
  };
}

export function sanitizeOfferForDisplay(offer: CourierOfferView): {
  id: string;
  orderId: string;
  deliveryFeeCop: number;
  pickupAddress: string;
  dropoffAddress: string;
  customerPhone: string | null;
} {
  return {
    id: offer.id,
    orderId: offer.orderId,
    deliveryFeeCop: offer.deliveryFeeCop,
    pickupAddress: offer.pickupAddress,
    dropoffAddress: offer.dropoffAddress,
    customerPhone: offer.status === "ACCEPTED" ? (offer.customerPhone ?? null) : null,
  };
}

export function sanitizeOrderForDisplay(order: CourierOrderState): {
  id: string;
  status: CourierOrderState["status"];
  customerPhone: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
} {
  return {
    id: order.id,
    status: order.status,
    customerPhone: order.customerPhone ?? null,
    pickupAddress: order.pickupAddress ?? null,
    dropoffAddress: order.dropoffAddress ?? null,
  };
}

export function nextScreenAfterLogin(hasProfile: boolean): ScreenName {
  return hasProfile ? "AVAILABILITY" : "PROFILE";
}

export function screenForOrderStatus(status: CourierOrderState["status"]): ScreenName {
  switch (status) {
    case "AT_PICKUP":
      return "PIN_PICKUP";
    case "AT_DROPOFF":
      return "PIN_DELIVERY";
    case "DELIVERED":
      return "DONE";
    default:
      return "JOURNEY";
  }
}
