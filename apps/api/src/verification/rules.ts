import { MAX_DOCUMENT_BYTES } from "../storage/object-storage.js";

export const RULE_CODES = [
  "REQUIRED_DOCUMENTS",
  "FILE_BOUNDS",
  "VEHICLE_MOTORCYCLE",
  "PLATE_UNIQUE",
  "SOAT_VALID",
  "TECH_VALID",
  "IDENTITY_UNIQUE",
] as const;

export type RuleCode = (typeof RULE_CODES)[number];

export type RuleCheck = {
  code: RuleCode;
  outcome: "PASS" | "FAIL" | "NOT_APPLICABLE";
  detail: Record<string, unknown>;
};

export type RuleDocument = {
  type: string;
  mimeType: string;
  byteSize: number;
  status: string;
};

export type RuleVehicle = {
  type: string;
  plate: string;
  status: string;
  soatExpiresOn: string;
  techExpiresOn: string;
};

export type RuleFacts = {
  documents: RuleDocument[];
  vehicle: RuleVehicle | null;
  otherActivePlate: boolean;
  otherIdentity: boolean;
  today: string;
};

const REQUIRED = [
  "NATIONAL_ID",
  "DRIVER_LICENSE",
  "SOAT",
  "TECH_INSPECTION",
  "VEHICLE_PHOTO",
  "PROFILE_PHOTO",
] as const;

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg"]);

export function evaluateRules(facts: RuleFacts): RuleCheck[] {
  const present = facts.documents.filter(
    (document) => document.status === "UPLOADED" || document.status === "ACCEPTED",
  );
  const presentTypes = new Set(present.map((document) => document.type));
  const missing = REQUIRED.filter((type) => !presentTypes.has(type));
  const vehicle = facts.vehicle;

  return [
    check(
      "REQUIRED_DOCUMENTS",
      missing.length === 0 ? "PASS" : "FAIL",
      missing.length === 0 ? {} : { missing },
    ),
    fileBounds(present),
    check(
      "VEHICLE_MOTORCYCLE",
      vehicle !== null && vehicle.status === "ACTIVE" && vehicle.type === "MOTORCYCLE"
        ? "PASS"
        : "FAIL",
      {},
    ),
    vehicle === null
      ? check("PLATE_UNIQUE", "NOT_APPLICABLE", {})
      : check("PLATE_UNIQUE", facts.otherActivePlate ? "FAIL" : "PASS", {}),
    dateCheck("SOAT_VALID", vehicle?.soatExpiresOn, facts.today),
    dateCheck("TECH_VALID", vehicle?.techExpiresOn, facts.today),
    check("IDENTITY_UNIQUE", facts.otherIdentity ? "FAIL" : "PASS", {}),
  ];
}

export function decideCase(checks: RuleCheck[]): "NEEDS_CHANGES" | "PENDING_HUMAN" {
  return checks.some((item) => item.outcome === "FAIL") ? "NEEDS_CHANGES" : "PENDING_HUMAN";
}

export function todayInBogota(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function fileBounds(documents: RuleDocument[]): RuleCheck {
  if (documents.length === 0) {
    return check("FILE_BOUNDS", "NOT_APPLICABLE", {});
  }
  const invalid = documents.filter(
    (document) =>
      !ALLOWED_MIME.has(document.mimeType) ||
      document.byteSize <= 0 ||
      document.byteSize > MAX_DOCUMENT_BYTES,
  );
  return check(
    "FILE_BOUNDS",
    invalid.length === 0 ? "PASS" : "FAIL",
    invalid.length === 0 ? {} : { invalid: invalid.map((document) => document.type) },
  );
}

function dateCheck(
  code: "SOAT_VALID" | "TECH_VALID",
  expiresOn: string | undefined,
  today: string,
): RuleCheck {
  if (expiresOn === undefined) {
    return check(code, "NOT_APPLICABLE", {});
  }
  return check(code, expiresOn > today ? "PASS" : "FAIL", { expiresOn, today });
}

function check(
  code: RuleCode,
  outcome: RuleCheck["outcome"],
  detail: Record<string, unknown>,
): RuleCheck {
  return { code, outcome, detail };
}
