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

export const RESTAURANT_DRAFT_MESSAGE =
  "Tu registro aún no se ha enviado a revisión. Complétalo en Mi negocio y envíalo.";

export const RESTAURANT_DISABLED_MESSAGE =
  "Tu restaurante no está habilitado para crear domicilios. Comunícate con DOMIGOO.";

export const BRANCH_INACTIVE_MESSAGE =
  "Activa tu sucursal en Mi negocio (horario y punto) para crear domicilios.";

export type RestaurantBranchState = {
  status: string;
  restaurantStatus?: string;
};

export function getRestaurantInactiveMessage(
  branch: RestaurantBranchState | undefined,
): string | null {
  if (!branch) {
    return null;
  }
  const restStatus = branch.restaurantStatus;
  if (restStatus === "DRAFT") {
    return RESTAURANT_DRAFT_MESSAGE;
  }
  if (restStatus === "PENDING_REVIEW") {
    return RESTAURANT_INACTIVE_MESSAGE;
  }
  if (restStatus === "SUSPENDED" || restStatus === "CLOSED") {
    return RESTAURANT_DISABLED_MESSAGE;
  }
  if (restStatus === "ACTIVE") {
    return branch.status !== "ACTIVE" ? BRANCH_INACTIVE_MESSAGE : null;
  }
  if (restStatus !== undefined) {
    return RESTAURANT_INACTIVE_MESSAGE;
  }
  return branch.status !== "ACTIVE" ? RESTAURANT_INACTIVE_MESSAGE : null;
}

export function isRestaurantOrBranchInactive(branch: RestaurantBranchState | undefined): boolean {
  return getRestaurantInactiveMessage(branch) !== null;
}

export function resolveRestaurantOrderActionError(
  err: unknown,
  fallbackMessage: string,
  branch?: RestaurantBranchState,
): string {
  if (err instanceof Error && "status" in err && (err as { status?: unknown }).status === 404) {
    return getRestaurantInactiveMessage(branch) ?? RESTAURANT_INACTIVE_MESSAGE;
  }
  return err instanceof Error ? err.message : fallbackMessage;
}

export const RESTAURANT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "En borrador",
  PENDING_REVIEW: "En revisión",
  ACTIVE: "Activo",
  SUSPENDED: "Suspendido",
  CLOSED: "Cerrado",
};

export function restaurantStatusLabel(status: string | undefined): string {
  if (!status) {
    return "Sin confirmar";
  }
  return RESTAURANT_STATUS_LABELS[status] ?? status;
}

export const BRANCH_STATUS_LABELS: Record<string, string> = {
  DRAFT: "En borrador",
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  CLOSED: "Cerrada",
};

export function branchStatusLabel(status: string): string {
  return BRANCH_STATUS_LABELS[status] ?? status;
}

export const COURIER_STATUS_LABELS: Record<string, string> = {
  REGISTERING: "En registro",
  PENDING_VERIFICATION: "Pendiente de verificación",
  NEEDS_CHANGES: "Requiere cambios",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  SUSPENDED: "Suspendido",
};

export function courierStatusLabel(status: string): string {
  return COURIER_STATUS_LABELS[status] ?? status;
}

export function formatBogotaDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
  });
}

export const WEEKDAY_OPTIONS: ReadonlyArray<{ weekday: number; label: string }> = [
  { weekday: 1, label: "Lunes" },
  { weekday: 2, label: "Martes" },
  { weekday: 3, label: "Miércoles" },
  { weekday: 4, label: "Jueves" },
  { weekday: 5, label: "Viernes" },
  { weekday: 6, label: "Sábado" },
  { weekday: 7, label: "Domingo" },
];

export type BranchHourSlot = {
  weekday: number;
  opensMinute: number;
  closesMinute: number;
  closed: boolean;
};

function parseTimeToMinutes(raw: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function buildBranchHoursSlots(input: {
  weekdays: number[];
  opensTime: string;
  closesTime: string;
}): { ok: true; slots: BranchHourSlot[] } | { ok: false; message: string } {
  const uniqueDays = Array.from(
    new Set(input.weekdays.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)),
  ).sort((a, b) => a - b);
  if (uniqueDays.length === 0) {
    return { ok: false, message: "Selecciona al menos un día de atención." };
  }
  const opensMinute = parseTimeToMinutes(input.opensTime);
  const parsedClose = parseTimeToMinutes(input.closesTime);
  if (opensMinute === null || parsedClose === null) {
    return { ok: false, message: "Ingresa horas válidas de apertura y cierre." };
  }
  const closesMinute = parsedClose === 0 && opensMinute > 0 ? 1440 : parsedClose;
  if (closesMinute <= opensMinute) {
    return { ok: false, message: "La hora de cierre debe ser posterior a la de apertura." };
  }
  return {
    ok: true,
    slots: uniqueDays.map((weekday) => ({
      weekday,
      opensMinute,
      closesMinute,
      closed: false,
    })),
  };
}

export const MIXED_BRANCH_HOURS_NOTICE =
  "Esta sucursal tiene horarios distintos por día. Se muestra el del primer día abierto y al guardar se aplicará un solo horario a todos los días marcados.";

export type HydratedBranchHours = {
  weekdays: number[];
  opensTime: string;
  closesTime: string;
  hasMixedSchedule: boolean;
  notice: string | null;
};

export function minutesToTimeString(minutes: number, options?: { isClosing?: boolean }): string {
  const truncated = Math.trunc(minutes);
  if (options?.isClosing && truncated === 1440) {
    return "00:00";
  }
  const clamped = Math.max(0, Math.min(1439, truncated));
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function branchHoursSignature(hours: ReadonlyArray<BranchHourSlot> | undefined): string {
  if (!hours || hours.length === 0) {
    return "[]";
  }
  return JSON.stringify(
    hours.map((slot) => ({
      weekday: slot.weekday,
      opensMinute: slot.opensMinute,
      closesMinute: slot.closesMinute,
      closed: slot.closed,
    })),
  );
}

export function parseBranchHoursSignature(signature: string): BranchHourSlot[] | undefined {
  try {
    const parsed: unknown = JSON.parse(signature);
    if (Array.isArray(parsed)) {
      return parsed as BranchHourSlot[];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function hydrateBranchHoursForm(
  hours: ReadonlyArray<BranchHourSlot> | undefined,
): HydratedBranchHours {
  if (!hours || hours.length === 0) {
    return {
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      opensTime: "08:00",
      closesTime: "21:00",
      hasMixedSchedule: false,
      notice: null,
    };
  }
  const openSlots = hours
    .filter(
      (slot) =>
        !slot.closed && Number.isInteger(slot.weekday) && slot.weekday >= 1 && slot.weekday <= 7,
    )
    .sort((a, b) => a.weekday - b.weekday || a.opensMinute - b.opensMinute);

  const first = openSlots[0];
  if (!first) {
    return {
      weekdays: [],
      opensTime: "08:00",
      closesTime: "21:00",
      hasMixedSchedule: false,
      notice: null,
    };
  }

  const weekdays = Array.from(new Set(openSlots.map((slot) => slot.weekday)));
  const hasMixedSchedule = openSlots.some(
    (slot) => slot.opensMinute !== first.opensMinute || slot.closesMinute !== first.closesMinute,
  );
  return {
    weekdays,
    opensTime: minutesToTimeString(first.opensMinute),
    closesTime: minutesToTimeString(first.closesMinute, { isClosing: true }),
    hasMixedSchedule,
    notice: hasMixedSchedule ? MIXED_BRANCH_HOURS_NOTICE : null,
  };
}
