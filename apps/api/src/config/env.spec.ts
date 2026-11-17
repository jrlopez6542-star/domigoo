import { readEnv } from "./env.js";

describe("readEnv", () => {
  const databaseUrl = "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo";

  it("exige una URL de PostgreSQL", () => {
    expect(() => readEnv({ DATABASE_URL: "mysql://localhost/domigoo" })).toThrow(/postgres/);
    expect(() => readEnv({})).toThrow(/DATABASE_URL/);
  });

  it("usa DOMIGOO cuando APP_NAME no viene", () => {
    expect(readEnv({ DATABASE_URL: databaseUrl }).appName).toBe("DOMIGOO");
  });

  it("respeta APP_NAME", () => {
    expect(readEnv({ DATABASE_URL: databaseUrl, APP_NAME: "Nombre local" }).appName).toBe(
      "Nombre local",
    );
  });
});
