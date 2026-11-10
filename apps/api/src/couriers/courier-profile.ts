export type CourierProfile = {
  documentType: "CC" | "CE";
  documentNumber: string;
  firstName: string;
  lastName: string;
};

export function readCourierProfile(body: unknown): CourierProfile | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record["documentType"] !== "CC" && record["documentType"] !== "CE") {
    return null;
  }
  const documentNumber = normalizeDocument(record["documentNumber"]);
  const firstName = personName(record["firstName"]);
  const lastName = personName(record["lastName"]);
  if (documentNumber === null || firstName === null || lastName === null) {
    return null;
  }
  return { documentType: record["documentType"], documentNumber, firstName, lastName };
}

function normalizeDocument(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replaceAll(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function personName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const name = value.trim().replaceAll(/\s+/g, " ");
  if (name.length < 1 || name.length > 80) {
    return null;
  }
  return name;
}
