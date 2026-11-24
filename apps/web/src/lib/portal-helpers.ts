export const TERMINAL_ORDER_STATUSES = new Set([
  "DELIVERED",
  "EXPIRED",
  "CANCELLED_RESTAURANT",
  "CANCELLED_COURIER",
  "CANCELLED_ADMIN",
  "FAILED",
]);
export function pickActiveCourierOrder<T extends { status: string }>(orders: T[]): T | null {
  return orders.find((item) => !TERMINAL_ORDER_STATUSES.has(item.status)) ?? null;
}
export function sanitizeMarkdownHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("#")) {
    return trimmed;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
    ) {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

export const RESTAURANT_INACTIVE_MESSAGE =
  "Tu restaurante aún no está activo. Podrás crear domicilios cuando DOMIGOO apruebe tu registro.";

export function isRestaurantOrBranchInactive(
  branch: { status: string; restaurantStatus?: string } | undefined,
): boolean {
  if (!branch) {
    return false;
  }
  if (branch.status !== "ACTIVE") {
    return true;
  }
  if (branch.restaurantStatus !== undefined && branch.restaurantStatus !== "ACTIVE") {
    return true;
  }
  return false;
}

export function resolveRestaurantOrderActionError(err: unknown, fallbackMessage: string): string {
  if (err instanceof Error && "status" in err && (err as { status?: unknown }).status === 404) {
    return RESTAURANT_INACTIVE_MESSAGE;
  }
  return err instanceof Error ? err.message : fallbackMessage;
}
