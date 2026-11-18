import { expect, test, type Page } from "@playwright/test";

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

async function assertNotCoveredByBottomNav(page: Page, locator: ReturnType<Page["locator"]>) {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  const bottomNav = page.locator(".dg-role-bottom-nav");
  if ((await bottomNav.count()) === 0 || !(await bottomNav.isVisible())) {
    return;
  }
  const [elBox, navBox] = await Promise.all([locator.boundingBox(), bottomNav.boundingBox()]);
  expect(elBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  if (elBox && navBox) {
    expect(elBox.y + elBox.height).toBeLessThanOrEqual(navBox.y + 1);
  }
}

test.describe("M49-MOVIL: Auditoría móvil (iPhone 13 390x844 y Android 360x780)", () => {
  test("encabezado compacto <=72px, sin desborde horizontal, objetivos táctiles >=44px y tablas legales legibles", async ({
    page,
  }) => {
    for (const route of ["/", "/acceso", "/legal/restaurantes", "/legal/terminos"]) {
      await page.goto(route);
      await assertNoHorizontalOverflow(page);

      const headerBox = await page.locator("header.dg-header").boundingBox();
      expect(headerBox).not.toBeNull();
      if (headerBox) {
        expect(headerBox.height).toBeLessThanOrEqual(72);
      }

      // Botón hamburguesa accesible >= 44x44
      const menuBtn = page.locator(".dg-menu-toggle");
      await expect(menuBtn).toBeVisible();
      const menuBox = await menuBtn.boundingBox();
      expect(menuBox).not.toBeNull();
      if (menuBox) {
        expect(menuBox.height).toBeGreaterThanOrEqual(44);
        expect(menuBox.width).toBeGreaterThanOrEqual(44);
      }

      // Enlaces del footer >= 44px
      const footerLinks = page.locator("footer .dg-footer-link");
      const count = await footerLinks.count();
      for (let i = 0; i < count; i += 1) {
        const box = await footerLinks.nth(i).boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }
    }

    // En /legal/restaurantes, las tablas se apilan como tarjetas sin cortar columnas ni desbordar
    await page.goto("/legal/restaurantes");
    await assertNoHorizontalOverflow(page);
    const firstTd = page.locator(".dg-legal-table td").first();
    await expect(firstTd).toBeVisible();
    const tdDisplay = await firstTd.evaluate((el) => getComputedStyle(el).display);
    expect(tdDisplay).toBe("block");
  });

  test("pantallas de login/registro por rol tienen pestañas >=44px, placeholder sin puntos, enlaces legibles y botón visible", async ({
    page,
  }) => {
    for (const roleRoute of ["/cliente", "/restaurante", "/domiciliario"]) {
      await page.goto(roleRoute);
      await assertNoHorizontalOverflow(page);

      const tabLogin = page.getByTestId("tab-login");
      const tabRegister = page.getByTestId("tab-register");
      for (const tab of [tabLogin, tabRegister]) {
        const box = await tab.boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }

      const pwdPlaceholder = await page.locator("#auth-password").getAttribute("placeholder");
      expect(pwdPlaceholder).not.toContain("•");

      await tabRegister.click();
      await expect(page.getByTestId("register-consents")).toBeVisible();
      await assertNoHorizontalOverflow(page);

      // Enlaces legales usan clase dg-inline-link (contraste sobre fondo claro)
      const inlineLink = page.getByTestId("register-consents").locator("a.dg-inline-link").first();
      await expect(inlineLink).toBeVisible();

      const submitBtn = page.getByRole("button", { name: "Registrarme" });
      await submitBtn.scrollIntoViewIfNeeded();
      await expect(submitBtn).toBeVisible();
      const submitBox = await submitBtn.boundingBox();
      expect(submitBox).not.toBeNull();
      if (submitBox) {
        expect(submitBox.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("portales autenticados de los 3 roles no desbordan, ocultan header duplicado y nada queda tapado por el menú inferior", async ({
    browser,
  }, testInfo) => {
    const longEmail =
      "cliente.con.correo.muy.largo.tocancipa.2026@restaurantes-domigoo.example.com";

    const roleRoutes: Record<"CUSTOMER" | "RESTAURANT" | "COURIER", string[]> = {
      CUSTOMER: [
        "/cliente",
        "/cliente/pedir",
        "/cliente/seguir",
        "/cliente/tarifa",
        "/cliente/cuenta",
      ],
      RESTAURANT: [
        "/restaurante",
        "/restaurante/negocio",
        "/restaurante/nuevo-domicilio",
        "/restaurante/pedidos",
        "/restaurante/cuenta",
      ],
      COURIER: [
        "/domiciliario",
        "/domiciliario/ubicacion",
        "/domiciliario/entrega",
        "/domiciliario/perfil",
        "/domiciliario/cuenta",
      ],
    };

    for (const [role, routes] of Object.entries(roleRoutes) as Array<
      ["CUSTOMER" | "RESTAURANT" | "COURIER", string[]]
    >) {
      const context = await browser.newContext({
        ...(testInfo.project.use.viewport ? { viewport: testInfo.project.use.viewport } : {}),
        ...(testInfo.project.use.baseURL ? { baseURL: testInfo.project.use.baseURL } : {}),
      });

      try {
        const page = await context.newPage();

        // Interceptar auth/me y endpoints básicos para auditar layout autenticado de cada rol
        await page.route("**/api/proxy/**", async (route) => {
          const url = route.request().url();
          if (url.includes("/auth/me")) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                id: "u-movil-1",
                email: longEmail,
                phoneE164: null,
                status: "ACTIVE",
              }),
            });
            return;
          }
          if (url.includes("/branches/mine") || url.includes("/offers/available")) {
            await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
            return;
          }
          if (url.includes("/restaurants/me")) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ id: "r-1", legalName: "Restaurante Demo", status: "ACTIVE" }),
            });
            return;
          }
          if (url.includes("/couriers/me")) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ id: "c-1", status: "APPROVED" }),
            });
            return;
          }
          if (url.includes("/orders")) {
            await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
            return;
          }
          await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        });

        await page.addInitScript((r) => {
          window.sessionStorage.setItem("domigoo_active_role", r);
        }, role);

        for (const route of routes) {
          await page.goto(route);
          await expect(page.locator(".dg-role-topbar")).toBeVisible();
          await assertNoHorizontalOverflow(page);

          // Encabezado del sitio oculto en móvil cuando hay portal autenticado
          await expect(page.locator("header.dg-header")).toBeHidden();

          const logoutBtn = page.getByRole("button", { name: /Cerrar sesión/i });
          const logoutBox = await logoutBtn.boundingBox();
          expect(logoutBox).not.toBeNull();
          if (logoutBox) {
            expect(logoutBox.height).toBeGreaterThanOrEqual(44);
          }

          // Ningún botón/input clave al final queda tapado por el menú inferior
          const lastInteractive = page
            .locator(".dg-role-content button, .dg-role-content input, .dg-role-content a.dg-btn")
            .last();
          if ((await lastInteractive.count()) > 0 && (await lastInteractive.isVisible())) {
            await assertNotCoveredByBottomNav(page, lastInteractive);
          }
        }
      } finally {
        await context.close();
      }
    }
  });
});
