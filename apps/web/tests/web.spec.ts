import { expect, test } from "@playwright/test";

const API_BASE_URL = process.env["API_BASE_URL"] || "http://127.0.0.1:3001";

test.describe("Interfaz única por rol (M46), Legal (M45) y Tracking público (M30)", () => {
  test("la entrada única muestra los tres roles, enlaces legales en footer, navega a cada ruta y el tracking público funciona", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/DOMIGOO/i);

    const clienteCard = page.getByTestId("role-card-cliente");
    const restauranteCard = page.getByTestId("role-card-restaurante");
    const domiciliarioCard = page.getByTestId("role-card-domiciliario");

    await expect(clienteCard).toBeVisible();
    await expect(restauranteCard).toBeVisible();
    await expect(domiciliarioCard).toBeVisible();

    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Términos y Condiciones" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Política de Privacidad" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Autorización de Datos" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Términos Restaurantes" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Términos Domiciliarios" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Administración" })).toBeVisible();
    await expect(footer).not.toContainText(/próximamente/i);

    // Navegación a Cliente
    await clienteCard.click();
    await expect(page).toHaveURL(/\/cliente$/);
    await expect(page.getByRole("heading", { name: /cliente/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Usar mi ubicación" })).toBeVisible();

    // Navegación a Restaurante
    await page.goto("/");
    await restauranteCard.click();
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
});
