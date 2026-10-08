/**
 * Helius webhook (type "raw", account: TOKEN_MINT). Verifies the shared
 * secret, turns transactions into chain events and stores them in
 * chain_events. Duplicates are ignored by the (sig, ix_index) key, so a
 * repeated webhook never creates a second event. The worker applies them.
 */
import { timingSafeEqual } from "node:crypto";
import {
  chainEvents,
  feePayer,
  parseAddressList,
  toChainTx,
  type ChainEvent,
  type RawLaunchTx,
} from "@orbit/core";

export const dynamic = "force-dynamic";

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

function secretMatches(got: string | null, want: string) {
  if (!got) return false;
  const a = Buffer.from(got.replace(/^Bearer\s+/i, ""));
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function supabase(path: string, init: RequestInit) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  // Legacy JWT keys also need the Authorization header; new sb_secret_ keys do not.
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  return fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
}

interface TokenConfig {
  mint: string | null;
  armed: boolean;
  dev_wallet: string | null;
  excluded_wallets: string[];
  included_wallets: string[];
}

/** token_config, cached briefly: webhooks can arrive many times a second. */
let cached: { at: number; value: TokenConfig | null } | null = null;
async function tokenConfig(): Promise<TokenConfig | null> {
  if (cached && Date.now() - cached.at < 5000) return cached.value;
  const res = await supabase(
    "token_config?id=eq.1&select=mint,armed,dev_wallet,excluded_wallets,included_wallets",
    { method: "GET" },
  );
  const value = res.ok ? (((await res.json()) as TokenConfig[])[0] ?? null) : null;
  cached = { at: Date.now(), value };
  return value;
}

export async function POST(req: Request) {
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  const missing = Object.entries({
    HELIUS_WEBHOOK_SECRET: secret,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length)
    return error(503, "not_configured", `Webhook is not configured: ${missing.join(", ")}`);
  if (!secret) return error(503, "not_configured", "Webhook is not configured");
  if (!secretMatches(req.headers.get("authorization"), secret))
    return error(401, "unauthorized", "Bad webhook secret");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(400, "bad_json", "Body is not JSON");
  }
  const items = Array.isArray(body) ? body : [body];
  const cfg = await tokenConfig();
  // The coin from the database; TOKEN_MINT (stand-in) only in development.
  const mint = cfg?.mint ?? process.env.TOKEN_MINT ?? null;

  // Armed for launch: keep the dev wallet's own transactions for the worker.
  let watched = 0;
  if (cfg?.armed && cfg.dev_wallet) {
    const mine = items.filter((it) => {
      try {
        return feePayer(it as RawLaunchTx) === cfg.dev_wallet;
      } catch {
        return false;
      }
    });
    if (mine.length) {
      const res = await supabase("launch_inbox?on_conflict=sig", {
        method: "POST",
        headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(
          mine.map((it) => ({ sig: (it as RawLaunchTx).transaction.signatures[0], raw: it })),
        ),
      });
      if (!res.ok) return error(502, "db_error", `Database rejected launch data (${res.status})`);
      watched = mine.length;
    }
  }

  const exclusions = {
    excluded: new Set([
      ...parseAddressList(process.env.EXCLUDED_WALLETS),
      ...(cfg?.excluded_wallets ?? []),
    ]),
    included: new Set([
      ...parseAddressList(process.env.INCLUDED_WALLETS),
      ...(cfg?.included_wallets ?? []),
    ]),
  };
  const events: ChainEvent[] = [];
  for (const item of mint ? items : []) {
    try {
      events.push(
        ...chainEvents(toChainTx(item as Parameters<typeof toChainTx>[0]), mint!, exclusions),
      );
    } catch {
      // not a transaction we understand: skip it, keep the rest
    }
  }

  if (events.length) {
    const res = await supabase("chain_events?on_conflict=sig,ix_index", {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(
        events.map((e) => ({
          sig: e.sig,
          ix_index: e.ixIndex,
          wallet: e.wallet,
          kind: e.kind,
          amount: e.amount.toString(),
          balance_before: e.balanceBefore.toString(),
          balance_after: e.balanceAfter.toString(),
          block_time: new Date(e.at).toISOString(),
          slot: e.slot,
          source: "webhook",
        })),
      ),
    });
    if (!res.ok) return error(502, "db_error", `Database rejected events (${res.status})`);
  }
  await supabase("system_state?id=eq.1", {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ last_webhook_at: new Date().toISOString() }),
  });
  return Response.json({ ok: true, transactions: items.length, events: events.length, watched });
}
