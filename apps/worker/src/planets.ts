/**
 * Planet life on the server (spec: "Simulation", stage 5).
 * - birth: an alive holder without a planet for its current life gets one
 * - ticks: every 4 hours from the hold start; due planets are advanced and
 *   their state and events are saved in one transaction per planet
 * - death: the final sell lands as "Planet destroyed", the life goes to the
 *   archive (the site shows debris for 24 hours) and the state is removed
 * Decision A: the nature (class at birth) fixes the kind of simulation;
 * size and bonuses follow the current rank.
 */
import {
  advance,
  applySell,
  eraName,
  initSim,
  isNotable,
  loadState,
  planetName,
  saveState,
  simHolder,
  tickAt,
  DAY_MS,
  type PlanetClass,
  type Sell,
  type SimContext,
  type SimEvent,
  type SimState,
  type StoredState,
  eventText,
} from "@orbit/core";
import type { Pool, PoolClient } from "pg";

const log = (...a: unknown[]) => console.log("[planets]", ...a);

/** Stored state plus the indices of sells that caused a catastrophe. */
type PlanetStateJson = StoredState & { countedSells?: number[] };

interface Context {
  ctx: SimContext;
  holdersCount: number;
}

/** Sells of the current life with the simulation's "counted" marks restored. */
function sellsWithMarks(log: Sell[], counted: number[] | undefined): Sell[] {
  const marks = new Set(counted ?? []);
  return log.map((s, i) => ({
    frac: s.frac,
    at: s.at,
    ...(marks.has(i) ? { counted: true } : {}),
  }));
}

const marksOf = (sells: Sell[]) => sells.flatMap((s, i) => (s.counted ? [i] : []));

export class Planets {
  constructor(private readonly db: Pool) {}

  /** Alive holders in rank order (names for the "neighbor" event). */
  private async context(): Promise<Context> {
    const { rows } = await this.db.query<{ wallet: string }>(
      `select wallet from holders where status = 'alive' and rank is not null order by rank`,
    );
    const neighbors = rows.map((r) => ({ addr: r.wallet, name: planetName(r.wallet) }));
    return {
      ctx: { neighbors: neighbors.length ? neighbors : [{ addr: "", name: "Unknown" }] },
      holdersCount: neighbors.length,
    };
  }

  private async insertEvents(
    client: PoolClient,
    p: { wallet: string; lifeNo: number; nature: PlanetClass; holdStart: number; waterMax: number },
    events: SimEvent[],
  ) {
    for (let i = 0; i < events.length; i += 500) {
      const chunk = events.slice(i, i + 500);
      const text = chunk.map((e) => eventText(e, { cls: p.nature, waterMax: p.waterMax }));
      await client.query(
        `insert into planet_events (wallet, life_no, day, at, kind, params, text_en, notable)
         select $1, $2, d, a, k, pr, t, n
         from unnest($3::float8[], $4::timestamptz[], $5::text[], $6::jsonb[], $7::text[], $8::bool[])
           as v(d, a, k, pr, t, n)`,
        [
          p.wallet,
          p.lifeNo,
          chunk.map((e) => e.day),
          chunk.map((e) => new Date(p.holdStart + e.day * DAY_MS)),
          chunk.map((e) => e.k),
          chunk.map((e) => JSON.stringify(e.p)),
          text,
          chunk.map((e) => isNotable(e, p.nature)),
        ],
      );
    }
    const finds = events.filter((e) => e.k === "rare");
    for (const f of finds)
      await client.query(
        `insert into planet_finds (wallet, life_no, find_id, day, at) values ($1,$2,$3,$4,$5)
         on conflict do nothing`,
        [p.wallet, p.lifeNo, Number(f.p.f), f.day, new Date(p.holdStart + f.day * DAY_MS)],
      );
  }

  private async saveRow(
    client: PoolClient,
    p: { wallet: string; holdStart: number },
    S: SimState,
    sells: Sell[],
  ) {
    const saved = saveState(S);
    const state: PlanetStateJson = { ...saved.state, countedSells: marksOf(sells) };
    await client.query(
      `update planet_state set tick_no = $2, next_tick_at = $3, state = $4, rng_state = $5,
         bible = $6, history = $7, updated_at = now() where wallet = $1`,
      [
        p.wallet,
        S.k,
        new Date(tickAt(p.holdStart, S.k)),
        JSON.stringify(state),
        saved.rngState,
        JSON.stringify(S.bible),
        JSON.stringify(S.hist),
      ],
    );
  }

  /** Create planets for newly alive holders and close planets of dead ones. */
  async lifecycle(): Promise<void> {
    await this.deaths();
    await this.births();
  }

  private async births() {
    const { rows } = await this.db.query<{
      wallet: string;
      rank: number;
      class: PlanetClass;
      orbit: number;
      life_no: number;
      hold_started_at: Date;
      sell_log: Sell[];
      old_life: number | null;
    }>(
      `select h.wallet, h.rank, h.class, h.orbit, h.life_no, h.hold_started_at, h.sell_log,
         ps.life_no as old_life
       from holders h left join planet_state ps on ps.wallet = h.wallet
       where h.status = 'alive' and h.rank is not null and h.hold_started_at is not null
         and (ps.wallet is null or ps.life_no <> h.life_no)
       limit 500`,
    );
    if (!rows.length) return;
    const { holdersCount } = await this.context();
    for (const r of rows) {
      const client = await this.db.connect();
      try {
        await client.query("begin");
        // A previous life that was never closed (fast sell + rebuy): archive it now.
        if (r.old_life !== null) await this.archive(client, r.wallet, r.hold_started_at.getTime());
        const nature = r.class;
        const sells = sellsWithMarks(r.sell_log, []);
        const h = simHolder({
          wallet: r.wallet,
          nature,
          orbit: r.orbit,
          rank: r.rank,
          holdersCount,
          sells,
        });
        const S = initSim(h, r.life_no);
        const holdStart = r.hold_started_at.getTime();
        const saved = saveState(S);
        await client.query(
          `insert into planet_state (wallet, life_no, tick_no, next_tick_at, state, rng_state, bible, history, nature, hold_started_at)
           values ($1,$2,$3,$4,$5,$6,null,'[]',$7,$8)`,
          [
            r.wallet,
            r.life_no,
            S.k,
            new Date(tickAt(holdStart, S.k)),
            JSON.stringify({ ...saved.state, countedSells: [] }),
            saved.rngState,
            nature,
            r.hold_started_at,
          ],
        );
        await this.insertEvents(
          client,
          { wallet: r.wallet, lifeNo: r.life_no, nature, holdStart, waterMax: S.waterMax },
          S.news,
        );
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    }
    log(`${rows.length} planets formed`);
  }

  private async deaths() {
    const { rows } = await this.db.query<{
      wallet: string;
      rank: number | null;
      died_at: Date | null;
      updated_at: Date;
      sell_log: Sell[];
    }>(
      `select h.wallet, h.rank, h.died_at, h.updated_at, h.sell_log
       from holders h join planet_state ps on ps.wallet = h.wallet
       where h.status <> 'alive' and ps.life_no = h.life_no
       limit 200`,
    );
    if (!rows.length) return;
    const { ctx, holdersCount } = await this.context();
    for (const r of rows) {
      const client = await this.db.connect();
      try {
        await client.query("begin");
        const ps = await client.query<{
          life_no: number;
          state: PlanetStateJson;
          rng_state: string;
          nature: PlanetClass;
          hold_started_at: Date;
        }>(
          `select life_no, state, rng_state, nature, hold_started_at from planet_state where wallet = $1 for update`,
          [r.wallet],
        );
        const row = ps.rows[0];
        if (!row) {
          await client.query("rollback");
          continue;
        }
        const holdStart = row.hold_started_at.getTime();
        const diedAt = (r.died_at ?? r.updated_at).getTime();
        const S = loadState({ state: row.state, rngState: Number(row.rng_state) });
        const sells = sellsWithMarks(r.sell_log, row.state.countedSells);
        const h = simHolder({
          wallet: r.wallet,
          nature: row.nature,
          orbit: 0,
          rank: r.rank ?? Math.max(1, holdersCount),
          holdersCount,
          sells,
        });
        // Ticks up to the moment of death, then the final sell lands at once.
        const run = advance(S, h, holdStart, diedAt, ctx, 5000);
        const day = Math.max(0, (diedAt - holdStart) / DAY_MS);
        while (S.sellIdx < sells.length) {
          applySell(S, h, day, sells[S.sellIdx]!);
          S.sellIdx++;
        }
        const final = S.news.slice(run.events.length);
        await this.insertEvents(
          client,
          {
            wallet: r.wallet,
            lifeNo: row.life_no,
            nature: row.nature,
            holdStart,
            waterMax: S.waterMax,
          },
          [...run.events, ...final],
        );
        await this.archive(client, r.wallet, diedAt, S);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    }
    log(`${rows.length} planets destroyed`);
  }

  /** Move the current planet state to the archive and remove it. */
  private async archive(client: PoolClient, wallet: string, endedAt: number, live?: SimState) {
    const { rows } = await client.query<{
      life_no: number;
      state: PlanetStateJson;
      nature: PlanetClass;
      hold_started_at: Date;
    }>(`select life_no, state, nature, hold_started_at from planet_state where wallet = $1`, [
      wallet,
    ]);
    const row = rows[0];
    if (!row) return;
    const S = live ?? (row.state as unknown as SimState);
    const orbit = (
      await client.query<{ orbit: number | null }>(`select orbit from holders where wallet = $1`, [
        wallet,
      ])
    ).rows[0]?.orbit;
    const summary = {
      orbit: orbit ?? null,
      name: planetName(wallet),
      nature: row.nature,
      era: S.era,
      eraName: eraName(S.era, { cls: row.nature, waterMax: S.waterMax }),
      days: (endedAt - row.hold_started_at.getTime()) / DAY_MS,
      life: S.life,
      civ: S.civ,
      pop: S.pop,
      tech: S.tech,
      finds: S.finds.length,
      species: S.bible?.species ?? null,
      catastrophes: S.catCount,
    };
    await client.query(
      `insert into planet_archive (wallet, life_no, ended_at, summary) values ($1,$2,$3,$4)
       on conflict (wallet, life_no) do update set ended_at = excluded.ended_at, summary = excluded.summary`,
      [wallet, row.life_no, new Date(endedAt), JSON.stringify(summary)],
    );
    await client.query(`delete from planet_state where wallet = $1`, [wallet]);
  }

  /** Advance every planet whose next tick is due. Returns the number of planets advanced. */
  async ticks(now = Date.now(), batch = 100): Promise<number> {
    const due = await this.db.query<{ wallet: string }>(
      `select ps.wallet from planet_state ps join holders h on h.wallet = ps.wallet
       where ps.next_tick_at <= $1 and h.status = 'alive' and ps.life_no = h.life_no
       order by ps.next_tick_at limit $2`,
      [new Date(now), batch],
    );
    if (!due.rowCount) return 0;
    const { ctx, holdersCount } = await this.context();
    let advanced = 0;
    let events = 0;
    for (const { wallet } of due.rows) {
      const client = await this.db.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query<{
          life_no: number;
          state: PlanetStateJson;
          rng_state: string;
          nature: PlanetClass;
          hold_started_at: Date;
          rank: number;
          orbit: number;
          sell_log: Sell[];
        }>(
          `select ps.life_no, ps.state, ps.rng_state, ps.nature, ps.hold_started_at, h.rank, h.orbit, h.sell_log
           from planet_state ps join holders h on h.wallet = ps.wallet
           where ps.wallet = $1 and ps.next_tick_at <= $2 and h.status = 'alive' and ps.life_no = h.life_no
           for update of ps skip locked`,
          [wallet, new Date(now)],
        );
        const row = rows[0];
        if (!row) {
          await client.query("rollback");
          continue;
        }
        const holdStart = row.hold_started_at.getTime();
        const S = loadState({ state: row.state, rngState: Number(row.rng_state) });
        const sells = sellsWithMarks(row.sell_log, row.state.countedSells);
        const h = simHolder({
          wallet,
          nature: row.nature,
          orbit: row.orbit,
          rank: row.rank,
          holdersCount,
          sells,
        });
        const r = advance(S, h, holdStart, now, ctx, 5000);
        await this.insertEvents(
          client,
          { wallet, lifeNo: row.life_no, nature: row.nature, holdStart, waterMax: S.waterMax },
          r.events,
        );
        await this.saveRow(client, { wallet, holdStart }, S, sells);
        await client.query("commit");
        advanced++;
        events += r.events.length;
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    }
    if (advanced) log(`ticked ${advanced} planets, ${events} events`);
    return advanced;
  }
}
