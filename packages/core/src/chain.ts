/**
 * Chain rules (spec: "Data from the blockchain"). Pure functions shared by the
 * webhook route, the indexer and tests:
 * - a holder is an owner wallet; balances of all its token accounts are summed
 * - program-owned accounts (pump.fun bonding curve, liquidity pools: addresses
 *   off the ed25519 curve) and EXCLUDED_WALLETS never become planets
 * - a planet is born when the balance crosses MIN_HOLDING_TOKENS from below and
 *   dies when it falls below it; a transfer is a sell for the sender and a buy
 *   for the receiver
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { DAY_MS } from "./math";
import type { Sell } from "./sim";

/* ================= addresses ================= */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = new Map([...B58].map((c, i) => [c, i]));

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const v = B58_MAP.get(c);
    if (v === undefined) throw new Error("invalid base58");
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** True for a normal wallet; false for program-derived accounts (PDAs). */
export function isOnCurve(address: string): boolean {
  try {
    const bytes = base58Decode(address);
    if (bytes.length !== 32) return false;
    ed25519.Point.fromBytes(bytes, true);
    return true;
  } catch {
    return false;
  }
}

export interface Exclusions {
  /** Manually excluded wallets (burn address, team wallets...). */
  excluded: ReadonlySet<string>;
  /** Program-owned wallets to keep anyway (e.g. a multisig vault). */
  included: ReadonlySet<string>;
}

export const parseAddressList = (v: string | undefined) =>
  new Set(
    (v ?? "")
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  );

/** Whether a wallet can be a planet. */
export function isEligible(wallet: string, ex: Exclusions): boolean {
  if (ex.excluded.has(wallet)) return false;
  if (ex.included.has(wallet)) return true;
  return isOnCurve(wallet);
}

/* ================= amounts ================= */

/** Raw on-chain amount for a whole-token amount (e.g. MIN_HOLDING_TOKENS). */
export const toRaw = (tokens: number, decimals: number) =>
  BigInt(Math.round(tokens)) * 10n ** BigInt(decimals);

/** Whole tokens as a number (display and ranking only). */
export const fromRaw = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

/* ================= transactions ================= */

/** Token balance entry as in RPC `meta.preTokenBalances` / `postTokenBalances`. */
export interface RpcTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

/** The part of an RPC / Helius raw transaction the indexer needs. */
export interface ChainTx {
  signature: string;
  slot: number;
  /** Seconds since epoch. */
  blockTime: number;
  failed: boolean;
  preTokenBalances: RpcTokenBalance[];
  postTokenBalances: RpcTokenBalance[];
}

/** Map an RPC getTransaction result or a Helius "raw" webhook item to ChainTx. */
export function toChainTx(raw: {
  slot: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    preTokenBalances?: RpcTokenBalance[] | null;
    postTokenBalances?: RpcTokenBalance[] | null;
  } | null;
  transaction: { signatures: string[] };
}): ChainTx {
  return {
    signature: raw.transaction.signatures[0]!,
    slot: raw.slot,
    blockTime: raw.blockTime ?? 0,
    failed: !!raw.meta?.err,
    preTokenBalances: raw.meta?.preTokenBalances ?? [],
    postTokenBalances: raw.meta?.postTokenBalances ?? [],
  };
}

export interface OwnerChange {
  owner: string;
  before: bigint;
  after: bigint;
  delta: bigint;
  decimals: number;
}

/** Net balance change per owner for one mint, summed over the owner's token accounts. */
export function ownerChanges(tx: ChainTx, mint: string): OwnerChange[] {
  if (tx.failed) return [];
  const acc = new Map<string, { before: bigint; after: bigint; decimals: number }>();
  const add = (list: RpcTokenBalance[], key: "before" | "after") => {
    for (const b of list) {
      if (b.mint !== mint || !b.owner) continue;
      const e = acc.get(b.owner) ?? { before: 0n, after: 0n, decimals: b.uiTokenAmount.decimals };
      e[key] += BigInt(b.uiTokenAmount.amount);
      acc.set(b.owner, e);
    }
  };
  add(tx.preTokenBalances, "before");
  add(tx.postTokenBalances, "after");
  return [...acc.entries()]
    .map(([owner, e]) => ({ owner, ...e, delta: e.after - e.before }))
    .filter((c) => c.delta !== 0n)
    .sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));
}

export type ChainEventKind = "buy" | "sell" | "transfer_in" | "transfer_out";

export interface ChainEvent {
  sig: string;
  /**
   * Position of this owner's change within the transaction (owners sorted by
   * address). Together with `sig` it is the idempotency key: reprocessing the
   * same transaction always yields the same pairs.
   */
  ixIndex: number;
  wallet: string;
  kind: ChainEventKind;
  amount: bigint;
  balanceBefore: bigint;
  balanceAfter: bigint;
  /** ms since epoch */
  at: number;
  slot: number;
  decimals: number;
}

/**
 * Chain events of eligible wallets in a transaction. A change against a
 * program account (curve, pool) is a buy or sell; wallet-to-wallet is a
 * transfer (which the game treats as a sell / buy).
 */
export function chainEvents(tx: ChainTx, mint: string, ex: Exclusions): ChainEvent[] {
  const changes = ownerChanges(tx, mint);
  const venue = changes.filter((c) => !isEligible(c.owner, ex));
  const venueGave = venue.some((c) => c.delta < 0n);
  const venueTook = venue.some((c) => c.delta > 0n);
  const out: ChainEvent[] = [];
  changes.forEach((c, i) => {
    if (!isEligible(c.owner, ex)) return;
    const up = c.delta > 0n;
    out.push({
      sig: tx.signature,
      ixIndex: i,
      wallet: c.owner,
      kind: up ? (venueGave ? "buy" : "transfer_in") : venueTook ? "sell" : "transfer_out",
      amount: up ? c.delta : -c.delta,
      balanceBefore: c.before,
      balanceAfter: c.after,
      at: tx.blockTime * 1000,
      slot: tx.slot,
      decimals: c.decimals,
    });
  });
  return out;
}

/* ================= holders ================= */

export type HolderStatus = "none" | "alive" | "dead";

export interface HolderLedger {
  wallet: string;
  balance: bigint;
  status: HolderStatus;
  /** Number of the current (or last) planet life; 0 before the first. */
  lifeNo: number;
  /** ms since epoch; null while not alive. */
  holdStartedAt: number | null;
  buys: number;
  sells: number;
  /** Sells of the current life, as simulation input (planet days). */
  sellLog: Sell[];
}

export const newLedger = (wallet: string): HolderLedger => ({
  wallet,
  balance: 0n,
  status: "none",
  lifeNo: 0,
  holdStartedAt: null,
  buys: 0,
  sells: 0,
  sellLog: [],
});

export type LedgerEffect =
  | { type: "born"; lifeNo: number }
  | { type: "buy" }
  | { type: "sell"; frac: number }
  | { type: "died"; lifeNo: number; frac: number };

/**
 * Apply one balance change to a holder. Rules from the spec:
 * - the hold starts when the balance crosses the threshold from below;
 *   top-ups do not move the start
 * - falling below the threshold kills the planet; buying again later starts
 *   a new life from zero
 * - sell share = sold / balance before the sell
 */
export function applyChange(
  h: HolderLedger,
  e: { delta: bigint; at: number },
  minRaw: bigint,
): LedgerEffect[] {
  const before = h.balance;
  const after = before + e.delta;
  h.balance = after < 0n ? 0n : after;
  const effects: LedgerEffect[] = [];
  const wasAlive = h.status === "alive";
  if (!wasAlive && before < minRaw && h.balance >= minRaw) {
    h.status = "alive";
    h.lifeNo += 1;
    h.holdStartedAt = e.at;
    h.buys = 1;
    h.sells = 0;
    h.sellLog = [];
    effects.push({ type: "born", lifeNo: h.lifeNo });
    return effects;
  }
  if (!wasAlive) return effects;
  if (e.delta > 0n) {
    h.buys += 1;
    effects.push({ type: "buy" });
    return effects;
  }
  const frac = before > 0n ? Number(-e.delta) / Number(before) : 1;
  h.sells += 1;
  if (h.balance < minRaw) {
    h.status = "dead";
    h.sellLog.push({ frac: 1, at: planetDay(h, e.at) });
    effects.push({ type: "died", lifeNo: h.lifeNo, frac });
    h.holdStartedAt = null;
    return effects;
  }
  h.sellLog.push({ frac, at: planetDay(h, e.at) });
  effects.push({ type: "sell", frac });
  return effects;
}

const planetDay = (h: HolderLedger, at: number) =>
  h.holdStartedAt === null ? 0 : Math.max(0, (at - h.holdStartedAt) / DAY_MS);

/* ================= ranks ================= */

export interface Ranked {
  wallet: string;
  /** Place by balance, 1 = largest. */
  rank: number;
  /** Place by hold start, 1 = oldest (closest orbit). */
  timeRank: number;
}

/** Ranks of alive holders. Ties break by wallet so every run agrees. */
export function rankHolders(
  alive: readonly Pick<HolderLedger, "wallet" | "balance" | "holdStartedAt">[],
): Ranked[] {
  const byWallet = (a: { wallet: string }, b: { wallet: string }) =>
    a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0;
  const byBalance = [...alive].sort((a, b) =>
    a.balance === b.balance ? byWallet(a, b) : a.balance > b.balance ? -1 : 1,
  );
  const byTime = [...alive].sort((a, b) =>
    (a.holdStartedAt ?? 0) === (b.holdStartedAt ?? 0)
      ? byWallet(a, b)
      : (a.holdStartedAt ?? 0) - (b.holdStartedAt ?? 0),
  );
  const rank = new Map(byBalance.map((h, i) => [h.wallet, i + 1]));
  const timeRank = new Map(byTime.map((h, i) => [h.wallet, i + 1]));
  return alive.map((h) => ({
    wallet: h.wallet,
    rank: rank.get(h.wallet)!,
    timeRank: timeRank.get(h.wallet)!,
  }));
}

/* ================= applying events ================= */

export interface LedgerWithSlot extends HolderLedger {
  /** Last chain slot already reflected in the balance. */
  lastSlot: number;
}

export interface StoredChainEvent {
  wallet: string;
  slot: number;
  /** Balance of the wallet right after this event (absolute, from the chain). */
  balanceAfter: bigint;
  /** ms since epoch */
  at: number;
}

export interface AppliedEffect {
  wallet: string;
  at: number;
  effect: LedgerEffect;
}

/**
 * Apply stored chain events (sorted by slot) to holder ledgers.
 * - The balance becomes the absolute balance after the event, so a missed
 *   event can never leave a wrong balance behind.
 * - Events at or before a holder's lastSlot are already counted (for example
 *   by a reconciliation snapshot) and change nothing, so a late webhook never
 *   counts the same sell twice.
 */
export function applyEvents(
  ledgers: Map<string, LedgerWithSlot>,
  events: readonly StoredChainEvent[],
  minRaw: bigint,
): { changed: Set<string>; effects: AppliedEffect[] } {
  const changed = new Set<string>();
  const effects: AppliedEffect[] = [];
  for (const e of events) {
    let h = ledgers.get(e.wallet);
    if (!h) {
      h = { ...newLedger(e.wallet), lastSlot: 0 };
      ledgers.set(e.wallet, h);
    }
    if (e.slot <= h.lastSlot) continue;
    const delta = e.balanceAfter - h.balance;
    h.lastSlot = e.slot;
    changed.add(e.wallet);
    if (delta === 0n) continue;
    for (const effect of applyChange(h, { delta, at: e.at }, minRaw))
      effects.push({ wallet: e.wallet, at: e.at, effect });
  }
  return { changed, effects };
}
