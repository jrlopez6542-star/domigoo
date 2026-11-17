#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const baseUrl = (process.env["STAGING_API_URL"] ?? "").trim().replace(/\/+$/, "");
if (baseUrl === "") {
  process.stderr.write(
    "Error: STAGING_API_URL es obligatoria (ej. https://domigoo-staging.vercel.app)\n",
  );
  process.exit(1);
}

const adminEmail = (process.env["STAGING_ADMIN_EMAIL"] ?? "reviewer-staging@example.com").trim();
const seedPassword = process.env["STAGING_SEED_PASSWORD"] ?? "staging-ficticia-no-prod-12";
const bypassSecret = (process.env["VERCEL_AUTOMATION_BYPASS_SECRET"] ?? "").trim();
const reportPath = (process.env["SMOKE_REPORT_PATH"] ?? "").trim();

const runTag = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const documentTypes = [
  "NATIONAL_ID",
  "DRIVER_LICENSE",
  "SOAT",
  "TECH_INSPECTION",
  "VEHICLE_PHOTO",
  "PROFILE_PHOTO",
];

const steps = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (bypassSecret !== "") {
    headers.set("x-vercel-protection-bypass", bypassSecret);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let json;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = text;
  }
  return { response, json, text };
}

async function jsonRequest(method, path, body, auth = {}) {
  const headers = new Headers(auth.headers ?? {});
  headers.set("content-type", "application/json");
  if (auth.cookie) {
    headers.set("cookie", auth.cookie);
  }
  if (auth.token) {
    headers.set("authorization", `Bearer ${auth.token}`);
  }
  const res = await apiFetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (auth.expectedStatus !== undefined && res.response.status !== auth.expectedStatus) {
    throw new Error(
      `${method} ${path} esperaba ${auth.expectedStatus}, recibió ${res.response.status}: ${res.text}`,
    );
  }
  return res;
}

function extractSessionCookie(response) {
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? (response.headers.getSetCookie()[0] ?? "")
      : (response.headers.get("set-cookie") ?? "");
  assert(setCookie.includes("domigoo_session="), "Falta cookie domigoo_session en la respuesta");
  return setCookie.split(";")[0];
}

async function runStep(number, name, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    steps.push({ step: number, name, status: "PASS", durationMs: Date.now() - startedAt, detail });
  } catch (error) {
    steps.push({
      step: number,
      name,
      status: "FAIL",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function main() {
  const startedAt = new Date().toISOString();

  await runStep(0, "Preflight /health y /ready", async () => {
    const health = await apiFetch("/health");
    assert(health.response.status === 200, `/health respondió ${health.response.status}`);
    const ready = await apiFetch("/ready");
    assert(ready.response.status === 200, `/ready respondió ${ready.response.status}`);
    return { health: health.response.status, ready: ready.response.status };
  });

  // Login del admin REVIEWER sembrado en staging
  const adminLogin = await jsonRequest(
    "POST",
    "/v1/auth/login",
    { email: adminEmail, password: seedPassword, client: "ADMIN" },
    { expectedStatus: 200 },
  );
  const adminCookie = extractSessionCookie(adminLogin.response);

  let ownerCookie = "";
  let restaurantId = "";
  let branchId = "";
  let courierToken = "";
  let verificationCaseId = "";
  let orderId = "";
  let offerId = "";
  let trackingToken = "";

  await runStep(1, "Restaurante se registra y envía a revisión", async () => {
    const ownerEmail = `owner-smoke-${runTag}@example.com`;
    const nit = `90${Date.now().toString().slice(-7)}`;
    const reg = await jsonRequest(
      "POST",
      "/v1/auth/register",
      { email: ownerEmail, password: seedPassword, client: "WEB" },
      { expectedStatus: 201 },
    );
    ownerCookie = extractSessionCookie(reg.response);

    const site = await jsonRequest(
      "POST",
      "/v1/restaurants",
      {
        legalName: `Razon Smoke ${runTag}`,
        tradeName: `Comercio Smoke ${runTag}`,
        nit,
        email: `local-${runTag}@example.com`,
        phoneE164: "+573000000201",
        establishmentName: `Sede Smoke ${runTag}`,
        branchName: "Principal",
        addressLine: "Calle Ficticia 20 # 5-10",
        longitude: -73.9132,
        latitude: 4.9655,
      },
      { cookie: ownerCookie, expectedStatus: 201 },
    );
    restaurantId = String(site.json.id);
    branchId = String(site.json.branchId);

    await jsonRequest(
      "PUT",
      `/v1/branches/${branchId}/hours`,
      { slots: [{ weekday: 1, opensMinute: 480, closesMinute: 1200 }] },
      { cookie: ownerCookie, expectedStatus: 200 },
    );
    await jsonRequest("POST", `/v1/branches/${branchId}/activate`, undefined, {
      cookie: ownerCookie,
      expectedStatus: 201,
    });
    await jsonRequest("POST", `/v1/restaurants/${restaurantId}/submit`, undefined, {
      cookie: ownerCookie,
      expectedStatus: 201,
    });
    return { restaurantId, branchId };
  });

  await runStep(2, "Admin (REVIEWER) verifica restaurante y abre suscripción TRIAL", async () => {
    const activated = await jsonRequest(
      "POST",
      `/v1/admin/restaurants/${restaurantId}/activate`,
      undefined,
      { cookie: adminCookie, expectedStatus: 201 },
    );
    assert(activated.json.status === "ACTIVE", "El restaurante no quedó ACTIVE");

    const plan = await jsonRequest(
      "POST",
      "/v1/admin/plans",
      {
        code: `SMK_${runTag.toUpperCase().slice(0, 12)}`,
        name: `Plan Smoke ${runTag}`,
        priceCop: 99000,
        periodDays: 30,
        trialDays: 14,
        maxBranches: 2,
        maxConcurrentOrders: 10,
      },
      { cookie: adminCookie, expectedStatus: 201 },
    );
    const sub = await jsonRequest(
      "POST",
      "/v1/admin/subscriptions",
      { restaurantId, planId: plan.json.id, status: "TRIAL" },
      { cookie: adminCookie, expectedStatus: 201 },
    );
    return { restaurantStatus: activated.json.status, subscriptionId: sub.json.id };
  });

  const docLegal = await jsonRequest(
    "POST",
    "/v1/legal-documents",
    {
      kind: "DOCUMENT_PROCESSING",
      version: `smk-doc-${runTag.slice(0, 10)}`,
      content: "Doc smoke staging",
    },
    { cookie: adminCookie, expectedStatus: 201 },
  );
  const gpsLegal = await jsonRequest(
    "POST",
    "/v1/legal-documents",
    {
      kind: "GEOLOCATION_CONSENT",
      version: `smk-gps-${runTag.slice(0, 10)}`,
      content: "GPS smoke staging",
    },
    { cookie: adminCookie, expectedStatus: 201 },
  );

  await runStep(3, "Domiciliario se registra y radica caso de verificación", async () => {
    const courierEmail = `courier-smoke-${runTag}@example.com`;
    const reg = await jsonRequest(
      "POST",
      "/v1/auth/register",
      { email: courierEmail, password: seedPassword, client: "MOBILE" },
      { expectedStatus: 201 },
    );
    courierToken = String(reg.json.token);

    await jsonRequest(
      "POST",
      "/v1/consents",
      { legalDocumentId: docLegal.json.id, purpose: "DOCUMENT_STORAGE", channel: "MOBILE" },
      { token: courierToken, expectedStatus: 201 },
    );
    await jsonRequest(
      "POST",
      "/v1/couriers",
      {
        documentType: "CC",
        documentNumber: `99${Date.now().toString().slice(-8)}`,
        firstName: "Mateo",
        lastName: "Smoke",
      },
      { token: courierToken, expectedStatus: 201 },
    );

    for (const type of documentTypes) {
      const form = new FormData();
      form.append("type", type);
      form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "sintetico.pdf");
      const upload = await apiFetch("/v1/couriers/me/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${courierToken}` },
        body: form,
      });
      assert(
        upload.response.status === 201,
        `Subida de ${type} respondió ${upload.response.status}`,
      );
    }

    await jsonRequest(
      "POST",
      "/v1/couriers/me/vehicle",
      {
        plate: `SMK${runTag.slice(0, 3).toUpperCase()}`,
        soatExpiresOn: "2028-04-01",
        techExpiresOn: "2028-08-01",
      },
      { token: courierToken, expectedStatus: 201 },
    );
    const vCase = await jsonRequest("POST", "/v1/couriers/me/verification-cases", undefined, {
      token: courierToken,
      expectedStatus: 201,
    });
    verificationCaseId = String(vCase.json.id);
    return { verificationCaseId };
  });

  await runStep(4, "Admin (REVIEWER) aprueba domiciliario", async () => {
    const decision = await jsonRequest(
      "POST",
      `/v1/admin/verification-cases/${verificationCaseId}/decision`,
      { outcome: "APPROVED", reasonCode: "DOCS_VERIFIED", comment: "Smoke staging" },
      { cookie: adminCookie, expectedStatus: 201 },
    );
    assert(decision.json.decided === true, "La decisión no confirmó decided=true");
    return { decided: true };
  });

  await runStep(
    5,
    "Domiciliario da consentimiento GEOLOCATION y pasa a AVAILABLE en zona",
    async () => {
      await jsonRequest(
        "POST",
        "/v1/consents",
        { legalDocumentId: gpsLegal.json.id, purpose: "GEOLOCATION", channel: "MOBILE" },
        { token: courierToken, expectedStatus: 201 },
      );
      await jsonRequest(
        "POST",
        "/v1/devices/push-token",
        { token: `fcm-smoke-${runTag}-123456` },
        { token: courierToken, expectedStatus: 201 },
      );
      await jsonRequest(
        "POST",
        "/v1/couriers/me/availability",
        { state: "AVAILABLE" },
        { token: courierToken, expectedStatus: 201 },
      );
      await jsonRequest(
        "POST",
        "/v1/couriers/me/location",
        { longitude: -73.918, latitude: 4.968, accuracyM: 10 },
        { token: courierToken, expectedStatus: 201 },
      );
      return { state: "AVAILABLE" };
    },
  );

  await runStep(6, "Restaurante publica pedido en modo OPEN", async () => {
    const draft = await jsonRequest(
      "POST",
      "/v1/orders",
      { branchId, foodAmountCop: 45000, deliveryFeeCop: 5500, paymentMethod: "CASH" },
      { cookie: ownerCookie, expectedStatus: 201 },
    );
    orderId = String(draft.json.id);

    const pub = await jsonRequest(
      "POST",
      `/v1/orders/${orderId}/publish`,
      {
        mode: "OPEN",
        customerName: "Cliente Smoke",
        customerPhone: "+573000000299",
        dropoffAddress: "Carrera 4 # 8-12",
        longitude: -73.92,
        latitude: 4.97,
      },
      { cookie: ownerCookie, expectedStatus: 201 },
    );
    assert(pub.json.status === "SEEKING_COURIER", "El pedido no quedó en SEEKING_COURIER");
    const offers = pub.json.offers ?? [];
    assert(offers.length >= 1, "No se generaron ofertas al publicar");
    offerId = String(offers[0].id);
    return { orderId, offersCount: offers.length };
  });

  await runStep(7, "Se distribuyen ofertas PENDING", async () => {
    assert(offerId !== "", "offerId vacío");
    return { offerId, status: "PENDING" };
  });

  await runStep(8, "Domiciliario acepta la oferta", async () => {
    const accepted = await jsonRequest(
      "POST",
      `/v1/offers/${offerId}/accept`,
      { ack: true },
      {
        token: courierToken,
        headers: { "idempotency-key": `smoke-accept-${runTag}` },
        expectedStatus: 201,
      },
    );
    assert(accepted.json.orderStatus === "ACCEPTED", "La orden no pasó a ACCEPTED");
    return { orderStatus: accepted.json.orderStatus };
  });

  await runStep(9, "arrive-pickup, at-pickup y validación de PIN de recogida", async () => {
    await jsonRequest("POST", `/v1/orders/${orderId}/arrive-pickup`, undefined, {
      token: courierToken,
      expectedStatus: 201,
    });
    await jsonRequest("POST", `/v1/orders/${orderId}/at-pickup`, undefined, {
      token: courierToken,
      expectedStatus: 201,
    });
    const restOrder = await jsonRequest("GET", `/v1/orders/${orderId}`, undefined, {
      cookie: ownerCookie,
      expectedStatus: 200,
    });
    const pickupPin = String(restOrder.json.pickupPin ?? "");
    assert(/^\d{6}$/.test(pickupPin), "pickupPin inválido");
    const picked = await jsonRequest(
      "POST",
      `/v1/orders/${orderId}/pickup-pin`,
      { pin: pickupPin },
      { token: courierToken, expectedStatus: 201 },
    );
    assert(picked.json.status === "PICKED_UP", "La orden no pasó a PICKED_UP");
    return { status: picked.json.status };
  });

  await runStep(10, "Actualización del trayecto (at-dropoff)", async () => {
    await jsonRequest("POST", `/v1/orders/${orderId}/at-dropoff`, undefined, {
      token: courierToken,
      expectedStatus: 201,
    });
    return { status: "AT_DROPOFF" };
  });

  await runStep(11, "Validación de PIN de entrega y finalización DELIVERED", async () => {
    const link = await jsonRequest("POST", `/v1/orders/${orderId}/tracking-link`, undefined, {
      cookie: ownerCookie,
      expectedStatus: 201,
    });
    trackingToken = String(link.json.token);

    const track = await jsonRequest("GET", `/v1/tracking/${trackingToken}`, undefined, {
      expectedStatus: 200,
    });
    const deliveryPin = String(track.json.deliveryPin ?? "");
    assert(/^\d{6}$/.test(deliveryPin), "deliveryPin inválido");

    const delivered = await jsonRequest(
      "POST",
      `/v1/orders/${orderId}/delivery-pin`,
      { pin: deliveryPin },
      { token: courierToken, expectedStatus: 201 },
    );
    assert(delivered.json.status === "DELIVERED", "La orden no pasó a DELIVERED");
    return { status: delivered.json.status };
  });

  await runStep(12, "GET /v1/orders/:id/events y tracking reflejan todos los estados", async () => {
    const eventsRes = await jsonRequest("GET", `/v1/orders/${orderId}/events`, undefined, {
      cookie: ownerCookie,
      expectedStatus: 200,
    });
    const actual = (eventsRes.json.events ?? []).map((e) => [e.fromStatus, e.toStatus]);
    const expected = [
      ["DRAFT", "SEEKING_COURIER"],
      ["SEEKING_COURIER", "ACCEPTED"],
      ["ACCEPTED", "ARRIVING_PICKUP"],
      ["ARRIVING_PICKUP", "AT_PICKUP"],
      ["AT_PICKUP", "PICKED_UP"],
      ["PICKED_UP", "AT_DROPOFF"],
      ["AT_DROPOFF", "DELIVERED"],
    ];
    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `Secuencia inesperada: ${JSON.stringify(actual)}`,
    );

    const trackFinal = await jsonRequest("GET", `/v1/tracking/${trackingToken}`, undefined, {
      expectedStatus: 200,
    });
    assert(trackFinal.json.status === "DELIVERED", "Tracking final no muestra DELIVERED");
    assert(
      trackFinal.json.deliveryPin === undefined,
      "Tracking en DELIVERED no debe exponer deliveryPin",
    );
    return { eventsCount: actual.length, trackingStatus: trackFinal.json.status };
  });

  const report = {
    ok: true,
    target: baseUrl,
    runTag,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath !== "") {
    writeFileSync(reportPath, output, "utf8");
  }
  process.stdout.write(output);
}

main().catch((error) => {
  const report = {
    ok: false,
    target: baseUrl,
    runTag,
    error: error instanceof Error ? error.message : String(error),
    steps,
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath !== "") {
    writeFileSync(reportPath, output, "utf8");
  }
  process.stderr.write(output);
  process.exit(1);
});
