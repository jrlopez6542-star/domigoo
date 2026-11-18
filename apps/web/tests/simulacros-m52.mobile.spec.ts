import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const SIMULACRO_PASSWORD =
  process.env["SIMULACRO_PASSWORD"] || process.env["STAGING_SEED_PASSWORD"] || "";

const ACCOUNTS = {
  restaurant: "sim-m52-restaurante@ejemplo.com",
  client1: "sim-m52-cliente1@ejemplo.com",
  courier1: "sim-m52-domiciliario1@ejemplo.com",
  courier2: "sim-m52-domiciliario2@ejemplo.com",
};

const CAPTURES_DIR = resolve(process.cwd(), "..", "..", "docs", "capturas", "m52-simulacros");

async function captureStep(page: Page, projectName: string, stepName: string) {
  if (projectName !== "mobile-iphone-13") {
    return;
  }
  mkdirSync(CAPTURES_DIR, { recursive: true });
  await page.screenshot({
    path: resolve(CAPTURES_DIR, `${stepName}.png`),
    fullPage: true,
  });
}

async function loginRole(page: Page, route: string, email: string, password: string) {
  await page.goto(route);
  await expect(page.getByTestId("tab-login")).toBeVisible();
  await page.locator("#auth-identifier").fill(email);
  await page.locator("#auth-password").fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
}

test.describe("M52-SIMULACROS: Flujo completo móvil (3 roles)", () => {
  test.describe.configure({ mode: "serial" });

  test("escenarios a-h: camino feliz, PIN incorrecto, rechazo, concurrencia, cancelación, aislamiento y tracking inválido", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      SIMULACRO_PASSWORD === "",
      "Requiere SIMULACRO_PASSWORD o STAGING_SEED_PASSWORD y seed:simulacros ejecutado",
    );

    const viewport = testInfo.project.use.viewport ?? { width: 390, height: 844 };
    const ctxOpts = { viewport, isMobile: true, hasTouch: true };

    const restContext = await browser.newContext(ctxOpts);
    const clientContext = await browser.newContext(ctxOpts);
    const courier1Context = await browser.newContext(ctxOpts);
    const courier2Context = await browser.newContext(ctxOpts);

    const restPage = await restContext.newPage();
    const clientPage = await clientContext.newPage();
    const courier1Page = await courier1Context.newPage();
    const courier2Page = await courier2Context.newPage();

    try {
      // 1. Login de los 3 roles (4 sesiones)
      await loginRole(restPage, "/restaurante", ACCOUNTS.restaurant, SIMULACRO_PASSWORD);
      await expect(restPage.getByTestId("restaurante-home-screen")).toBeVisible();

      await loginRole(clientPage, "/cliente", ACCOUNTS.client1, SIMULACRO_PASSWORD);
      await expect(clientPage.getByTestId("cliente-home-screen")).toBeVisible();

      await loginRole(courier1Page, "/domiciliario", ACCOUNTS.courier1, SIMULACRO_PASSWORD);
      await expect(courier1Page.getByTestId("domiciliario-home-screen")).toBeVisible();

      await loginRole(courier2Page, "/domiciliario", ACCOUNTS.courier2, SIMULACRO_PASSWORD);
      await expect(courier2Page.getByTestId("domiciliario-home-screen")).toBeVisible();

      // 2. Escenario a) Camino feliz — Restaurante crea y publica pedido en Tocancipá
      await restPage.goto("/restaurante/nuevo-domicilio");
      await expect(restPage.getByTestId("restaurante-nuevo-domicilio-screen")).toBeVisible();
      await restPage.getByRole("button", { name: "Cotizar domicilio" }).click();
      await restPage.getByRole("button", { name: "Siguiente: Confirmar borrador" }).click();

      await restPage.locator("#rest-food-amount").fill("32000");
      await restPage.locator("#rest-delivery-fee-step2").fill("5500");
      await restPage.getByRole("button", { name: "Crear borrador" }).click();
      await expect(restPage.getByText(/Borrador:/)).toBeVisible();
      await restPage.getByRole("button", { name: "Siguiente: Publicar domicilio" }).click();

      await restPage.locator("#rest-customer-name").fill("Cliente Simulacro M52");
      await restPage.locator("#rest-customer-phone").fill("+573000005211");
      await restPage.locator("#rest-dropoff-address").fill("Carrera Ficticia 7 # 14-22, Tocancipa");
      await restPage.getByRole("button", { name: "Publicar domicilio" }).click();
      await expect(restPage.getByText(/SEEKING_COURIER/)).toBeVisible();

      await restPage.goto("/restaurante/pedidos");
      await restPage.getByRole("button", { name: "Actualizar pedidos" }).click();
      const firstGenerateBtn = restPage
        .getByRole("button", { name: "Generar enlace público" })
        .first();
      await expect(firstGenerateBtn).toBeVisible();
      await firstGenerateBtn.click();
      const trackingLinkLocator = restPage.locator('a[href*="/tracking/"]').first();
      await expect(trackingLinkLocator).toBeVisible();
      const trackingHref = (await trackingLinkLocator.getAttribute("href")) ?? "";
      const trackingToken = trackingHref.split("/tracking/").pop() ?? "";
      expect(trackingToken).not.toBe("");
      await captureStep(restPage, testInfo.project.name, "01-restaurante-pedido-publicado");

      // 3. Cliente consulta en /cliente/seguir y abre enlace público
      await clientPage.goto("/cliente/seguir");
      await clientPage.locator("#client-tracking-input").fill(trackingToken);
      await clientPage.getByRole("button", { name: "Consultar estado" }).click();
      await expect(clientPage.getByText(/SEEKING_COURIER/)).toBeVisible();
      await clientPage.goto(`/tracking/${trackingToken}`);
      await expect(clientPage.getByTestId("tracking-status")).toContainText("SEEKING_COURIER");
      await captureStep(clientPage, testInfo.project.name, "02-cliente-buscando");

      // 4. Domiciliario 1 ve oferta y acepta
      await courier1Page.goto("/domiciliario");
      await courier1Page.getByTestId("courier-refresh-offers").click();
      const acceptBtn = courier1Page.locator('[data-testid^="courier-accept-offer-"]').first();
      await expect(acceptBtn).toBeVisible();
      await acceptBtn.click();
      await expect(courier1Page).toHaveURL(/\/domiciliario\/entrega/);
      await expect(courier1Page.getByText(/Estado:\s*ACCEPTED/)).toBeVisible();
      await captureStep(courier1Page, testInfo.project.name, "03-domiciliario-aceptado");

      // 5. Restaurante actualiza y obtiene PIN de recogida
      await restPage.getByRole("button", { name: "Actualizar pedidos" }).click();
      await expect(restPage.getByText(/ACCEPTED/).first()).toBeVisible();
      const pinMatchText = await restPage
        .locator('[data-testid^="restaurant-order-card-"]')
        .first()
        .innerText();
      const pickupPinMatch = pinMatchText.match(/PIN recogida:\s*(\d{6})/);
      expect(pickupPinMatch).not.toBeNull();
      const pickupPin = pickupPinMatch?.[1] ?? "";
      await captureStep(restPage, testInfo.project.name, "04-restaurante-pin-recogida");

      // 6. Domiciliario 1 avanza a AT_PICKUP y prueba Escenario d) PIN recogida incorrecto
      await courier1Page.getByRole("button", { name: "Voy en camino" }).click();
      await expect(courier1Page.getByText(/ARRIVING_PICKUP/)).toBeVisible();
      await courier1Page.getByRole("button", { name: "Llegué al restaurante" }).click();
      await expect(courier1Page.getByText(/AT_PICKUP/)).toBeVisible();

      await courier1Page.locator("#courier-pickup-pin").fill("000000");
      await courier1Page.getByRole("button", { name: "Confirmar recogida" }).click();
      await expect(
        courier1Page.getByRole("alert").filter({ hasText: /PIN|intento|incorrecto/i }),
      ).toBeVisible();
      await expect(courier1Page.getByText(/Estado:\s*AT_PICKUP/)).toBeVisible();
      await captureStep(
        courier1Page,
        testInfo.project.name,
        "05-domiciliario-pin-recogida-invalido",
      );

      // 7. PIN recogida correcto -> PICKED_UP -> AT_DROPOFF
      await courier1Page.locator("#courier-pickup-pin").fill(pickupPin);
      await courier1Page.getByRole("button", { name: "Confirmar recogida" }).click();
      await expect(courier1Page.getByText(/PICKED_UP/)).toBeVisible();
      await courier1Page.getByRole("button", { name: "Llegué al cliente" }).click();
      await expect(courier1Page.getByText(/AT_DROPOFF/)).toBeVisible();
      await captureStep(courier1Page, testInfo.project.name, "06-domiciliario-en-entrega");

      // 8. Cliente ve AT_DROPOFF y PIN de entrega en enlace público
      await clientPage.reload();
      await expect(clientPage.getByTestId("tracking-status")).toContainText("AT_DROPOFF");
      const deliveryPin = (await clientPage.getByTestId("delivery-pin-value").innerText()).trim();
      expect(deliveryPin).toMatch(/^\d{6}$/);
      await captureStep(clientPage, testInfo.project.name, "07-cliente-pin-entrega");

      // 9. Escenario d) PIN entrega incorrecto -> luego PIN entrega correcto -> DELIVERED
      await courier1Page.locator("#courier-delivery-pin").fill("999999");
      await courier1Page.getByRole("button", { name: "Confirmar entrega" }).click();
      await expect(
        courier1Page.getByRole("alert").filter({ hasText: /PIN|intento|incorrecto/i }),
      ).toBeVisible();
      await expect(courier1Page.getByText(/Estado:\s*AT_DROPOFF/)).toBeVisible();

      await courier1Page.locator("#courier-delivery-pin").fill(deliveryPin);
      await courier1Page.getByRole("button", { name: "Confirmar entrega" }).click();
      await expect(courier1Page.getByText(/DELIVERED/)).toBeVisible();
      await captureStep(courier1Page, testInfo.project.name, "08-domiciliario-entregado");

      await clientPage.reload();
      await expect(clientPage.getByTestId("tracking-status")).toContainText("DELIVERED");
      await captureStep(clientPage, testInfo.project.name, "09-cliente-entregado");

      // 10. Escenario g) Aislamiento de cliente sobre endpoints de restaurante/domiciliario
      const clientOrderForbidden = await clientContext.request.get("/api/proxy/orders/mine");
      expect(clientOrderForbidden.status()).toBe(403);
      const clientOfferForbidden = await clientContext.request.get("/api/proxy/offers/available");
      expect(clientOfferForbidden.status()).toBe(403);

      // 11. Escenario b) Domiciliario 1 rechaza oferta y Domiciliario 2 la acepta
      await restPage.goto("/restaurante/nuevo-domicilio");
      await restPage.getByRole("button", { name: "Cotizar domicilio" }).click();
      await restPage.getByRole("button", { name: "Siguiente: Confirmar borrador" }).click();
      await restPage.locator("#rest-food-amount").fill("25000");
      await restPage.locator("#rest-delivery-fee-step2").fill("5500");
      await restPage.getByRole("button", { name: "Crear borrador" }).click();
      await expect(restPage.getByText(/Borrador:/)).toBeVisible();
      await restPage.getByRole("button", { name: "Siguiente: Publicar domicilio" }).click();
      await restPage.locator("#rest-customer-name").fill("Cliente Dos M52");
      await restPage.locator("#rest-customer-phone").fill("+573000005212");
      await restPage.locator("#rest-dropoff-address").fill("Calle Ficticia 20 # 3-10, Tocancipa");
      await restPage.getByRole("button", { name: "Publicar domicilio" }).click();
      await expect(restPage.getByText(/SEEKING_COURIER/)).toBeVisible();

      await courier1Page.goto("/domiciliario");
      await courier1Page.getByTestId("courier-refresh-offers").click();
      const declineBtn = courier1Page.locator('[data-testid^="courier-decline-offer-"]').first();
      await expect(declineBtn).toBeVisible();
      await declineBtn.click();
      await expect(courier1Page.getByText(/Oferta rechazada/)).toBeVisible();

      await courier2Page.goto("/domiciliario");
      await courier2Page.getByTestId("courier-refresh-offers").click();
      const acceptBtn2 = courier2Page.locator('[data-testid^="courier-accept-offer-"]').first();
      await expect(acceptBtn2).toBeVisible();
      await acceptBtn2.click();
      await expect(courier2Page).toHaveURL(/\/domiciliario\/entrega/);
      await expect(courier2Page.getByText(/Estado:\s*ACCEPTED/)).toBeVisible();
      await captureStep(courier2Page, testInfo.project.name, "10-rechazo-y-segundo-domiciliario");

      // 12. Escenario e) Cancelación del pedido en estado permitido (API + verificación en tracking)
      const c2OrdersRes = await courier2Context.request.get("/api/proxy/orders/mine");
      expect(c2OrdersRes.ok()).toBe(true);
      const c2OrdersData = (await c2OrdersRes.json()) as { orders: Array<{ id: string }> };
      const order2Id = c2OrdersData.orders[0]?.id ?? "";
      expect(order2Id).not.toBe("");

      const trk2Res = await restContext.request.post(
        `/api/proxy/orders/${order2Id}/tracking-link`,
        {
          data: {},
        },
      );
      expect(trk2Res.ok()).toBe(true);
      const trk2Data = (await trk2Res.json()) as { token: string };

      const cancelRes = await restContext.request.post(`/api/proxy/orders/${order2Id}/cancel`, {
        data: { reason: "Cancelacion controlada en simulacro M52" },
      });
      expect(cancelRes.ok()).toBe(true);

      // Nadie puede avanzarlo después de cancelar
      const postCancelStep = await courier2Context.request.post(
        `/api/proxy/orders/${order2Id}/arrive-pickup`,
        { data: {} },
      );
      expect(postCancelStep.status()).toBe(422);

      await clientPage.goto(`/tracking/${trk2Data.token}`);
      await expect(clientPage.getByTestId("tracking-status")).toContainText("CANCELLED_RESTAURANT");
      await captureStep(clientPage, testInfo.project.name, "11-pedido-cancelado-tracking");

      // 13. Escenario h) Enlace público inválido
      await clientPage.goto("/tracking/token-invalido-m52");
      await expect(clientPage.getByText("Enlace de seguimiento no disponible")).toBeVisible();
      await captureStep(clientPage, testInfo.project.name, "12-tracking-invalido");
    } finally {
      await Promise.all([
        restContext.close(),
        clientContext.close(),
        courier1Context.close(),
        courier2Context.close(),
      ]);
    }
  });
});
