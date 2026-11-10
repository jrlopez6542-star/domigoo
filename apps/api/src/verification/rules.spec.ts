import { evaluateRules, decideCase, type RuleFacts, type RuleVehicle } from "./rules.js";

const today = "2026-11-10";
const vehicle: RuleVehicle = {
  type: "MOTORCYCLE",
  plate: "ABC12D",
  status: "ACTIVE",
  soatExpiresOn: "2027-01-15",
  techExpiresOn: "2027-06-01",
};
const types = [
  "NATIONAL_ID",
  "DRIVER_LICENSE",
  "SOAT",
  "TECH_INSPECTION",
  "VEHICLE_PHOTO",
  "PROFILE_PHOTO",
];

function documents(mimeType = "application/pdf", byteSize = 120): RuleFacts["documents"] {
  return types.map((type) => ({ type, mimeType, byteSize, status: "UPLOADED" }));
}

function facts(overrides: Partial<RuleFacts> = {}): RuleFacts {
  return {
    documents: documents(),
    vehicle,
    otherActivePlate: false,
    otherIdentity: false,
    today,
    ...overrides,
  };
}

describe("reglas automáticas", () => {
  const table: { name: string; facts: RuleFacts; failed: string }[] = [
    {
      name: "falta un documento",
      facts: facts({ documents: documents().filter((item) => item.type !== "PROFILE_PHOTO") }),
      failed: "REQUIRED_DOCUMENTS",
    },
    {
      name: "SOAT vencido",
      facts: facts({ vehicle: { ...vehicle, soatExpiresOn: "2026-11-10" } }),
      failed: "SOAT_VALID",
    },
    {
      name: "placa repetida",
      facts: facts({ otherActivePlate: true }),
      failed: "PLATE_UNIQUE",
    },
    {
      name: "expediente completo",
      facts: facts(),
      failed: "",
    },
  ];

  it.each(table)("$name no termina en APPROVED", (row) => {
    const checks = evaluateRules(row.facts);
    expect(decideCase(checks)).toBe(row.failed === "" ? "PENDING_HUMAN" : "NEEDS_CHANGES");
    expect(checks.map((item) => item.code)).toEqual([
      "REQUIRED_DOCUMENTS",
      "FILE_BOUNDS",
      "VEHICLE_MOTORCYCLE",
      "PLATE_UNIQUE",
      "SOAT_VALID",
      "TECH_VALID",
      "IDENTITY_UNIQUE",
    ]);
    const failed = checks.find((item) => item.outcome === "FAIL")?.code ?? "";
    expect(failed).toBe(row.failed);
  });

  it("rechaza un MIME ajeno y un archivo por encima de 10 MB", () => {
    const mime = evaluateRules(facts({ documents: documents("application/x-msdownload") }));
    expect(mime.find((item) => item.code === "FILE_BOUNDS")?.outcome).toBe("FAIL");
    const huge = evaluateRules(
      facts({ documents: documents("application/pdf", 10 * 1024 * 1024 + 1) }),
    );
    expect(huge.find((item) => item.code === "FILE_BOUNDS")?.outcome).toBe("FAIL");
    expect(decideCase(mime)).toBe("NEEDS_CHANGES");
  });
});
