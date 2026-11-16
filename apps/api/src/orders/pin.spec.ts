import {
  generatePin,
  macsEqual,
  openPin,
  pinDecision,
  pinMac,
  sealPin,
  showsPickupPin,
} from "./pin.js";

const pepper = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const key = Uint8Array.from({ length: 32 }, (_, index) => index + 33);

describe("PIN", () => {
  it("rechaza el sesgo de módulo y arma solo dígitos", () => {
    const draws = [Uint8Array.of(255, 250, 249, 0), Uint8Array.of(10, 11)];
    const pin = generatePin(4, () => {
      const next = draws.shift();
      if (next === undefined) {
        throw new Error("faltaron bytes");
      }
      return next;
    });
    expect(pin).toBe("9001");
  });

  it("permite el intento mientras no se llega al máximo", () => {
    expect(pinDecision(4, 5)).toBe("allow");
    expect(pinDecision(5, 5)).toBe("locked");
  });

  it("el cifrado no se abre con otro pedido o con el otro tipo", () => {
    const sealed = sealPin(key, "pedido-1", "PICKUP", "123456");
    expect(openPin(key, "pedido-1", "PICKUP", sealed)).toBe("123456");
    expect(openPin(key, "pedido-2", "PICKUP", sealed)).toBeNull();
    expect(openPin(key, "pedido-1", "DELIVERY", sealed)).toBeNull();
    expect(sealed).not.toContain("123456");
  });

  it("compara el HMAC en bloques del mismo tamaño", () => {
    const mac = pinMac(pepper, "pedido-1", "PICKUP", "123456");
    expect(macsEqual(mac, pinMac(pepper, "pedido-1", "PICKUP", "123456"))).toBe(true);
    expect(macsEqual(mac, pinMac(pepper, "pedido-1", "PICKUP", "123457"))).toBe(false);
    expect(macsEqual(mac, pinMac(pepper, "pedido-1", "DELIVERY", "123456"))).toBe(false);
  });

  it("muestra el PIN de recogida solo en los estados de recogida", () => {
    expect(showsPickupPin("ACCEPTED")).toBe(true);
    expect(showsPickupPin("ARRIVING_PICKUP")).toBe(true);
    expect(showsPickupPin("AT_PICKUP")).toBe(true);
    expect(showsPickupPin("PICKED_UP")).toBe(false);
    expect(showsPickupPin("AT_DROPOFF")).toBe(false);
    expect(showsPickupPin("DELIVERED")).toBe(false);
  });
});
