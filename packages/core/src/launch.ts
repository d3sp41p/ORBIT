/**
 * Automatic launch detection: while armed, transactions of the dev wallet
 * arrive by webhook; a pump.fun create signed by that wallet reveals the new
 * mint. The name and ticker are then checked against the expected ones, so a
 * different token made from the same wallet is never picked up.
 */

export const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/** Raw transaction as from getTransaction (json) or a Helius "raw" webhook. */
export interface RawLaunchTx {
  transaction: {
    signatures: string[];
    message: {
      accountKeys: (string | { pubkey: string })[];
      instructions?: { programIdIndex: number }[];
    };
  };
  meta?: {
    err?: unknown;
    preTokenBalances?: { mint: string }[] | null;
    postTokenBalances?: { mint: string }[] | null;
  } | null;
}

const key = (k: string | { pubkey: string }) => (typeof k === "string" ? k : k.pubkey);

/** Fee payer (first signer) of a transaction. */
export const feePayer = (tx: RawLaunchTx) => {
  const first = tx.transaction.message.accountKeys[0];
  return first ? key(first) : null;
};

/**
 * Mints created by `devWallet` through pump.fun in this transaction: mints
 * that have token balances after it and none before it.
 */
export function launchCandidates(tx: RawLaunchTx, devWallet: string): string[] {
  if (tx.meta?.err) return [];
  if (feePayer(tx) !== devWallet) return [];
  const keys = tx.transaction.message.accountKeys.map(key);
  const programs = new Set(
    (tx.transaction.message.instructions ?? []).map((i) => keys[i.programIdIndex]),
  );
  if (!programs.has(PUMP_FUN_PROGRAM)) return [];
  const before = new Set((tx.meta?.preTokenBalances ?? []).map((b) => b.mint));
  return [...new Set((tx.meta?.postTokenBalances ?? []).map((b) => b.mint))].filter(
    (m) => !before.has(m),
  );
}

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/^\$/, "").toLowerCase();

/** Whether token metadata matches the expected ticker and name (case and "$" ignored). */
export function matchesExpected(
  asset: { symbol?: string | null; name?: string | null },
  expected: { ticker?: string | null; name?: string | null },
): boolean {
  if (!norm(expected.ticker) && !norm(expected.name)) return false;
  if (norm(expected.ticker) && norm(asset.symbol) !== norm(expected.ticker)) return false;
  if (norm(expected.name) && norm(asset.name) !== norm(expected.name)) return false;
  return true;
}

/** Default buy link for a pump.fun token. */
export const pumpFunUrl = (mint: string) => `https://pump.fun/coin/${mint}`;
