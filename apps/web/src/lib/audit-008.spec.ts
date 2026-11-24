import fs from "node:fs";
import path from "node:path";
import { pickActiveCourierOrder, sanitizeMarkdownHref } from "./portal-helpers.js";
describe("ORDEN 008 - Correcciones Web", () => {
  it("BUG-03: pickActiveCourierOrder ignora pedidos terminales y devuelve null si no hay activos", () => {
    expect(
      pickActiveCourierOrder([
        { id: "o1", status: "DELIVERED" },
        { id: "o2", status: "CANCELLED_ADMIN" },
      ]),
    ).toBeNull();
    expect(
      pickActiveCourierOrder([
        { id: "o1", status: "DELIVERED" },
        { id: "o2", status: "ARRIVING_PICKUP" },
      ]),
    ).toEqual({ id: "o2", status: "ARRIVING_PICKUP" });
  });
  it("SEC-08: sanitizeMarkdownHref permite solo http(s), mailto y rutas relativas", () => {
    expect(sanitizeMarkdownHref("https://domigoo.co/legal")).toBe("https://domigoo.co/legal");
    expect(sanitizeMarkdownHref("http://localhost:3000/test")).toBe("http://localhost:3000/test");
    expect(sanitizeMarkdownHref("mailto:soporte@domigoo.co")).toBe("mailto:soporte@domigoo.co");
    expect(sanitizeMarkdownHref("/legal/privacidad")).toBe("/legal/privacidad");
    expect(sanitizeMarkdownHref("#seccion")).toBe("#seccion");
    expect(sanitizeMarkdownHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeMarkdownHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(sanitizeMarkdownHref("//evil.example/phish")).toBeNull();
  });
  it("BUG-04 web, SEC-08 y BUG-06 parcial en componentes web y admin", () => {
    const restContent = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/restaurant-portal.tsx"),
      "utf8",
    );
    expect(restContent).not.toContain('setOrderId((prev) => prev || list[0]?.id || "")');
    expect(restContent).toContain("encodeURIComponent(res.token)");
    expect(restContent).toContain("encodeURIComponent(geoConsentId)");
    const homeContent = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/home-landing.tsx"),
      "utf8",
    );
    expect(homeContent).not.toContain("/cliente#seguimiento");
    expect(homeContent).toContain('href="/cliente/seguir"');
  });
});
