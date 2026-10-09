import { expect, test, type Page } from "@playwright/test";

/**
 * The visitor's path (spec: "E2E on Playwright"): open the site, find a planet
 * by address and by name, open its mission page, follow a planet link, use
 * the text view and the FAQ, and open the wallet picker with a test wallet.
 * Signing in and renaming need the database: scripts in apps/worker/scripts
 * (wallet-e2e.ts) cover them against a configured environment.
 */

async function ready(page: Page) {
  // The loading screen goes away once the 3D system is built.
  await expect(page.locator("#loading")).toHaveClass(/gone/, { timeout: 60_000 });
}

const panelTitle = (page: Page) => page.locator("#panel .m-head h2");

async function search(page: Page, q: string) {
  await page.locator("#search").fill(q);
  await page.locator("#searchForm button[type=submit]").click();
}

test("find a planet by address and name, open it, follow its link", async ({ page }) => {
  await page.goto("/");
  await ready(page);

  // "Visit #1" opens the biggest holder.
  await page.locator("#topBtn").click();
  await expect(panelTitle(page)).toBeVisible();
  const name = (await panelTitle(page).textContent())!.trim();
  const wallet = (await page.locator("#panel .addr span").textContent())!.trim();
  expect(wallet).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  await expect(page).toHaveURL(new RegExp(`/planet/${wallet}$`));
  await expect(page.locator("#panel")).toContainText("Fast facts");
  await expect(page.locator("#panel")).toContainText("Mission report");

  // Escape closes the mission page.
  await page.keyboard.press("Escape");
  await expect(page.locator("#panel")).toBeHidden();

  // Full address, part of it, and the name.
  await search(page, wallet);
  await expect(panelTitle(page)).toHaveText(name);
  await page.keyboard.press("Escape");
  await search(page, wallet.slice(0, 10));
  await expect(panelTitle(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await search(page, name);
  await expect(panelTitle(page)).toHaveText(name);

  // The planet link opens the system and flies to that planet.
  await page.goto(`/planet/${wallet}`);
  await ready(page);
  await expect(panelTitle(page)).toHaveText(name);
});

test("text view lists every world and opens mission pages", async ({ page }) => {
  await page.goto("/?text=1");
  const rows = page.locator(".tlist button");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(50);
  const first = (await rows.first().locator("b").textContent())!.trim();
  await page.locator("#tFilter").fill(first);
  await expect(rows.first().locator("b")).toHaveText(first);
  await rows.first().click();
  await expect(panelTitle(page)).toHaveText(first);
});

test("FAQ and disclaimer are in place", async ({ page }) => {
  await page.goto("/faq");
  await expect(page.locator("h1")).toContainText("Questions");
  await expect(page.locator("body")).toContainText("We will never ask you to sign a transaction");
  await expect(page.locator("#disclaimer")).toContainText("financial, investment or legal advice");
});

test("wallet picker shows Solana wallets and never mentions a transaction to sign", async ({
  page,
}) => {
  // A Wallet Standard test wallet, registered the way Phantom and Solflare register.
  await page.addInitScript(() => {
    const wallet = {
      version: "1.0.0",
      name: "Test Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      chains: ["solana:mainnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signMessage": { version: "1.0.0", signMessage: async () => [] },
      },
    };
    const register = () =>
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: ({ register }: { register: (w: unknown) => void }) => register(wallet),
        }),
      );
    window.addEventListener("wallet-standard:app-ready", register);
    register();
  });
  await page.goto("/");
  await ready(page);
  await page.locator("#connectBtn").click();
  const dialog = page.locator(".wdlg");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("never ask you to sign a transaction");
  await expect(dialog.locator(".wlist button")).toContainText("Test Wallet");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
