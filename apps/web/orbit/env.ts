import { DEMO } from "@orbit/core";

/**
 * Public branding and links. Values come from the public env variables
 * exposed in next.config.ts; until the coin is live the demo values apply.
 */
export const brand = {
  name: process.env.TOKEN_NAME || DEMO.name,
  ticker: process.env.TOKEN_TICKER || DEMO.ticker,
  /**
   * The real contract address is shown only once TOKEN_LAUNCHED=1. Before the
   * launch TOKEN_MINT may point at a stand-in token used for testing, which
   * must never be presented as ours.
   */
  contract: process.env.PUBLIC_TOKEN_MINT || DEMO.contract,
  buyUrl: process.env.BUY_URL || "#",
  xUrl: process.env.X_URL || "#",
  /** Minimum balance (whole tokens) to become a planet. */
  minHolding: Number(process.env.MIN_HOLDING_TOKENS) || 100_000,
};
