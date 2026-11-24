import fs from "node:fs";
import path from "node:path";
describe("ORDEN 008 - Correcciones Admin", () => {
  it("rehidrata sesión con auth/me, maneja estados de carga y codifica IDs con encodeURIComponent", () => {
    const adminContent = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/admin-portal.tsx"),
      "utf8",
    );
    expect(adminContent).toContain("checkingSession");
    expect(adminContent).toContain("loadingAction");
    expect(adminContent).toContain('callProxy<{ id?: string } | null>("auth/me", "GET")');
    expect(adminContent).toContain("encodeURIComponent(caseId.trim())");
    expect(adminContent).toContain("encodeURIComponent(declarationId.trim())");
  });

  it("proxy admin rechaza segmentos '.' y '..' con 404 antes de armar la URL", async () => {
    const { GET } = await import("../app/api/proxy/[...path]/route.js");
    const origFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = () => {
      fetchCalled = true;
      return Promise.reject(new Error("fetch no debe llamarse"));
    };
    try {
      for (const badPath of [
        ["admin", "..", "stats"],
        ["admin", ".", "stats"],
      ]) {
        const res = await GET(
          {
            method: "GET",
            headers: new Headers(),
            nextUrl: { search: "" },
          } as unknown as Parameters<typeof GET>[0],
          { params: Promise.resolve({ path: badPath }) },
        );
        expect(res.status).toBe(404);
      }
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
