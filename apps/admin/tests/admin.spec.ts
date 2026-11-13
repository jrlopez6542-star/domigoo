import { expect, test } from "@playwright/test";

test.describe("Admin de verificación y suscripciones (M31)", () => {
  test("muestra reconocimiento de declaración y no ofrece cobro de tarjeta", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Panel Administrativo/i);
    await expect(page.getByRole("button", { name: "Reconocer declaración de pago" })).toBeVisible();
    await expect(page.getByText(/cobrar tarjeta/i)).toHaveCount(0);
  });
});
