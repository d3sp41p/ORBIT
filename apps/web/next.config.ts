import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// Local development keeps one .env.local at the repo root for web and worker.
loadEnvConfig(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * The only environment variables allowed to reach the browser.
 * Secrets (service role, Helius, Anthropic) must never be added here.
 */
const PUBLIC_ENV = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "TOKEN_MINT",
  "TOKEN_TICKER",
  "TOKEN_NAME",
  "BUY_URL",
  "X_URL",
  "MIN_HOLDING_TOKENS",
] as const;

const nextConfig: NextConfig = {
  transpilePackages: ["@orbit/core"],
  env: Object.fromEntries(PUBLIC_ENV.map((key) => [key, process.env[key] ?? ""])),
  poweredByHeader: false,
};

export default nextConfig;
