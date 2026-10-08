import type { NextConfig } from "next";

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
] as const;

const nextConfig: NextConfig = {
  transpilePackages: ["@orbit/core"],
  env: Object.fromEntries(PUBLIC_ENV.map((key) => [key, process.env[key] ?? ""])),
  poweredByHeader: false,
};

export default nextConfig;
