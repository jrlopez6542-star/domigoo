import { expect, test } from "@playwright/test";

test.describe("Admin de verificación y suscripciones (M31)", () => {
  test("muestra reconocimiento de declaración y no ofrece cobro de tarjeta", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Panel Administrativo/i);
    await expect(page.getByRole("button", { name: "Reconocer declaración de pago" })).toBeVisible();
    await expect(page.getByText(/cobrar tarjeta/i)).toHaveCount(0);
  });

  test("todas las imágenes de la pantalla de ingreso responden 200 y cargan con naturalWidth > 0", async ({
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
