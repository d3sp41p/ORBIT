import { defineConfig } from "@playwright/test";

/**
 * Browser tests of the built site (spec: "E2E on Playwright"). Before launch
 * the site shows the demo system, so they need no database or keys.
 * CI uses Playwright's Chromium; locally the installed Chrome.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.e2e.ts",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: "http://localhost:3000",
    channel: process.env.CI ? undefined : "chrome",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "pnpm --filter @orbit/web start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
