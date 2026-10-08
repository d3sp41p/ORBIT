/**
 * Chain indexer (spec: "Data from the blockchain", stage 4).
 * - chain_events is the inbox: the webhook route, the reconciliation snapshot
 *   and the history backfill all insert there, idempotently by (sig, ix_index)
 * - applyPending() applies new events to holders in slot order
 * - snapshot() compares every balance with the chain and adds missing events
 * - ranks, classes, time ranks and orbits are recalculated after each change
 */
import {
  applyEvents,
  chainEvents,
  classOf,
  orbitOf,
  rankHolders,
  starTierIndex,
  toChainTx,
  toRaw,
  isEligible,
  type ChainEvent,
  type HolderLedger,
  type LedgerWithSlot,
} from "@orbit/core";
import type { Pool, PoolClient } from "pg";
import type { Exclusions } from "@orbit/core";
import type { Helius } from "./helius";

export interface IndexerOptions {
  mint: string;
  exclusions: Exclusions;
  minHoldingTokens: number;
  backfillLimit: number;
}

const log = (...a: unknown[]) => console.log("[indexer]", ...a);

interface HolderRow {
  wallet: string;
  balance: string;
  status: HolderLedger["status"];
  life_no: number;
  hold_started_at: Date | null;
  buys: number;
  sells: number;
  sell_log: HolderLedger["sellLog"];
  last_slot: string;
}

const toLedger = (r: HolderRow): LedgerWithSlot => ({
  wallet: r.wallet,
  balance: BigInt(r.balance),
  status: r.status,
  lifeNo: r.life_no,
  holdStartedAt: r.hold_started_at ? r.hold_started_at.getTime() : null,
  buys: r.buys,
  sells: r.sells,
  sellLog: r.sell_log ?? [],
  lastSlot: Number(r.last_slot),
});

export class Indexer {
  decimals = 6;
  supply = 0n;
  private minRaw = 0n;
  lastSnapshotAt: Date | null = null;

  constructor(
    private readonly db: Pool,
    private readonly helius: Helius,
    private readonly cfg: IndexerOptions,
  ) {}

  async init() {
    const m = await this.helius.getMintInfo(this.cfg.mint);
    this.decimals = m.decimals;
    this.supply = m.supply;
    this.minRaw = toRaw(this.cfg.minHoldingTokens, this.decimals);
    log(
      `mint ${this.cfg.mint}, decimals ${this.decimals}, min ${this.cfg.minHoldingTokens} tokens`,
    );
  }

  /** Insert chain events, ignoring ones already stored. Returns how many were new. */
  async insertEvents(
    events: ChainEvent[],
    source: "webhook" | "snapshot" | "backfill",
    client?: PoolClient,
  ) {
    if (!events.length) return 0;
    const db = client ?? this.db;
    let inserted = 0;
    for (let i = 0; i < events.length; i += 500) {
      const chunk = events.slice(i, i + 500);
      const values: unknown[] = [];
      const rows = chunk.map((e, j) => {
        const b = j * 10;
        values.push(
          e.sig,
          e.ixIndex,
          e.wallet,
          e.kind,
          e.amount.toString(),
          e.balanceBefore.toString(),
          e.balanceAfter.toString(),
          new Date(e.at),
          e.slot,
          source,
        );
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
      });
      const r = await db.query(
        `insert into chain_events (sig, ix_index, wallet, kind, amount, balance_before, balance_after, block_time, slot, source)
         values ${rows.join(",")} on conflict (sig, ix_index) do nothing`,
        values,
      );
      inserted += r.rowCount ?? 0;
    }
    return inserted;
  }

  private applying: Promise<number> = Promise.resolve(0);

  /** Apply pending chain events to holders, then refresh ranks. Runs one at a time. */
  applyPending(): Promise<number> {
    const run = this.applying.then(
      () => this.applyPendingNow(),
      () => this.applyPendingNow(),
    );
    this.applying = run.catch(() => 0);
    return run;
  }

  private async applyPendingNow(): Promise<number> {
    const client = await this.db.connect();
    try {
      await client.query("begin");
      // Also serialises several worker processes, should more than one ever run.
      await client.query("select pg_advisory_xact_lock(4242)");
      const pending = await client.query<{
        sig: string;
        ix_index: number;
        wallet: string;
        balance_after: string;
        block_time: Date;
        slot: string;
      }>(
        `select sig, ix_index, wallet, balance_after, block_time, slot from chain_events
         where not applied order by slot, sig, ix_index limit 5000 for update skip locked`,
      );
      if (!pending.rowCount) {
        await client.query("commit");
        return 0;
      }
      const wallets = [...new Set(pending.rows.map((r) => r.wallet))];
      const existing = await client.query<HolderRow>(
        `select wallet, balance, status, life_no, hold_started_at, buys, sells, sell_log, last_slot
         from holders where wallet = any($1)`,
        [wallets],
      );
      const ledgers = new Map(existing.rows.map((r) => [r.wallet, toLedger(r)]));
      const { changed, effects } = applyEvents(
        ledgers,
        pending.rows.map((r) => ({
          wallet: r.wallet,
          slot: Number(r.slot),
          balanceAfter: BigInt(r.balance_after),
          at: r.block_time.getTime(),
        })),
        this.minRaw,
      );
      // One statement for all changed holders: round trips to the database are the bottleneck.
      const hs = [...changed].map((w) => ledgers.get(w)!);
      if (hs.length)
        await client.query(
          `insert into holders (wallet, balance, status, life_no, hold_started_at, buys, sells, sell_log, last_slot, updated_at)
           select w, b, s, l, h, bu, se, sl, ls, now()
           from unnest($1::text[], $2::numeric[], $3::text[], $4::int[], $5::timestamptz[], $6::int[], $7::int[], $8::jsonb[], $9::bigint[])
             as v(w, b, s, l, h, bu, se, sl, ls)
           on conflict (wallet) do update set balance = excluded.balance, status = excluded.status,
             life_no = excluded.life_no, hold_started_at = excluded.hold_started_at, buys = excluded.buys,
             sells = excluded.sells, sell_log = excluded.sell_log, last_slot = excluded.last_slot, updated_at = now()`,
          [
            hs.map((h) => h.wallet),
            hs.map((h) => h.balance.toString()),
            hs.map((h) => h.status),
            hs.map((h) => h.lifeNo),
            hs.map((h) => (h.holdStartedAt === null ? null : new Date(h.holdStartedAt))),
            hs.map((h) => h.buys),
            hs.map((h) => h.sells),
            hs.map((h) => JSON.stringify(h.sellLog)),
            hs.map((h) => h.lastSlot),
          ],
        );
      await client.query(
        `update chain_events set applied = true
         where (sig, ix_index) in (select * from unnest($1::text[], $2::int[]))`,
        [pending.rows.map((r) => r.sig), pending.rows.map((r) => r.ix_index)],
      );
      await this.refreshRanks(client);
      await client.query("commit");
      const births = effects.filter((e) => e.effect.type === "born").length;
      const deaths = effects.filter((e) => e.effect.type === "died").length;
      log(
        `applied ${pending.rowCount} events, ${changed.size} holders changed, +${births} planets, -${deaths}`,
      );
      return pending.rowCount ?? 0;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  /** Recalculate rank, class, time rank and orbit of every alive holder. */
  private async refreshRanks(client: PoolClient) {
    const alive = await client.query<{ wallet: string; balance: string; hold_started_at: Date }>(
      `select wallet, balance, hold_started_at from holders where status = 'alive'`,
    );
    const ranked = rankHolders(
      alive.rows.map((r) => ({
        wallet: r.wallet,
        balance: BigInt(r.balance),
        holdStartedAt: r.hold_started_at.getTime(),
      })),
    );
    const N = ranked.length;
    await client.query(
      `update holders set rank = null, class = null, time_rank = null, orbit = null
       where status <> 'alive' and rank is not null`,
    );
    if (N) {
      await client.query(
        `update holders h set rank = v.rank, class = v.class, time_rank = v.time_rank, orbit = v.orbit
         from unnest($1::text[], $2::int[], $3::text[], $4::int[], $5::float8[]) as v(wallet, rank, class, time_rank, orbit)
         where h.wallet = v.wallet`,
        [
          ranked.map((r) => r.wallet),
          ranked.map((r) => r.rank),
          ranked.map((r) => classOf(r.rank)),
          ranked.map((r) => r.timeRank),
          ranked.map((r) => orbitOf(r.wallet, r.timeRank, N).orbit),
        ],
      );
    }
    await client.query(
      `update system_state set holders_count = $1, updated_at = now() where id = 1`,
      [N],
    );
  }

  /**
   * Reconciliation snapshot: read every token account of the mint, sum by
   * owner and add an event for each wallet whose stored balance differs.
   */
  async snapshot() {
    // Compare against fully applied balances, or pending events would be counted again.
    while ((await this.applyPending()) > 0);
    const accounts = await this.helius.getTokenAccounts(this.cfg.mint);
    // Slot taken after the read: every change the read saw is at or before it.
    const slot = await this.helius.getSlot();
    const now = Date.now();
    const chain = new Map<string, bigint>();
    for (const a of accounts) {
      if (!isEligible(a.owner, this.cfg.exclusions)) continue;
      chain.set(a.owner, (chain.get(a.owner) ?? 0n) + a.amount);
    }
    const stored = await this.db.query<{ wallet: string; balance: string }>(
      `select wallet, balance from holders where balance > 0`,
    );
    const known = new Map(stored.rows.map((r) => [r.wallet, BigInt(r.balance)]));
    const wallets = new Set([...chain.keys(), ...known.keys()]);
    const events: ChainEvent[] = [];
    let i = 0;
    for (const w of [...wallets].sort()) {
      const before = known.get(w) ?? 0n;
      const after = chain.get(w) ?? 0n;
      if (before === after) continue;
      const up = after > before;
      events.push({
        sig: `snapshot:${slot}`,
        ixIndex: i++,
        wallet: w,
        kind: up ? "buy" : "sell",
        amount: up ? after - before : before - after,
        balanceBefore: before,
        balanceAfter: after,
        at: now,
        slot,
        decimals: this.decimals,
      });
    }
    const added = await this.insertEvents(events, "snapshot");
    await this.db.query(`update system_state set last_snapshot_at = now() where id = 1`);
    this.lastSnapshotAt = new Date(now);
    log(`snapshot: ${accounts.length} token accounts, ${chain.size} wallets, ${added} corrections`);
    if (added) await this.applyPending();
  }

  /**
   * Restore history from the newest transactions back to the mint's creation
   * (or backfillLimit), so hold starts and sells are known. Idempotent.
   */
  async backfill() {
    log(`restoring history (up to ${this.cfg.backfillLimit} transactions)`);
    const sigs: string[] = [];
    let before: string | undefined;
    while (sigs.length < this.cfg.backfillLimit) {
      const page = await this.helius.getSignatures(this.cfg.mint, before, 1000);
      for (const s of page) if (!s.err) sigs.push(s.signature);
      if (page.length < 1000) break;
      before = page.at(-1)!.signature;
    }
    let done = 0;
    for (let i = 0; i < sigs.length; i += 20) {
      const batch = await Promise.all(
        sigs.slice(i, i + 20).map((s) => this.helius.getTransaction(s)),
      );
      const events = batch
        .filter((t) => t !== null)
        .flatMap((t) => chainEvents(toChainTx(t!), this.cfg.mint, this.cfg.exclusions));
      await this.insertEvents(events, "backfill");
      done += batch.length;
      if (done % 500 < 20) log(`backfill: ${done}/${sigs.length} transactions`);
    }
    while ((await this.applyPending()) > 0);
    log(`backfill done: ${sigs.length} transactions`);
  }

  /** Price and market cap from DexScreener; star class from the cap. */
  async refreshPrice() {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${this.cfg.mint}`);
    if (!res.ok) return;
    const pairs = (await res.json()) as {
      priceUsd?: string;
      marketCap?: number;
      fdv?: number;
      liquidity?: { usd?: number };
    }[];
    const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!best?.priceUsd) return;
    const price = Number(best.priceUsd);
    const mcap = best.marketCap ?? best.fdv ?? price * (Number(this.supply) / 10 ** this.decimals);
    await this.db.query(
      `update system_state set price = $1, mcap = $2, star_tier = $3, updated_at = now() where id = 1`,
      [price, mcap, starTierIndex(mcap)],
    );
  }
}
