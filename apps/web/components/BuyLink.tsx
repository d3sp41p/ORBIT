"use client";

import { useState } from "react";
import type { PublicToken } from "@/lib/token";
import { copy as t } from "@/orbit/copy";

/**
 * "Buy $TICKER": after launch it opens the coin on pump.fun (the worker sets
 * the link the moment the coin is created). Before launch there is nothing
 * to buy yet, so a click only says when it opens.
 */
export default function BuyLink({
  token,
  className,
  id,
}: {
  token: PublicToken;
  className?: string;
  id?: string;
}) {
  const [soon, setSoon] = useState(false);
  const live = token.launched && /^https?:\/\//.test(token.buyUrl);
  if (live)
    return (
      <a
        className={className}
        id={id}
        href={token.buyUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t.buy(token.ticker)}
      </a>
    );
  return (
    <button
      type="button"
      className={className}
      id={id}
      aria-live="polite"
      onClick={() => {
        setSoon(true);
        window.setTimeout(() => setSoon(false), 2200);
      }}
    >
      {soon ? t.buySoon : t.buy(token.ticker)}
    </button>
  );
}
