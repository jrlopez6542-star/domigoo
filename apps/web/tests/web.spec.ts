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

    // Navegación a Cliente
    await pedirCard.click();
    await expect(page).toHaveURL(/\/cliente$/);
    await expect(page.getByRole("heading", { name: /cliente/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Usar mi ubicación" })).toBeVisible();

    // Navegación a Restaurante
    await page.goto("/");
    await restaurantLink.click();
    await expect(page).toHaveURL(/\/restaurante$/);
    await expect(page.getByText("Valor de la comida (COP)")).toBeVisible();
    await expect(page.getByText("Valor del domicilio (COP)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Usar mi ubicación" })).toBeVisible();

    // Navegación a Domiciliario
    await page.goto("/");
    await domiciliarioCard.click();
    await expect(page).toHaveURL(/\/domiciliario$/);
    await expect(page.getByRole("heading", { name: /domiciliario/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Usar mi ubicación" })).toBeVisible();
    await expect(page.getByText("Opciones avanzadas (ID de oferta / pedido)")).toBeVisible();

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

  test("muestra páginas legales en borrador, casillas no premarcadas en registro y consentimiento de geolocalización (M45)", async ({
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

    // Pantalla de consentimiento de geolocalización con alternativa manual
    await page.getByTestId("open-geo-consent").click();
    const geoScreen = page.getByTestId("geo-consent-screen");
    await expect(geoScreen).toBeVisible();
    await expect(geoScreen.locator('input[name="geoConsentChecked"]')).not.toBeChecked();
    await expect(geoScreen.getByTestId("geo-consent-allow")).toBeVisible();
    await expect(geoScreen.getByTestId("geo-consent-manual")).toBeVisible();
    await geoScreen.getByTestId("geo-consent-manual").click();
    await expect(geoScreen).toBeHidden();

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
