import { expect, test } from "@playwright/test";

const runPreview = process.env["PREVIEW_E2E"] === "1";

test.describe("M49 Preview E2E (3 roles reales contra Vercel Preview)", () => {
  test.skip(!runPreview, "Solo se ejecuta en el job de Preview cuando PREVIEW_E2E=1");

  test("home carga logos y los 3 roles registran, navegan y mantienen aislamiento en Preview", async ({
    page,
  }) => {
    const suffix = `${String(Date.now())}-${String(Math.floor(Math.random() * 10000))}`;
    const pass = `PrvM49!${suffix}`;

    // 1. Home y logos
    await page.goto("/");
    await expect(page.locator("header img")).toBeVisible();
    const imgs = page.locator("img");
    const count = await imgs.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const ok = await imgs
        .nth(i)
        .evaluate((el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0);
      expect(ok).toBe(true);
    }

    // 2. Cliente: registro, navegación y aislamiento
    await page.goto("/cliente");
    await page.getByTestId("tab-register").click();
    await page.getByLabel(/Correo electrónico o celular/i).fill(`prv-cli-${suffix}@ejemplo.com`);
    await page.getByLabel(/Contraseña/i).fill(pass);
    const cliConsents = page.getByTestId("register-consents");
    await cliConsents.locator('input[name="termsAccepted"]').check();
    await cliConsents.locator('input[name="privacyAccepted"]').check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByTestId("cliente-home-screen")).toBeVisible({ timeout: 25_000 });

    await page.goto("/restaurante/nuevo-domicilio");
    await expect(page).toHaveURL(/\/cliente$/);
    await page.goto("/domiciliario/entrega");
    await expect(page).toHaveURL(/\/cliente$/);

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByTestId("tab-login")).toBeVisible();

    // 3. Restaurante: registro, navegación, sin IDs manuales y aislamiento
    await page.goto("/restaurante");
    await page.getByTestId("tab-register").click();
    await page.getByLabel(/Correo electrónico o celular/i).fill(`prv-rest-${suffix}@ejemplo.com`);
    await page.getByLabel(/Contraseña/i).fill(pass);
    const restConsents = page.getByTestId("register-consents");
    await restConsents.locator('input[name="termsAccepted"]').check();
    await restConsents.locator('input[name="privacyAccepted"]').check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByTestId("restaurante-home-screen")).toBeVisible({ timeout: 25_000 });

    await page.goto("/restaurante/nuevo-domicilio");
    await expect(page.locator("#rest-order-id")).toHaveCount(0);
    await page.goto("/restaurante/pedidos");
    await expect(page.locator("#rest-pedidos-order-id")).toHaveCount(0);

    await page.goto("/cliente/tarifa");
    await expect(page).toHaveURL(/\/restaurante$/);
    await page.goto("/domiciliario/entrega");
    await expect(page).toHaveURL(/\/restaurante$/);

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByTestId("tab-login")).toBeVisible();

    // 4. Domiciliario: registro con dato sensible, sin IDs manuales y aislamiento
    await page.goto("/domiciliario");
    await page.getByTestId("tab-register").click();
    await page.getByLabel(/Correo electrónico o celular/i).fill(`prv-cour-${suffix}@ejemplo.com`);
    await page.getByLabel(/Contraseña/i).fill(pass);
    const courConsents = page.getByTestId("register-consents");
    await courConsents.locator('input[name="termsAccepted"]').check();
    await courConsents.locator('input[name="privacyAccepted"]').check();
    await courConsents.locator('input[name="sensitiveDataAccepted"]').check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByTestId("domiciliario-home-screen")).toBeVisible({ timeout: 25_000 });

    await page.goto("/domiciliario/entrega");
    await expect(page.locator("#courier-order-id")).toHaveCount(0);
    await expect(page.locator('input[placeholder="UUID del pedido"]')).toHaveCount(0);

    await page.goto("/cliente/tarifa");
    await expect(page).toHaveURL(/\/domiciliario$/);
    await page.goto("/restaurante/nuevo-domicilio");
    await expect(page).toHaveURL(/\/domiciliario$/);
  });
});
