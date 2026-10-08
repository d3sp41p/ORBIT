import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAddressList, type Exclusions } from "@orbit/core";
import dotenv from "dotenv";

// Local development: one .env.local at the repo root. In production the host
// provides the variables and this file does not exist.
const rootEnv = fileURLToPath(new URL("../../../.env.local", import.meta.url));
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv, quiet: true });

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export interface WorkerConfig {
  port: number;
  mint: string;
  heliusKey: string;
  dbUrl: string;
  minHoldingTokens: number;
  exclusions: Exclusions;
  /** Reconciliation snapshot interval (spec: 60 s; larger saves Helius credits). */
  snapshotSec: number;
  /** Max transactions to read when restoring history on first start. */
  backfillLimit: number;
}

export function loadConfig(): WorkerConfig {
  return {
    port: Number(process.env.PORT ?? 8080),
    mint: required("TOKEN_MINT"),
    heliusKey: required("HELIUS_API_KEY"),
    dbUrl: required("SUPABASE_DB_URL"),
    minHoldingTokens: Number(process.env.MIN_HOLDING_TOKENS) || 100_000,
    exclusions: {
      excluded: parseAddressList(process.env.EXCLUDED_WALLETS),
      included: parseAddressList(process.env.INCLUDED_WALLETS),
    },
    snapshotSec: Number(process.env.SNAPSHOT_INTERVAL_SEC) || 60,
    backfillLimit: Number(process.env.BACKFILL_LIMIT) || 20_000,
  };
}
