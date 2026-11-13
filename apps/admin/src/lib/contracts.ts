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
