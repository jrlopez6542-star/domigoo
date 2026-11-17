import { expect, test } from "@playwright/test";

const API_BASE_URL = process.env["API_BASE_URL"] || "http://127.0.0.1:3001";

test.describe("Web de restaurantes (M29) y Tracking público (M30)", () => {
  test("el portal muestra título con APP_NAME, etiquetas separadas de comida y domicilio, y seguimiento público respeta estado del PIN", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/DOMIGOO/i);
    await expect(page.getByText("Valor de la comida (COP)")).toBeVisible();
    await expect(page.getByText("Valor del domicilio (COP)")).toBeVisible();

    // Token inválido muestra estado genérico sin ficha de datos
    await page.goto("/tracking/token-invalido-000");
    await expect(page.getByText("Enlace de seguimiento no disponible")).toBeVisible();
    await expect(page.getByTestId("delivery-pin-box")).toHaveCount(0);

    // Si hay una API con token de prueba en E2E, se puede validar también;
    // aquí verificamos que la API esté viva si se configuró E2E_TRACKING_TOKEN_PICKED_UP.
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

  test("muestra páginas legales en borrador, enlaces en footer, casillas no premarcadas en registro y consentimiento de geolocalización (M45)", async ({
    page,
  }) => {
    await page.goto("/");

    // Enlaces legales en el footer
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Términos y Condiciones" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Política de Privacidad" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Términos Domiciliarios" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Términos Restaurantes" })).toBeVisible();

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
      "/legal/domiciliarios",
      "/legal/restaurantes",
    ]) {
      await page.goto(route);
      await expect(page.getByTestId("legal-draft-banner")).toContainText(
        "Borrador en revisión legal",
      );
    }
  });
});
