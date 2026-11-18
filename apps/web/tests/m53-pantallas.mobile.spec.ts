import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const CAPTURES_DIR = fileURLToPath(new URL("../../../docs/capturas/m53/", import.meta.url));

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

async function captureScreen(page: Page, projectName: string, fileName: string) {
  const targetDir = path.join(CAPTURES_DIR, projectName);
  fs.mkdirSync(targetDir, { recursive: true });
  await page.screenshot({
    path: path.join(targetDir, fileName),
    fullPage: true,
  });
}

test.describe("M53-PANTALLAS-MOCKUP-V2 (móvil 390x844 y 360x780)", () => {
  test("tema oscuro #29243E, inicio con tarjetas v2, directorio cliente sin solicitar domicilio, y capturas por pantalla", async ({
    page,
  }, testInfo) => {
    const projectName = testInfo.project.name || "mobile";

    // 1. Inicio (/) — Tema oscuro, Pedir comida, Seguir pedido, Soy domiciliario
    await page.goto("/");
    await assertNoHorizontalOverflow(page);
    await expect(page.getByText("Pedir comida")).toBeVisible();
    await expect(page.getByText("Seguir pedido")).toBeVisible();
    await expect(page.getByText("Soy domiciliario")).toBeVisible();

    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // #29243E = rgb(41, 36, 62)
    expect(bodyBg).toContain("41, 36, 62");
    await captureScreen(page, projectName, "01-inicio.png");

    // 2. Cliente directorio (/cliente) — Sin cuenta obligatoria y sin pantalla Solicitar domicilio
    await page.goto("/cliente");
    await assertNoHorizontalOverflow(page);
    await expect(page.getByPlaceholder(/Buscar restaurante/i)).toBeVisible();
    await captureScreen(page, projectName, "02-cliente-directorio.png");

    // /cliente/pedir redirige a /cliente (decisión del dueño: solo restaurante crea domicilios)
    await page.goto("/cliente/pedir");
    await expect(page).toHaveURL(/\/cliente$/);

    // 3. Cliente seguir pedido (/cliente/seguir)
    await page.goto("/cliente/seguir");
    await assertNoHorizontalOverflow(page);
    await expect(page.getByText(/Seguir pedido/i).first()).toBeVisible();
    await captureScreen(page, projectName, "03-cliente-seguir.png");

    // 4. Restaurante acceso (/restaurante)
    await page.goto("/restaurante");
    await assertNoHorizontalOverflow(page);
    await expect(page.getByText(/Portal de Restaurantes/i)).toBeVisible();
    await captureScreen(page, projectName, "04-restaurante-acceso.png");

    // 5. Domiciliario acceso (/domiciliario)
    await page.goto("/domiciliario");
    await assertNoHorizontalOverflow(page);
    await expect(page.getByText(/Tu espacio de domiciliario/i)).toBeVisible();
    await captureScreen(page, projectName, "05-domiciliario-acceso.png");
  });

  test("aislamiento entre perfiles con redirección y persistencia de sesión tras recarga", async ({
    page,
  }) => {
    await page.route("**/api/proxy/**", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/auth/me")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "user-m53-rest",
            user: { id: "user-m53-rest", email: "restaurante-m53@ejemplo.com" },
          }),
        });
        return;
      }
      if (url.includes("/restaurants/me")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ restaurants: [] }),
        });
        return;
      }
      if (url.includes("/orders")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ orders: [] }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    await page.goto("/restaurante");
    await page.evaluate(() => {
      window.sessionStorage.setItem("domigoo_active_role", "RESTAURANT");
      document.cookie = "domigoo_role=RESTAURANT; Path=/; SameSite=Lax";
    });
    await page.reload();
    await expect(page).toHaveURL(/\/restaurante/);
    await expect(page.getByTestId("tab-login")).toHaveCount(0);

    // Aislamiento: rol RESTAURANT no puede abrir /domiciliario ni /cliente; redirige a /restaurante
    await page.goto("/domiciliario");
    await expect(page).toHaveURL(/\/restaurante$/);

    await page.goto("/cliente");
    await expect(page).toHaveURL(/\/restaurante$/);
  });
});
