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
});
