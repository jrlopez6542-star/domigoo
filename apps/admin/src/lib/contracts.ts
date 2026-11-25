export type VerificationOutcome = "APPROVED" | "REJECTED" | "NEEDS_CHANGES";

export type AdminLoginPayload = {
  email?: string;
  phoneE164?: string;
  password: string;
  client: "ADMIN";
};

export function buildAdminLoginPayload(identifier: string, password: string): AdminLoginPayload {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) {
    return { email: trimmed, password, client: "ADMIN" };
  }
  return { phoneE164: trimmed, password, client: "ADMIN" };
}

export type VerificationDecisionPayload = {
  outcome: VerificationOutcome;
  reasonCode: string;
  comment: string;
};

export function buildVerificationDecisionPayload(input: {
  outcome: VerificationOutcome;
  reasonCode: string;
  comment: string;
}): VerificationDecisionPayload {
  return {
    outcome: input.outcome,
    reasonCode: input.reasonCode.trim().toUpperCase(),
    comment: input.comment.trim(),
  };
}

export const VERIFICATION_OUTCOME_LABELS: Record<VerificationOutcome, string> = {
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  NEEDS_CHANGES: "Requiere cambios",
};

export function verificationOutcomeLabel(outcome: VerificationOutcome): string {
  return VERIFICATION_OUTCOME_LABELS[outcome];
}

export const VERIFICATION_OUTCOME_ACTION_LABELS: Record<VerificationOutcome, string> = {
  APPROVED: "Aprobar",
  REJECTED: "Rechazar",
  NEEDS_CHANGES: "Solicitar cambios",
};

export function verificationOutcomeActionLabel(outcome: VerificationOutcome): string {
  return VERIFICATION_OUTCOME_ACTION_LABELS[outcome];
}

export const VERIFICATION_STATUS_LABELS: Record<string, string> = {
  COLLECTING: "Recolectando documentos",
  SUBMITTED: "Enviado",
  AUTO_IN_PROGRESS: "En validación automática",
  PENDING_HUMAN: "Pendiente de revisión",
  NEEDS_CHANGES: "Requiere cambios",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
};

export function verificationCaseStatusLabel(status: string): string {
  return VERIFICATION_STATUS_LABELS[status] ?? status;
}

export type AdminSessionIdentity = {
  id?: string;
  email?: string | null;
  phoneE164?: string | null;
  displayName?: string | null;
  name?: string | null;
};

export function formatAdminSessionLabel(
  user: AdminSessionIdentity | null | undefined,
  fallbackIdentifier?: string,
): string {
  const candidate =
    user?.displayName?.trim() ||
    user?.name?.trim() ||
    user?.email?.trim() ||
    user?.phoneE164?.trim() ||
    fallbackIdentifier?.trim() ||
    "";
  return candidate ? `Sesión activa: ${candidate}` : "Sesión activa";
}

export function formatBogotaDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "Sin fecha";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
  });
}
