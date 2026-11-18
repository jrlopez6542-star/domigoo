import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile-iphone-13",
      testMatch: /mobile\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-android-360",
      testMatch: /mobile\.spec\.ts/,
      use: {
        viewport: { width: 360, height: 780 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  use: {
    baseURL: process.env["WEB_BASE_URL"] || "http://127.0.0.1:3000",
    headless: true,
    ...(process.env["VERCEL_AUTOMATION_BYPASS_SECRET"]
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": process.env["VERCEL_AUTOMATION_BYPASS_SECRET"],
          },
        }
      : {}),
    launchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      ...(process.env["PLAYWRIGHT_EXECUTABLE_PATH"]
        ? { executablePath: process.env["PLAYWRIGHT_EXECUTABLE_PATH"] }
        : {}),
    },
  },
});
