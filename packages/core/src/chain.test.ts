import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyChange,
  applyEvents,
  base58Decode,
  chainEvents,
  isEligible,
  isOnCurve,
  newLedger,
  ownerChanges,
  parseAddressList,
  rankHolders,
  toChainTx,
  toRaw,
  type ChainTx,
  type Exclusions,
} from "./chain";

interface Fixture {
  mint: string;
  decimals: number;
  txs: Parameters<typeof toChainTx>[0][];
}
const load = (name: string): Fixture =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8"),
  );

const NONE: Exclusions = { excluded: new Set(), included: new Set() };
const pumpswap = load("pumpswap-token.json");
const txs = pumpswap.txs.map(toChainTx);
const bySig = (sig: string) => txs.find((t) => t.signature === sig)!;

/** PumpSwap pool authority of the recorded token (a program account). */
const POOL = "DQyGMAGx8nB6ykixotLNFC6eVVQjrMqz7AkRyinNkEm1";

describe("addresses", () => {
  it("decodes base58 to 32-byte keys", () => {
    expect(base58Decode(POOL)).toHaveLength(32);
    expect(base58Decode("11111111111111111111111111111111")).toEqual(new Uint8Array(32));
  });

  it("treats the pool (a program account) as ineligible and wallets as eligible", () => {
    expect(isOnCurve(POOL)).toBe(false);
    const wallets = new Set(txs.flatMap((t) => ownerChanges(t, pumpswap.mint).map((c) => c.owner)));
    const eligible = [...wallets].filter((w) => isEligible(w, NONE));
    expect(eligible.length).toBeGreaterThan(30);
    expect(eligible).not.toContain(POOL);
  });

  it("honours manual exclude and include lists", () => {
    const someWallet = txs
      .flatMap((t) => ownerChanges(t, pumpswap.mint))
      .find((c) => isOnCurve(c.owner))!.owner;
    const ex = { excluded: parseAddressList(` ${someWallet} ,x`), included: new Set([POOL]) };
    expect(isEligible(someWallet, ex)).toBe(false);
    expect(isEligible(POOL, ex)).toBe(true);
  });
});

describe("recorded PumpSwap transactions", () => {
  const all = txs.flatMap((t) => chainEvents(t, pumpswap.mint, NONE));

  it("finds buys and sells of real wallets and never the pool", () => {
    const kinds = new Set(all.map((e) => e.kind));
    expect(kinds.has("buy")).toBe(true);
    expect(kinds.has("sell")).toBe(true);
    expect(all.some((e) => e.wallet === POOL)).toBe(false);
  });

  it("matches balances: after = before ± amount", () => {
    for (const e of all) {
      const sign = e.kind === "buy" || e.kind === "transfer_in" ? 1n : -1n;
      expect(e.balanceAfter).toBe(e.balanceBefore + sign * e.amount);
      expect(e.amount > 0n).toBe(true);
    }
  });

  it("a buy is the pool giving tokens to the wallet", () => {
    const buy = all.find((e) => e.kind === "buy")!;
    const tx = bySig(buy.sig);
    const pool = ownerChanges(tx, pumpswap.mint).find((c) => c.owner === POOL)!;
    expect(pool.delta < 0n).toBe(true);
  });

  it("is idempotent: the same transaction always yields the same (sig, ix_index) keys", () => {
    const again = txs.flatMap((t) => chainEvents(t, pumpswap.mint, NONE));
    expect(again).toEqual(all);
    const keys = all.map((e) => `${e.sig}:${e.ixIndex}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ignores failed transactions", () => {
    const failed: ChainTx = { ...txs[0]!, failed: true };
    expect(chainEvents(failed, pumpswap.mint, NONE)).toEqual([]);
  });
});

describe("several token accounts of one owner", () => {
  it("sums them into one balance change", () => {
    const owner = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
    const bal = (accountIndex: number, amount: string) => ({
      accountIndex,
      mint: pumpswap.mint,
      owner,
      uiTokenAmount: { amount, decimals: 6 },
    });
    const tx: ChainTx = {
      signature: "s",
      slot: 1,
      blockTime: 1,
      failed: false,
      preTokenBalances: [bal(1, "100"), bal(2, "50")],
      postTokenBalances: [bal(1, "0"), bal(2, "170")],
    };
    expect(ownerChanges(tx, pumpswap.mint)).toEqual([
      { owner, before: 150n, after: 170n, delta: 20n, decimals: 6 },
    ]);
  });
});

describe("holder ledger", () => {
  const MIN = toRaw(100_000, 6);
  const T0 = Date.UTC(2026, 9, 1);
  const H = 3_600_000;

  it("a planet is born when the balance crosses the threshold, top-ups keep the start", () => {
    const h = newLedger("W");
    expect(applyChange(h, { delta: toRaw(50_000, 6), at: T0 }, MIN)).toEqual([]);
    expect(h.status).toBe("none");
    expect(applyChange(h, { delta: toRaw(60_000, 6), at: T0 + H }, MIN)).toEqual([
      { type: "born", lifeNo: 1 },
    ]);
    expect(h.holdStartedAt).toBe(T0 + H);
    applyChange(h, { delta: toRaw(1_000_000, 6), at: T0 + 5 * H }, MIN);
    expect(h.holdStartedAt).toBe(T0 + H);
    expect(h.buys).toBe(2);
  });

  it("a sell share is sold / balance before; falling below the threshold kills the planet", () => {
    const h = newLedger("W");
    applyChange(h, { delta: toRaw(1_000_000, 6), at: T0 }, MIN);
    expect(applyChange(h, { delta: -toRaw(300_000, 6), at: T0 + 24 * H }, MIN)).toEqual([
      { type: "sell", frac: 0.3 },
    ]);
    expect(h.sellLog).toEqual([{ frac: 0.3, at: 1 }]);
    const died = applyChange(h, { delta: -toRaw(650_000, 6), at: T0 + 48 * H }, MIN);
    expect(died[0]).toMatchObject({ type: "died", lifeNo: 1 });
    expect(h.status).toBe("dead");
    expect(h.holdStartedAt).toBeNull();
  });

  it("buying again after death starts a new life from zero", () => {
    const h = newLedger("W");
    applyChange(h, { delta: toRaw(200_000, 6), at: T0 }, MIN);
    applyChange(h, { delta: -toRaw(200_000, 6), at: T0 + H }, MIN);
    expect(applyChange(h, { delta: toRaw(500_000, 6), at: T0 + 10 * H }, MIN)).toEqual([
      { type: "born", lifeNo: 2 },
    ]);
    expect(h).toMatchObject({
      lifeNo: 2,
      holdStartedAt: T0 + 10 * H,
      buys: 1,
      sells: 0,
      sellLog: [],
    });
  });

  it("a transfer out counts as a sell of the sender and a transfer in as a buy", () => {
    const a = newLedger("A"),
      b = newLedger("B");
    applyChange(a, { delta: toRaw(1_000_000, 6), at: T0 }, MIN);
    applyChange(b, { delta: toRaw(200_000, 6), at: T0 }, MIN);
    const amt = toRaw(250_000, 6);
    expect(applyChange(a, { delta: -amt, at: T0 + H }, MIN)).toEqual([
      { type: "sell", frac: 0.25 },
    ]);
    expect(applyChange(b, { delta: amt, at: T0 + H }, MIN)).toEqual([{ type: "buy" }]);
  });
});

describe("ranks", () => {
  it("rank by balance and time rank by hold start, ties by wallet", () => {
    const r = rankHolders([
      { wallet: "B", balance: 500n, holdStartedAt: 300 },
      { wallet: "A", balance: 900n, holdStartedAt: 200 },
      { wallet: "C", balance: 500n, holdStartedAt: 100 },
    ]);
    expect(r).toEqual([
      { wallet: "B", rank: 2, timeRank: 3 },
      { wallet: "A", rank: 1, timeRank: 2 },
      { wallet: "C", rank: 3, timeRank: 1 },
    ]);
  });
});

describe("applyEvents", () => {
  const MIN = toRaw(100_000, 6);
  const T = Date.UTC(2026, 9, 1);
  const ev = (wallet: string, slot: number, tokens: number, at = T + slot * 1000) => ({
    wallet,
    slot,
    balanceAfter: toRaw(tokens, 6),
    at,
  });

  it("sets absolute balances and reports births and sells", () => {
    const ledgers = new Map();
    const r = applyEvents(ledgers, [ev("A", 10, 500_000), ev("A", 20, 400_000)], MIN);
    expect(ledgers.get("A")).toMatchObject({
      balance: toRaw(400_000, 6),
      status: "alive",
      lastSlot: 20,
    });
    expect(r.effects.map((e) => e.effect.type)).toEqual(["born", "sell"]);
  });

  it("skips events already covered by a snapshot, so a sell is never counted twice", () => {
    const ledgers = new Map();
    applyEvents(ledgers, [ev("A", 10, 1_000_000)], MIN);
    // snapshot at slot 50 already saw the sell down to 600k
    const snap = applyEvents(ledgers, [ev("A", 50, 600_000)], MIN);
    expect(snap.effects).toEqual([
      { wallet: "A", at: T + 50_000, effect: { type: "sell", frac: 0.4 } },
    ]);
    // the webhook for that sell (slot 42) arrives late
    const late = applyEvents(ledgers, [ev("A", 42, 600_000)], MIN);
    expect(late.effects).toEqual([]);
    expect(ledgers.get("A").sells).toBe(1);
  });

  it("repairs a missed event with the next one's absolute balance", () => {
    const ledgers = new Map();
    applyEvents(ledgers, [ev("A", 10, 300_000)], MIN);
    // a buy of +200k was missed; the next event says 700k after another +200k
    applyEvents(ledgers, [ev("A", 30, 700_000)], MIN);
    expect(ledgers.get("A").balance).toBe(toRaw(700_000, 6));
  });
});
