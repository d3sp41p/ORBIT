import type { NextConfig } from "next";
import { loadRootEnv } from "./load-root-env";

loadRootEnv(process.cwd());

/**
 * The only environment variables allowed to reach the browser.
 * Secrets (service role, Helius, Anthropic) must never be added here.
 */
const PUBLIC_ENV = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "TOKEN_TICKER",
  "TOKEN_NAME",
  "BUY_URL",
  "X_URL",
  "MIN_HOLDING_TOKENS",
  // Sentry DSN: public by design, the browser needs it to report errors.
  "SENTRY_DSN",
] as const;

const nextConfig: NextConfig = {
  transpilePackages: ["@orbit/core"],
  // The contract address and links are not build-time values: the site reads
  // them from the database (lib/token.ts) so it switches at launch instantly.
  env: Object.fromEntries(PUBLIC_ENV.map((key) => [key, process.env[key] ?? ""])),
  poweredByHeader: false,
};

export default nextConfig;
