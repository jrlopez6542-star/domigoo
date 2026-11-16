import { randomBytes } from "node:crypto";
import { readEnv } from "./env.js";

describe("readEnv", () => {
  const databaseUrl = "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";
  const pinPepper = randomBytes(32).toString("base64");
  const dataEncryptionKey = randomBytes(32).toString("base64");

  function complete(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      DATABASE_URL: databaseUrl,
      PIN_PEPPER: pinPepper,
      DATA_ENCRYPTION_KEY: dataEncryptionKey,
      ...extra,
    };
  }

  it("exige una URL de PostgreSQL", () => {
    expect(() => readEnv({ DATABASE_URL: "mysql://localhost/domigoo" })).toThrow(/postgres/);
    expect(() => readEnv({})).toThrow(/DATABASE_URL/);
  });

  it("exige las dos claves del PIN, de 32 bytes y sin imprimirlas", () => {
    expect(() => readEnv({ DATABASE_URL: databaseUrl })).toThrow(/PIN_PEPPER/);
    expect(() => readEnv({ ...complete(), DATA_ENCRYPTION_KEY: "corta" })).toThrow(
      /DATA_ENCRYPTION_KEY/,
    );
    expect(() => readEnv(complete())).not.toThrow();
  });

  it("usa DOMIGOO cuando APP_NAME no viene", () => {
    expect(readEnv(complete()).appName).toBe("DOMIGOO");
  });

  it("respeta APP_NAME", () => {
    expect(readEnv(complete({ APP_NAME: "Nombre local" })).appName).toBe("Nombre local");
  });
});
