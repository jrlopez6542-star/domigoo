export type AccountRole = "CUSTOMER" | "RESTAURANT" | "COURIER";

const ACTIVE_ROLE_STORAGE_KEY = "domigoo_active_role";

export const ROLE_BASE_PATH: Record<AccountRole, string> = {
  CUSTOMER: "/cliente",
  RESTAURANT: "/restaurante",
  COURIER: "/domiciliario",
};

export const ROLE_LABELS: Record<AccountRole, string> = {
  CUSTOMER: "Cliente",
  RESTAURANT: "Restaurante",
  COURIER: "Domiciliario",
};

export function getStoredActiveRole(): AccountRole | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.sessionStorage.getItem(ACTIVE_ROLE_STORAGE_KEY);
  if (value === "CUSTOMER" || value === "RESTAURANT" || value === "COURIER") {
    return value;
  }
  return null;
}

export function setStoredActiveRole(role: AccountRole): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(ACTIVE_ROLE_STORAGE_KEY, role);
}

export function clearStoredActiveRole(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(ACTIVE_ROLE_STORAGE_KEY);
}
