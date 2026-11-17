import { expect, test } from "@playwright/test";

const API_BASE_URL = process.env["API_BASE_URL"] || "http://127.0.0.1:3001";

test.describe("HOME-002 (Futuro Urbano), Legal (M45) y Tracking público (M30)", () => {
  test("la entrada única HOME-002 muestra las 3 tarjetas en fila, botones, enlaces legales en footer, navega a cada ruta y el tracking público funciona", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page).toHaveTitle(/DOMIGOO/i);

    const pedirCard = page.getByTestId("home-card-pedir");
    const seguirCard = page.getByTestId("home-card-seguir");
    const domiciliarioCard = page.getByTestId("home-card-domiciliario");
    const loginBtn = page.getByTestId("home-btn-login");
    const registerLink = page.getByTestId("home-link-register");
    const restaurantLink = page.getByTestId("home-link-restaurante");

    await expect(pedirCard).toBeVisible();
    await expect(seguirCard).toBeVisible();
    await expect(domiciliarioCard).toBeVisible();
    await expect(loginBtn).toBeVisible();
    await expect(registerLink).toBeVisible();
    await expect(restaurantLink).toBeVisible();

    // Verificar tipografía Futuro Urbano (Inter y Montserrat realmente cargadas)
    const fontCheck = await page.evaluate(async () => {
      await document.fonts.ready;
      const bodyFont = getComputedStyle(document.body).fontFamily;
      const h1 = document.querySelector("h1");
      const h1Font = h1 ? getComputedStyle(h1).fontFamily : "";
      const btn = document.querySelector('[data-testid="home-btn-login"]');
      const btnFont = btn ? getComputedStyle(btn).fontFamily : "";
      return {
        bodyFont,
        h1Font,
        btnFont,
        interLoaded: document.fonts.check("16px Inter"),
        montserratLoaded: document.fonts.check("700 16px Montserrat"),
      };
    });
    expect(fontCheck.bodyFont).toMatch(/Inter/i);
    expect(fontCheck.h1Font).toMatch(/Montserrat/i);
    expect(fontCheck.btnFont).toMatch(/Inter|Montserrat/i);
    expect(fontCheck.interLoaded).toBe(true);
    expect(fontCheck.montserratLoaded).toBe(true);

    // Verificar que las 3 tarjetas están en la misma fila en móvil (390px) y sin desborde horizontal
    const [b1, b2, b3, overflow] = await Promise.all([
      pedirCard.boundingBox(),
      seguirCard.boundingBox(),
      domiciliarioCard.boundingBox(),
      page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ]);
    expect(overflow).toBe(false);
    expect(b1).not.toBeNull();
    expect(b2).not.toBeNull();
    expect(b3).not.toBeNull();
    if (b1 && b2 && b3) {
      expect(Math.abs(b1.y - b2.y)).toBeLessThan(8);
      expect(Math.abs(b2.y - b3.y)).toBeLessThan(8);
    }

    // Drawer de seguimiento en línea
    await seguirCard.click();
    await expect(page.getByTestId("home-tracking-form")).toBeVisible();
    await page.getByLabel("Código o enlace de seguimiento").fill("trk_demo_123");
    await page.getByRole("button", { name: "Consultar estado" }).click();
    await expect(page).toHaveURL(/\/tracking\/trk_demo_123$/);

    await page.goto("/");
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Términos y Condiciones" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Política de Privacidad" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Autorización de Datos" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Términos Restaurantes" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Términos Domiciliarios" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Administración" })).toBeVisible();
    await expect(footer).not.toContainText(/próximamente/i);

    // Iniciar sesión y Crear cuenta llevan al selector de rol (/acceso)
    await loginBtn.click();
    await expect(page).toHaveURL(/\/acceso\?modo=login$/);
    await expect(page.getByTestId("select-role-cliente")).toBeVisible();
    await expect(page.getByTestId("select-role-restaurante")).toBeVisible();
    await expect(page.getByTestId("select-role-domiciliario")).toBeVisible();

    await page.goto("/");
    await registerLink.click();
    await expect(page).toHaveURL(/\/acceso\?modo=registro$/);

    // Antes del login, cada rol muestra SOLO su pantalla de acceso (sin apilar formularios internos)
    await page.goto("/");
    await pedirCard.click();
    await expect(page).toHaveURL(/\/cliente$/);
    await expect(page.getByRole("heading", { name: /cliente/i }).first()).toBeVisible();
    await expect(page.getByTestId("tab-login")).toBeVisible();
    await expect(page.getByRole("button", { name: "Usar mi ubicación" })).toHaveCount(0);

    await page.goto("/");
    await restaurantLink.click();
    await expect(page).toHaveURL(/\/restaurante$/);
    await expect(page.getByTestId("tab-login")).toBeVisible();
    await expect(page.getByText("Valor de la comida (COP)")).toHaveCount(0);

    await page.goto("/");
    await domiciliarioCard.click();
    await expect(page).toHaveURL(/\/domiciliario$/);
    await expect(page.getByRole("heading", { name: /domiciliario/i }).first()).toBeVisible();
    await expect(page.getByTestId("tab-login")).toBeVisible();
    await expect(page.getByText("Opciones avanzadas (ID de oferta / pedido)")).toHaveCount(0);

    // Token inválido muestra estado genérico sin ficha de datos
    await page.goto("/tracking/token-invalido-000");
    await expect(page.getByText("Enlace de seguimiento no disponible")).toBeVisible();
    await expect(page.getByTestId("delivery-pin-box")).toHaveCount(0);

    const pickedUpToken = process.env["E2E_TRACKING_TOKEN_PICKED_UP"];
    const acceptedToken = process.env["E2E_TRACKING_TOKEN_ACCEPTED"];
    if (pickedUpToken && acceptedToken) {
      await page.goto(`/tracking/${acceptedToken}`);
      await expect(page.getByTestId("tracking-status")).toBeVisible();
      await expect(page.getByTestId("delivery-pin-box")).toHaveCount(0);

      await page.goto(`/tracking/${pickedUpToken}`);
      await expect(page.getByTestId("delivery-pin-box")).toBeVisible();
    } else {
      const health = await request.get(`${API_BASE_URL}/health`).catch(() => null);
      if (health && health.ok()) {
        expect(health.status()).toBe(200);
      }
    }
  });

  test("muestra páginas legales en borrador y casillas no premarcadas en registro (M45)", async ({
    page,
  }) => {
    await page.goto("/restaurante");

    // Casillas de registro separadas y NO premarcadas
    await page.getByTestId("tab-register").click();
    const consents = page.getByTestId("register-consents");
    await expect(consents).toBeVisible();
    await expect(consents.locator('input[name="termsAccepted"]')).not.toBeChecked();
    await expect(consents.locator('input[name="privacyAccepted"]')).not.toBeChecked();
    await expect(consents.locator('input[name="marketingAccepted"]')).not.toBeChecked();

    // Páginas públicas /legal/* con banner "Borrador en revisión legal"
    for (const route of [
      "/legal/terminos",
      "/legal/privacidad",
      "/legal/autorizacion",
      "/legal/domiciliarios",
      "/legal/restaurantes",
    ]) {
      await page.goto(route);
      await expect(page.getByTestId("legal-draft-banner")).toContainText(
        "Borrador en revisión legal",
      );
      await expect(page.locator("footer")).not.toContainText(/próximamente/i);
    }
  });

  test("M49: protección de rutas sin sesión, navegación por rol, aislamiento entre roles y consentimiento geo", async ({
    page,
  }) => {
    // Sin sesión, las subrutas protegidas redirigen al acceso del rol
    await page.goto("/cliente/tarifa");
    await expect(page).toHaveURL(/\/cliente$/);
    await page.goto("/restaurante/nuevo-domicilio");
    await expect(page).toHaveURL(/\/restaurante$/);
    await page.goto("/domiciliario/entrega");
    await expect(page).toHaveURL(/\/domiciliario$/);

    // Mock de sesión para probar navegación entre pantallas, wizard y aislamiento de roles
    let activeUser: { id: string; email: string; phoneE164: null; status: string } | null = null;
    await page.route("**/api/proxy/**", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/auth/me")) {
        if (!activeUser) {
          await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(activeUser),
        });
        return;
      }
      if (url.endsWith("/auth/login") || url.endsWith("/auth/register")) {
        const body = route.request().postDataJSON() as { email?: string };
        activeUser = {
          id: "usr-mock-1",
          email: body.email ?? "demo@domigoo.co",
          phoneE164: null,
          status: "ACTIVE",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(activeUser),
        });
        return;
      }
      if (url.endsWith("/auth/logout")) {
        activeUser = null;
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    // 1. Cliente: login y navegación entre sus 5 pantallas (desktop)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/cliente");
    await page.getByLabel(/Correo electrónico o celular/i).fill("cliente-m49@ejemplo.com");
    await page.getByLabel(/Contraseña/i).fill("ClavePruebaDomigoo2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByTestId("cliente-home-screen")).toBeVisible();

    await page.getByTestId("nav-cliente-pedir-sidebar").click();
    await expect(page).toHaveURL(/\/cliente\/pedir$/);
    await expect(page.getByTestId("cliente-pedir-screen")).toBeVisible();

    await page.getByTestId("nav-cliente-seguir-sidebar").click();
    await expect(page).toHaveURL(/\/cliente\/seguir$/);
    await expect(page.getByTestId("cliente-seguir-screen")).toBeVisible();

    await page.getByTestId("nav-cliente-tarifa-sidebar").click();
    await expect(page).toHaveURL(/\/cliente\/tarifa$/);
    await expect(page.getByRole("button", { name: "Usar mi ubicación" })).toBeVisible();

    // Aislamiento: Cliente no puede entrar a pantallas de Restaurante ni Domiciliario
    await page.goto("/restaurante/nuevo-domicilio");
    await expect(page).toHaveURL(/\/cliente$/);
    await page.goto("/domiciliario/entrega");
    await expect(page).toHaveURL(/\/cliente$/);

    // Cerrar sesión como Cliente
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByTestId("tab-login")).toBeVisible();

    // 2. Restaurante: login, navegación, wizard de 3 pasos y geo consent
    await page.goto("/restaurante");
    await page.getByLabel(/Correo electrónico o celular/i).fill("restaurante-m49@ejemplo.com");
    await page.getByLabel(/Contraseña/i).fill("ClavePruebaDomigoo2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByTestId("restaurante-home-screen")).toBeVisible();

    await page.getByTestId("nav-restaurante-nuevo-sidebar").click();
    await expect(page).toHaveURL(/\/restaurante\/nuevo-domicilio$/);
    await expect(page.getByTestId("wizard-panel-1")).toBeVisible();
    await page.getByTestId("wizard-step-2").click();
    await expect(page.getByTestId("wizard-panel-2")).toBeVisible();
    await expect(page.getByText("Valor de la comida (COP)")).toBeVisible();
    await page.getByTestId("wizard-step-3").click();
    await expect(page.getByTestId("wizard-panel-3")).toBeVisible();

    await page.getByTestId("open-geo-consent").click();
    const geoScreen = page.getByTestId("geo-consent-screen");
    await expect(geoScreen).toBeVisible();
    await expect(geoScreen.locator('input[name="geoConsentChecked"]')).not.toBeChecked();
    await geoScreen.getByTestId("geo-consent-manual").click();
    await expect(geoScreen).toBeHidden();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();

    // 3. Domiciliario: login en móvil (barra inferior) y entrega en curso
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/domiciliario");
    await page.getByLabel(/Correo electrónico o celular/i).fill("domiciliario-m49@ejemplo.com");
    await page.getByLabel(/Contraseña/i).fill("ClavePruebaDomigoo2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByTestId("domiciliario-home-screen")).toBeVisible();

    await page.getByTestId("nav-domiciliario-entrega-bottom").click();
    await expect(page).toHaveURL(/\/domiciliario\/entrega$/);
    await expect(page.getByRole("button", { name: "Voy en camino" })).toBeVisible();
    await expect(page.getByTestId("courier-no-offers")).toHaveText("No hay ofertas por ahora.");
    await expect(page.getByLabel("ID de oferta")).toHaveCount(0);
  });

  test("M49-PULIDO: restaurante crea domicilio sin escribir ID y domiciliario acepta oferta desde tarjeta", async ({
    page,
  }) => {
    let activeUser: { id: string; email: string; phoneE164: null; status: string } | null = null;
    let mockBranches = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        restaurantId: "22222222-2222-4222-8222-222222222222",
        restaurantName: "La Brasa Tocancipá",
        establishmentName: "La Brasa",
        name: "Sede Centro",
        addressLine: "Cra 4 # 10-20, Tocancipá",
        status: "ACTIVE",
      },
    ];
    let createdOrderBranchId = "";
    let mockOffers = [
      {
        offerId: "33333333-3333-4333-8333-333333333333",
        orderId: "44444444-4444-4444-8444-444444444444",
        referenceCode: "DMG-049",
        restaurantName: "La Brasa Tocancipá",
        branchName: "Sede Centro",
        pickupAddress: "Cra 4 # 10-20, Tocancipá",
        dropoffAddress: "Vereda Canavita Km 2",
        deliveryFeeCop: 5500,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      },
    ];

    await page.route("**/api/proxy/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.endsWith("/auth/me")) {
        if (!activeUser) {
          await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(activeUser),
        });
        return;
      }
      if (url.endsWith("/auth/login")) {
        const body = route.request().postDataJSON() as { email?: string };
        activeUser = {
          id: "usr-pulido-1",
          email: body.email ?? "demo@domigoo.co",
          phoneE164: null,
          status: "ACTIVE",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(activeUser),
        });
        return;
      }
      if (url.endsWith("/auth/logout")) {
        activeUser = null;
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      if (url.endsWith("/branches/mine")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ branches: mockBranches }),
        });
        return;
      }
      if (url.endsWith("/orders") && method === "POST") {
        const body = route.request().postDataJSON() as { branchId?: string };
        createdOrderBranchId = body.branchId ?? "";
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: "44444444-4444-4444-8444-444444444444", status: "DRAFT" }),
        });
        return;
      }
      if (url.endsWith("/offers/available")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ offers: mockOffers }),
        });
        return;
      }
      if (url.includes("/offers/") && url.endsWith("/accept") && method === "POST") {
        mockOffers = [];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            offerId: "33333333-3333-4333-8333-333333333333",
            orderId: "44444444-4444-4444-8444-444444444444",
            offerStatus: "ACCEPTED",
            orderStatus: "ACCEPTED",
          }),
        });
        return;
      }
      if (url.endsWith("/orders/44444444-4444-4444-8444-444444444444") && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "44444444-4444-4444-8444-444444444444",
            status: "ACCEPTED",
            deliveryFeeCop: 5500,
            pickupAddress: "Cra 4 # 10-20, Tocancipá",
            dropoffAddress: "Vereda Canavita Km 2",
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    // 1. Restaurante: 1 sucursal auto-seleccionada, sin campo manual ID de sucursal
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/restaurante");
    await page.getByLabel(/Correo electrónico o celular/i).fill("restaurante-pulido@ejemplo.com");
    await page.getByLabel(/Contraseña/i).fill("ClavePruebaDomigoo2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.getByTestId("nav-restaurante-nuevo-sidebar").click();

    await expect(page.getByLabel("ID de sucursal")).toHaveCount(0);
    await expect(page.getByTestId("rest-branch-select")).toHaveCount(0);
    await expect(page.getByTestId("rest-branch-auto")).toContainText("Sede Centro");

    await page.getByTestId("wizard-step-2").click();
    await page.getByRole("button", { name: "Crear borrador" }).click();
    expect(createdOrderBranchId).toBe("11111111-1111-4111-8111-111111111111");

    // 0 sucursales -> muestra aviso con botón a Mi negocio
    mockBranches = [];
    await page.reload();
    await expect(page.getByTestId("restaurante-sin-sucursales")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ir a Mi negocio" })).toHaveAttribute(
      "href",
      "/restaurante/negocio",
    );

    await page.getByRole("button", { name: "Cerrar sesión" }).click();

    // 2. Domiciliario: ve la oferta en tarjeta y la acepta directo hacia Entrega en curso
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/domiciliario");
    await page.getByLabel(/Correo electrónico o celular/i).fill("domiciliario-pulido@ejemplo.com");
    await page.getByLabel(/Contraseña/i).fill("ClavePruebaDomigoo2026");
    await page.getByRole("button", { name: "Ingresar" }).click();

    const offerCard = page.getByTestId("courier-offer-card-33333333-3333-4333-8333-333333333333");
    await expect(offerCard).toBeVisible();
    await expect(offerCard).toContainText("La Brasa Tocancipá");
    await expect(offerCard).toContainText("Cra 4 # 10-20, Tocancipá");
    await expect(offerCard).toContainText("Vereda Canavita Km 2");

    await page.getByTestId("courier-accept-offer-33333333-3333-4333-8333-333333333333").click();
    await expect(page).toHaveURL(/\/domiciliario\/entrega$/);
    await expect(page.getByText("44444444-4444-4444-8444-444444444444")).toBeVisible();
  });

  test("cada rol permite registro e ingreso contra la API local", async ({ page, request }) => {
    const health = await request.get(`${API_BASE_URL}/health`).catch(() => null);
    test.skip(!health || !health.ok(), "La API local no está activa en API_BASE_URL.");

    const suffix = `${String(Date.now())}-${String(Math.floor(Math.random() * 10000))}`;
    const roles = [
      { route: "/cliente", email: `cliente-${suffix}@ejemplo.com`, courier: false },
      { route: "/restaurante", email: `restaurante-${suffix}@ejemplo.com`, courier: false },
      { route: "/domiciliario", email: `domiciliario-${suffix}@ejemplo.com`, courier: true },
    ];

    for (const item of roles) {
      await page.goto(item.route);
      await page.getByTestId("tab-register").click();
      await page.getByLabel(/Correo electrónico o celular/i).fill(item.email);
      await page.getByLabel(/Contraseña/i).fill("ClavePruebaDomigoo2026");

      const consents = page.getByTestId("register-consents");
      await consents.locator('input[name="termsAccepted"]').check();
      await consents.locator('input[name="privacyAccepted"]').check();
      if (item.courier) {
        await consents.locator('input[name="sensitiveDataAccepted"]').check();
      }

      await page.getByRole("button", { name: "Registrarme" }).click();
      await expect(page.getByTestId("session-badge")).toContainText(item.email);

      await page.getByRole("button", { name: "Cerrar sesión" }).click();
      await expect(page.getByTestId("tab-login")).toBeVisible();

      await page.getByLabel(/Correo electrónico o celular/i).fill(item.email);
      await page.getByLabel(/Contraseña/i).fill("ClavePruebaDomigoo2026");
      await page.getByRole("button", { name: "Ingresar" }).click();
      await expect(page.getByTestId("session-badge")).toContainText(item.email);

      await page.getByRole("button", { name: "Cerrar sesión" }).click();
      await expect(page.getByTestId("tab-login")).toBeVisible();
    }
  });

  test("todas las imágenes de la página de inicio responden 200 y cargan con naturalWidth > 0", async ({
    page,
    request,
  }) => {
    const imgResponses = new Map<string, number>();
    page.on("response", (response) => {
      const reqType = response.request().resourceType();
      if (reqType === "image" || response.url().includes("/brand/")) {
        imgResponses.set(response.url(), response.status());
      }
    });

    await page.goto("/", { waitUntil: "networkidle" });

    const images = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img")).map((img) => ({
        src: img.getAttribute("src") ?? "",
        currentSrc: img.currentSrc || img.src,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
      })),
    );

    expect(images.length).toBeGreaterThan(0);

    for (const img of images) {
      expect(img.src, `<img> sin src`).not.toBe("");
      expect(img.complete, `<img> no completó carga: ${img.src}`).toBe(true);
      expect(img.naturalWidth, `<img> con naturalWidth 0: ${img.src}`).toBeGreaterThan(0);

      const recordedStatus = imgResponses.get(img.currentSrc);
      if (recordedStatus !== undefined) {
        expect(recordedStatus, `<img> respondió ${String(recordedStatus)}: ${img.currentSrc}`).toBe(
          200,
        );
      } else {
        const res = await request.get(img.currentSrc);
        expect(res.status(), `<img> respondió ${String(res.status())}: ${img.currentSrc}`).toBe(
          200,
        );
      }
    }
  });
});
