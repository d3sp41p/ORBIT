import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the built site (spec: "E2E on Playwright"). Before launch
 * the site shows the demo system, so they need no database or keys.
 * CI runs Chromium, Firefox and WebKit (Safari's engine) plus phone
 * emulation; locally only the installed Chrome.
 */
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.e2e.ts",
  timeout: 120_000,
  retries: ci ? 1 : 0,
  reporter: ci ? "list" : "line",
  use: { baseURL: "http://localhost:3000" },
  projects: ci
    ? [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
        { name: "iphone", use: { ...devices["iPhone 15"] } },
        { name: "android", use: { ...devices["Pixel 7"] } },
      ]
    : [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: "pnpm --filter @orbit/web start",
    url: "http://localhost:3000",
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
