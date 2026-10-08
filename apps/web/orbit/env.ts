import { DEMO } from "@orbit/core";

/**
 * Public branding and links. Values come from the public env variables
 * exposed in next.config.ts; until the coin is live the demo values apply.
 */
export const brand = {
  name: process.env.TOKEN_NAME || DEMO.name,
  ticker: process.env.TOKEN_TICKER || DEMO.ticker,
  contract: process.env.TOKEN_MINT || DEMO.contract,
  buyUrl: process.env.BUY_URL || "#",
  xUrl: process.env.X_URL || "#",
};
