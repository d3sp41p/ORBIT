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
  "TOKEN_LAUNCHED",
  "TOKEN_TICKER",
  "TOKEN_NAME",
  "BUY_URL",
  "X_URL",
  "MIN_HOLDING_TOKENS",
] as const;

const nextConfig: NextConfig = {
  transpilePackages: ["@orbit/core"],
  env: {
    ...Object.fromEntries(PUBLIC_ENV.map((key) => [key, process.env[key] ?? ""])),
    // Contract address for the browser. Before launch TOKEN_MINT is a stand-in
    // token used for testing, so it stays out of the bundle. (Values in "env"
    // are inlined at build time on the server too, so server code keeps
    // reading TOKEN_MINT itself.)
    PUBLIC_TOKEN_MINT: process.env.TOKEN_LAUNCHED === "1" ? (process.env.TOKEN_MINT ?? "") : "",
  },
  poweredByHeader: false,
};

export default nextConfig;
