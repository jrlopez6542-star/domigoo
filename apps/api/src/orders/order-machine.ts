export const ORDER_STATUSES = [
  "DRAFT",
  "SEEKING_COURIER",
  "ACCEPTED",
  "ARRIVING_PICKUP",
  "AT_PICKUP",
  "PICKED_UP",
  "AT_DROPOFF",
  "DELIVERED",
  "EXPIRED",
  "CANCELLED_RESTAURANT",
  "CANCELLED_COURIER",
  "CANCELLED_ADMIN",
  "FAILED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ARROWS: ReadonlyArray<readonly [OrderStatus, OrderStatus]> = [
  ["DRAFT", "SEEKING_COURIER"],
  ["SEEKING_COURIER", "ACCEPTED"],
  ["SEEKING_COURIER", "EXPIRED"],
  ["SEEKING_COURIER", "CANCELLED_RESTAURANT"],
  ["SEEKING_COURIER", "CANCELLED_ADMIN"],
  ["ACCEPTED", "ARRIVING_PICKUP"],
  ["ACCEPTED", "CANCELLED_RESTAURANT"],
  ["ACCEPTED", "CANCELLED_COURIER"],
  ["ACCEPTED", "CANCELLED_ADMIN"],
  ["ACCEPTED", "FAILED"],
  ["ARRIVING_PICKUP", "AT_PICKUP"],
  ["ARRIVING_PICKUP", "CANCELLED_RESTAURANT"],
  ["ARRIVING_PICKUP", "CANCELLED_COURIER"],
  ["ARRIVING_PICKUP", "CANCELLED_ADMIN"],
  ["ARRIVING_PICKUP", "FAILED"],
  ["AT_PICKUP", "PICKED_UP"],
  ["AT_PICKUP", "CANCELLED_RESTAURANT"],
  ["AT_PICKUP", "CANCELLED_COURIER"],
  ["AT_PICKUP", "CANCELLED_ADMIN"],
  ["AT_PICKUP", "FAILED"],
  ["PICKED_UP", "AT_DROPOFF"],
  ["PICKED_UP", "CANCELLED_ADMIN"],
  ["PICKED_UP", "FAILED"],
  ["AT_DROPOFF", "DELIVERED"],
  ["AT_DROPOFF", "CANCELLED_ADMIN"],
  ["AT_DROPOFF", "FAILED"],
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ARROWS.some(([start, end]) => start === from && end === to);
}

export function allowedTransitions(): ReadonlyArray<readonly [OrderStatus, OrderStatus]> {
  return ARROWS;
}
