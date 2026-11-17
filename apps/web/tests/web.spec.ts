import { expect, test } from "@playwright/test";

const API_BASE_URL = process.env["API_BASE_URL"] || "http://127.0.0.1:3001";

test.describe("Interfaz única por rol (M46) y Tracking público (M30)", () => {
  test("la entrada única muestra los tres roles, navega a cada ruta y el tracking público funciona", async ({
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
    await expect(page.getByRole("link", { name: "Administración" })).toBeVisible();
    await expect(page.getByTestId("footer-legal-slot")).toBeVisible();

    // Navegación a Cliente
    await clienteCard.click();
    await expect(page).toHaveURL(/\/cliente$/);
    await expect(page.getByRole("heading", { name: /cliente/i }).first()).toBeVisible();

    // Navegación a Restaurante
    await page.goto("/");
    await restauranteCard.click();
    await expect(page).toHaveURL(/\/restaurante$/);
    await expect(page.getByText("Valor de la comida (COP)")).toBeVisible();
    await expect(page.getByText("Valor del domicilio (COP)")).toBeVisible();

    // Navegación a Domiciliario
    await page.goto("/");
    await domiciliarioCard.click();
    await expect(page).toHaveURL(/\/domiciliario$/);
    await expect(page.getByRole("heading", { name: /domiciliario/i }).first()).toBeVisible();

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

  test("cada rol permite registro e ingreso contra la API local", async ({ page, request }) => {
    const health = await request.get(`${API_BASE_URL}/health`).catch(() => null);
    test.skip(!health || !health.ok(), "La API local no está activa en API_BASE_URL.");

    const suffix = `${String(Date.now())}-${String(Math.floor(Math.random() * 10000))}`;
    const roles = [
      { route: "/cliente", email: `cliente-${suffix}@ejemplo.com` },
      { route: "/restaurante", email: `restaurante-${suffix}@ejemplo.com` },
      { route: "/domiciliario", email: `domiciliario-${suffix}@ejemplo.com` },
    ];

    for (const item of roles) {
      await page.goto(item.route);
      await page.getByRole("tab", { name: "Crear cuenta" }).click();
      await page.getByLabel(/Correo electrónico o celular/i).fill(item.email);
      await page.getByLabel(/Contraseña/i).fill("ClavePruebaDomigoo2026");
      await page.getByRole("button", { name: "Registrarme" }).click();

      await expect(page.getByTestId("session-badge")).toContainText(item.email);

      await page.getByRole("button", { name: "Cerrar sesión" }).click();
      await expect(page.getByRole("tab", { name: "Iniciar sesión" })).toBeVisible();

      await page.getByLabel(/Correo electrónico o celular/i).fill(item.email);
      await page.getByLabel(/Contraseña/i).fill("ClavePruebaDomigoo2026");
      await page.getByRole("button", { name: "Ingresar" }).click();
      await expect(page.getByTestId("session-badge")).toContainText(item.email);

      await page.getByRole("button", { name: "Cerrar sesión" }).click();
    }
  });
});
