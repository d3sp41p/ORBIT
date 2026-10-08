/**
 * Public token facts for rendering. Read from system_state (maintained by the
 * worker from token_config) so the site switches to the coin at launch
 * without a rebuild. The contract address is set only after launch.
 */
import { DEMO } from "@orbit/core";

export interface PublicToken {
  name: string;
  ticker: string;
  /** Contract address to show; the demo placeholder until launch. */
  contract: string;
  buyUrl: string;
  xUrl: string;
  launched: boolean;
  minHolding: number;
}

export const fallbackToken = (): PublicToken => ({
  name: process.env.TOKEN_NAME || DEMO.name,
  ticker: process.env.TOKEN_TICKER || DEMO.ticker,
  contract: DEMO.contract,
  buyUrl: process.env.BUY_URL || "#",
  xUrl: process.env.X_URL || "#",
  launched: false,
  minHolding: Number(process.env.MIN_HOLDING_TOKENS) || 100_000,
});

/** Server only. Cached for 15 seconds. */
export async function getPublicToken(): Promise<PublicToken> {
  const base = fallbackToken();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return base;
  try {
    const res = await fetch(
      `${url}/rest/v1/system_state?id=eq.1&select=token_mint,token_ticker,token_name,buy_url,x_url,launched`,
      { headers: { apikey: key }, next: { revalidate: 15 } },
    );
    if (!res.ok) return base;
    const [s] = (await res.json()) as {
      token_mint: string | null;
      token_ticker: string | null;
      token_name: string | null;
      buy_url: string | null;
      x_url: string | null;
      launched: boolean;
    }[];
    if (!s) return base;
    return {
      ...base,
      name: s.token_name || base.name,
      ticker: (s.token_ticker || base.ticker).replace(/^\$/, ""),
      contract: (s.launched && s.token_mint) || base.contract,
      buyUrl: s.buy_url || base.buyUrl,
      xUrl: s.x_url || base.xUrl,
      launched: s.launched,
    };
  } catch {
    return base;
  }
}
