import fs from "node:fs";
import path from "node:path";
import { CourierApiClient } from "./api/client.js";
import {
  nextScreenAfterLogin,
  sanitizeOfferForDisplay,
  sanitizeOrderForDisplay,
  screenForOrderStatus,
} from "./state/courier-machine.js";

describe("App del domiciliario @domigoo/movil (M32 y M33)", () => {
  it("app.json declara únicamente Android y no incluye iOS ni SDK de pagos", () => {
    const appJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "app.json"), "utf8"),
    ) as { expo: { platforms: string[]; ios?: unknown } };
    expect(appJson.expo.platforms).toEqual(["android"]);
    expect(appJson.expo.ios).toBeUndefined();

    const pkgJson = fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8");
    expect(pkgJson).not.toMatch(/stripe|mercadopago|wompi|epayco|paypal/i);
  });

  it("una oferta pendiente oculta el teléfono del cliente", () => {
    const pending = sanitizeOfferForDisplay({
      id: "off-1",
      orderId: "ord-1",
      status: "PENDING",
      deliveryFeeCop: 6500,
      pickupAddress: "Calle 10 # 20-30",
      dropoffAddress: "Carrera 15 # 40-50",
      customerPhone: "+573001112233",
    });
    expect(pending.customerPhone).toBeNull();

    const accepted = sanitizeOfferForDisplay({
      id: "off-1",
      orderId: "ord-1",
      status: "ACCEPTED",
      deliveryFeeCop: 6500,
      pickupAddress: "Calle 10 # 20-30",
      dropoffAddress: "Carrera 15 # 40-50",
      customerPhone: "+573001112233",
    });
    expect(accepted.customerPhone).toBe("+573001112233");
  });

  it("exige consentimiento de geolocalización antes de enviar la posición", async () => {
    let called = false;
    const client = new CourierApiClient("http://127.0.0.1:3001", () => {
      called = true;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    });

    await expect(
      client.sendLocation({
        hasGeolocationConsent: false,
        longitude: -74.08,
        latitude: 4.61,
      }),
    ).rejects.toThrow(/consentimiento/i);
    expect(called).toBe(false);

    const ok = await client.sendLocation({
      hasGeolocationConsent: true,
      longitude: -74.08,
      latitude: 4.61,
    });
    expect(ok.recorded).toBe(true);
    expect(called).toBe(true);
  });

  it("envía el PIN digitado al endpoint y nunca pinta PIN devuelto por el servidor ni lo registra en logs", async () => {
    const calls: Array<{ input: string; body?: string }> = [];
    const client = new CourierApiClient("http://127.0.0.1:3001", (input, init) => {
      calls.push({ input, ...(init?.body !== undefined ? { body: init.body } : {}) });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: "PICKED_UP", pickupPin: "9999" }),
      });
    });

    await client.submitPickupPin("ord-1", "4821");
    expect(calls[0]?.input).toBe("http://127.0.0.1:3001/v1/orders/ord-1/pickup-pin");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ pin: "4821" });

    // La vista sanitizada del pedido nunca expone pickupPin ni deliveryPin
    const view = sanitizeOrderForDisplay({
      id: "ord-1",
      status: "PICKED_UP",
      customerPhone: "+573001112233",
    });
    expect("pickupPin" in view).toBe(false);
    expect("deliveryPin" in view).toBe(false);

    // Máquina de pantallas
    expect(nextScreenAfterLogin(false)).toBe("PROFILE");
    expect(nextScreenAfterLogin(true)).toBe("AVAILABILITY");
    expect(screenForOrderStatus("AT_PICKUP")).toBe("PIN_PICKUP");
    expect(screenForOrderStatus("AT_DROPOFF")).toBe("PIN_DELIVERY");
    expect(screenForOrderStatus("DELIVERED")).toBe("DONE");

    const appSource = fs.readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(appSource).not.toMatch(/console\.(log|info|debug)\s*\([^)]*pin/i);
  });
});
