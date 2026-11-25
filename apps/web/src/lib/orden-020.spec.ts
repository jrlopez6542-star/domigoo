import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { GET, POST, PUT } from "../app/api/proxy/[...path]/route.js";
import { ProxyError } from "./api-client.js";
import {
  BRANCH_INACTIVE_MESSAGE,
  BRANCH_STATUS_LABELS,
  COURIER_STATUS_LABELS,
  RESTAURANT_DISABLED_MESSAGE,
  RESTAURANT_DRAFT_MESSAGE,
  RESTAURANT_INACTIVE_MESSAGE,
  RESTAURANT_STATUS_LABELS,
  branchStatusLabel,
  buildBranchHoursSlots,
  courierStatusLabel,
  formatBogotaDateTime,
  getRestaurantInactiveMessage,
  resolveRestaurantOrderActionError,
  restaurantStatusLabel,
} from "./portal-helpers.js";

describe("ORDEN 020 - Web: mensajes por estado, alta de restaurante, proxy y limpieza de códigos/fechas", () => {
  it("getRestaurantInactiveMessage devuelve el mensaje exacto según estado del restaurante y sucursal", () => {
    expect(getRestaurantInactiveMessage(undefined)).toBeNull();
    expect(getRestaurantInactiveMessage({ status: "DRAFT", restaurantStatus: "DRAFT" })).toBe(
      RESTAURANT_DRAFT_MESSAGE,
    );
    expect(getRestaurantInactiveMessage({ status: "ACTIVE", restaurantStatus: "DRAFT" })).toBe(
      RESTAURANT_DRAFT_MESSAGE,
    );
    expect(
      getRestaurantInactiveMessage({ status: "ACTIVE", restaurantStatus: "PENDING_REVIEW" }),
    ).toBe(RESTAURANT_INACTIVE_MESSAGE);
    expect(getRestaurantInactiveMessage({ status: "ACTIVE", restaurantStatus: "SUSPENDED" })).toBe(
      RESTAURANT_DISABLED_MESSAGE,
    );
    expect(getRestaurantInactiveMessage({ status: "ACTIVE", restaurantStatus: "CLOSED" })).toBe(
      RESTAURANT_DISABLED_MESSAGE,
    );
    expect(getRestaurantInactiveMessage({ status: "DRAFT", restaurantStatus: "ACTIVE" })).toBe(
      BRANCH_INACTIVE_MESSAGE,
    );
    expect(getRestaurantInactiveMessage({ status: "PAUSED", restaurantStatus: "ACTIVE" })).toBe(
      BRANCH_INACTIVE_MESSAGE,
    );
    expect(
      getRestaurantInactiveMessage({ status: "ACTIVE", restaurantStatus: "ACTIVE" }),
    ).toBeNull();
  });

  it("resolveRestaurantOrderActionError usa el mensaje del estado conocido en 404 y el de 019 como respaldo", () => {
    expect(
      resolveRestaurantOrderActionError(new ProxyError("Not Found", 404), "Error", {
        status: "DRAFT",
        restaurantStatus: "DRAFT",
      }),
    ).toBe(RESTAURANT_DRAFT_MESSAGE);
    expect(
      resolveRestaurantOrderActionError(new ProxyError("Not Found", 404), "Error", {
        status: "DRAFT",
        restaurantStatus: "ACTIVE",
      }),
    ).toBe(BRANCH_INACTIVE_MESSAGE);
    expect(
      resolveRestaurantOrderActionError(new ProxyError("Not Found", 404), "Error", {
        status: "ACTIVE",
        restaurantStatus: "SUSPENDED",
      }),
    ).toBe(RESTAURANT_DISABLED_MESSAGE);
    expect(
      resolveRestaurantOrderActionError(new ProxyError("Not Found", 404), "Error", undefined),
    ).toBe(RESTAURANT_INACTIVE_MESSAGE);
  });

  it("etiquetas de restaurante, sucursal y domiciliario están en español sin códigos entre paréntesis", () => {
    for (const [code, label] of Object.entries(RESTAURANT_STATUS_LABELS)) {
      expect(restaurantStatusLabel(code)).toBe(label);
      expect(label).not.toMatch(/\([A-Z_]{3,}\)/);
    }
    for (const [code, label] of Object.entries(BRANCH_STATUS_LABELS)) {
      expect(branchStatusLabel(code)).toBe(label);
      expect(label).not.toMatch(/\([A-Z_]{3,}\)/);
    }
    for (const [code, label] of Object.entries(COURIER_STATUS_LABELS)) {
      expect(courierStatusLabel(code)).toBe(label);
      expect(label).not.toMatch(/\([A-Z_]{3,}\)/);
    }
  });

  it("buildBranchHoursSlots genera slots válidos para readSlots y valida errores en español", () => {
    const ok = buildBranchHoursSlots({
      weekdays: [5, 1, 1, 3],
      opensTime: "08:30",
      closesTime: "21:00",
    });
    expect(ok).toEqual({
      ok: true,
      slots: [
        { weekday: 1, opensMinute: 510, closesMinute: 1260, closed: false },
        { weekday: 3, opensMinute: 510, closesMinute: 1260, closed: false },
        { weekday: 5, opensMinute: 510, closesMinute: 1260, closed: false },
      ],
    });

    expect(
      buildBranchHoursSlots({ weekdays: [], opensTime: "08:00", closesTime: "20:00" }).ok,
    ).toBe(false);
    expect(
      buildBranchHoursSlots({ weekdays: [1], opensTime: "20:00", closesTime: "08:00" }).ok,
    ).toBe(false);
    expect(
      buildBranchHoursSlots({ weekdays: [1], opensTime: "invalida", closesTime: "20:00" }).ok,
    ).toBe(false);
  });

  it("formatBogotaDateTime formatea ISO a es-CO en zona America/Bogota", () => {
    const formatted = formatBogotaDateTime("2026-11-24T15:30:00.000Z");
    expect(formatted).not.toBe("2026-11-24T15:30:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatBogotaDateTime("no-fecha")).toBe("no-fecha");
  });

  it("proxy web permite solo branches/<id>/hours, branches/<id>/activate y restaurants/<id>/submit y bloquea el resto con 404", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiBaseUrl = process.env["NEXT_PUBLIC_API_BASE_URL"];
    const originalServerApiBaseUrl = process.env["API_BASE_URL"];
    process.env["NEXT_PUBLIC_API_BASE_URL"] = "https://api.domigoo.test";
    // getWebServerConfig() lee API_BASE_URL (no NEXT_PUBLIC_*): se fija para comprobar la URL exacta.
    process.env["API_BASE_URL"] = "https://api.domigoo.test";
    const fetched: Array<{ method: string; url: string }> = [];
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      fetched.push({
        method: init?.method ?? "GET",
        url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };

    try {
      const hoursRes = await PUT(
        new NextRequest("http://localhost:3000/api/proxy/branches/branch-1/hours", {
          method: "PUT",
          body: JSON.stringify({ slots: [] }),
        }),
        { params: Promise.resolve({ path: ["branches", "branch-1", "hours"] }) },
      );
      expect(hoursRes.status).toBe(200);

      const activateRes = await POST(
        new NextRequest("http://localhost:3000/api/proxy/branches/branch-1/activate", {
          method: "POST",
          body: "{}",
        }),
        { params: Promise.resolve({ path: ["branches", "branch-1", "activate"] }) },
      );
      expect(activateRes.status).toBe(200);

      const submitRes = await POST(
        new NextRequest("http://localhost:3000/api/proxy/restaurants/rest-1/submit", {
          method: "POST",
          body: "{}",
        }),
        { params: Promise.resolve({ path: ["restaurants", "rest-1", "submit"] }) },
      );
      expect(submitRes.status).toBe(200);

      expect(fetched).toHaveLength(3);
      expect(fetched[0]?.method).toBe("PUT");
      expect(fetched[0]?.url).toBe("https://api.domigoo.test/v1/branches/branch-1/hours");
      expect(fetched[1]?.method).toBe("POST");
      expect(fetched[1]?.url).toBe("https://api.domigoo.test/v1/branches/branch-1/activate");
      expect(fetched[2]?.method).toBe("POST");
      expect(fetched[2]?.url).toBe("https://api.domigoo.test/v1/restaurants/rest-1/submit");

      const blockedSegments: string[][] = [
        ["branches"],
        ["branches", "branch-1"],
        ["branches", "branch-1", "other"],
        ["branches", "branch-1", "hours", "extra"],
        ["branches", "branch-1", "activate", "extra"],
        ["branches", "", "hours"],
        ["branches", "..", "hours"],
        ["restaurants", "rest-1"],
        ["restaurants", "rest-1", "members"],
        ["restaurants", "rest-1", "members", "user-1"],
        ["restaurants", "rest-1", "site"],
        ["restaurants", "rest-1", "activate"],
        ["restaurants", "rest-1", "submit", "extra"],
        ["restaurants", "..", "submit"],
      ];

      for (const segments of blockedSegments) {
        const resGet = await GET(
          new NextRequest(`http://localhost:3000/api/proxy/${segments.join("/")}`, {
            method: "GET",
          }),
          { params: Promise.resolve({ path: segments }) },
        );
        expect(resGet.status).toBe(404);

        const resPost = await POST(
          new NextRequest(`http://localhost:3000/api/proxy/${segments.join("/")}`, {
            method: "POST",
            body: "{}",
          }),
          { params: Promise.resolve({ path: segments }) },
        );
        expect(resPost.status).toBe(404);
      }

      // Metodo distinto al necesario o id con caracteres fuera de [A-Za-z0-9_-] -> 404.
      const wrongMethod: Array<{ handler: typeof GET; method: string; segments: string[] }> = [
        { handler: GET, method: "GET", segments: ["branches", "branch-1", "hours"] },
        { handler: POST, method: "POST", segments: ["branches", "branch-1", "hours"] },
        { handler: PUT, method: "PUT", segments: ["branches", "branch-1", "activate"] },
        { handler: GET, method: "GET", segments: ["restaurants", "rest-1", "submit"] },
        { handler: POST, method: "POST", segments: ["restaurants", "rest%3F1", "submit"] },
        { handler: POST, method: "POST", segments: ["branches", "a".repeat(65), "activate"] },
      ];
      for (const { handler, method, segments } of wrongMethod) {
        const res = await handler(
          new NextRequest(`http://localhost:3000/api/proxy/${segments.join("/")}`, {
            method,
            ...(method === "GET" ? {} : { body: "{}" }),
          }),
          { params: Promise.resolve({ path: segments }) },
        );
        expect(res.status).toBe(404);
      }

      expect(fetched).toHaveLength(3);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiBaseUrl === undefined) {
        delete process.env["NEXT_PUBLIC_API_BASE_URL"];
      } else {
        process.env["NEXT_PUBLIC_API_BASE_URL"] = originalApiBaseUrl;
      }
      if (originalServerApiBaseUrl === undefined) {
        delete process.env["API_BASE_URL"];
      } else {
        process.env["API_BASE_URL"] = originalServerApiBaseUrl;
      }
    }
  });

  it("courier-portal.tsx y restaurant-portal.tsx no muestran códigos crudos ni ISO crudo, y Mi negocio incluye alta completa con objetivos táctiles >=44px", () => {
    const courierTsx = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/courier-portal.tsx"),
      "utf8",
    );
    expect(courierTsx).not.toContain("Perfil de domiciliario creado (${data.status})");
    expect(courierTsx).not.toContain("Oferta rechazada (${data.status})");
    expect(courierTsx).toContain("courierStatusLabel(data.status)");

    const restaurantTsx = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/restaurant-portal.tsx"),
      "utf8",
    );
    expect(restaurantTsx).not.toContain("({ev.createdAt})");
    expect(restaurantTsx).toContain("formatBogotaDateTime(ev.createdAt)");
    expect(restaurantTsx).toContain("Activar sucursal");
    expect(restaurantTsx).toContain("Enviar registro a revisión");
    expect(restaurantTsx).toContain("Guardar horario");
    expect(restaurantTsx).toContain("restaurantStatusLabel(");
    expect(restaurantTsx).toContain("branchStatusLabel(");

    const css = fs.readFileSync(path.resolve(process.cwd(), "src/styles/domigoo.css"), "utf8");
    expect(css).toMatch(/\.dg-weekday-option\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.dg-weekday-option\s*\{[^}]*min-width:\s*0/);
  });
});
