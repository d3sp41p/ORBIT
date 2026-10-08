/**
 * Data for the public API (spec: "API"). Everything is computed on the server
 * from the database; the browser never simulates anything.
 */
import {
  cardFromState,
  planetName,
  scenePlanet,
  type NewsItem,
  type PlanetCard,
  type PlanetClass,
  type ScenePlanet,
  type Sell,
  type SimEvent,
  type StoredState,
} from "@orbit/core";
import { select, selectAll } from "./db";

interface StateRow {
  mcap: number;
  price: number;
  holders_count: number;
  star_tier: number;
  launched: boolean;
  token_decimals: number;
  updated_at: string;
}

export interface SystemData {
  star: { mcap: number; price: number; tier: number; holders: number; updatedAt: string };
  planets: ScenePlanet[];
  /** Planets destroyed in the last 24 hours: the site draws a debris cloud. */
  debris: { wallet: string; name: string; orbit: number; endedAt: number }[];
  serverTime: number;
}

const SCENE_STATE =
  "era:state->era,waterMax:state->waterMax,temp:state->temp,water:state->water,bio:state->bio," +
  "civ:state->civ,tech:state->tech,pop:state->pop,ash:state->ash,dim:state->dim,atm:state->atm," +
  "counted:state->countedSells";

type SceneStateRow = {
  wallet: string;
  nature: PlanetClass;
  hold_started_at: string;
  era: number;
  waterMax: number;
  temp: number;
  water: number;
  bio: number;
  civ: boolean;
  tech: number;
  pop: number;
  ash: number;
  dim: number;
  atm: number;
  counted: number[] | null;
};

/** Sells of the current life with the simulation's catastrophe marks. */
const marked = (log: Sell[] | null, counted: number[] | null | undefined): Sell[] => {
  const marks = new Set(counted ?? []);
  return (log ?? []).map((s, i) => ({ ...s, counted: marks.has(i) }));
};

export async function loadSystem(revalidate: number): Promise<SystemData> {
  const [stateRes, holders, states, archive] = await Promise.all([
    select<StateRow>(
      "system_state?id=eq.1&select=mcap,price,holders_count,star_tier,launched,token_decimals,updated_at",
      { revalidate },
    ),
    selectAll<{
      wallet: string;
      name: string | null;
      rank: number;
      time_rank: number;
      class: PlanetClass;
      orbit: number;
      sell_log: Sell[];
    }>(
      "holders?status=eq.alive&rank=not.is.null&select=wallet,name,rank,time_rank,class,orbit,sell_log&order=rank",
      revalidate,
    ),
    selectAll<SceneStateRow>(
      `planet_state?select=wallet,nature,hold_started_at,${SCENE_STATE}`,
      revalidate,
    ),
    select<{ wallet: string; ended_at: string; summary: { orbit?: number | null; name?: string } }>(
      `planet_archive?ended_at=gt.${new Date(Date.now() - 86_400_000).toISOString()}&select=wallet,ended_at,summary&order=ended_at.desc&limit=200`,
      { revalidate },
    ),
  ]);
  const s = stateRes.rows[0]!;
  const byWallet = new Map(states.map((r) => [r.wallet, r]));
  const now = Date.now();
  const planets: ScenePlanet[] = [];
  for (const h of holders) {
    const st = byWallet.get(h.wallet);
    if (!st) continue; // planet not formed yet (a few seconds after the first buy)
    planets.push(
      scenePlanet({
        wallet: h.wallet,
        name: h.name ?? planetName(h.wallet),
        rank: h.rank,
        timeRank: h.time_rank,
        orbit: h.orbit,
        cls: h.class,
        nature: st.nature,
        state: st,
        days: (now - new Date(st.hold_started_at).getTime()) / 86_400_000,
        sells: marked(h.sell_log, st.counted),
      }),
    );
  }
  return {
    star: {
      mcap: s.mcap,
      price: s.price,
      tier: s.star_tier,
      holders: s.holders_count,
      updatedAt: s.updated_at,
    },
    planets,
    debris: archive.rows
      .filter((a) => typeof a.summary.orbit === "number")
      .map((a) => ({
        wallet: a.wallet,
        name: a.summary.name ?? planetName(a.wallet),
        orbit: a.summary.orbit!,
        endedAt: new Date(a.ended_at).getTime(),
      })),
    serverTime: now,
  };
}

interface EventRow {
  id: number;
  wallet: string;
  day: number;
  at: string;
  kind: SimEvent["k"];
  text_en: string;
  notable: boolean;
}

const toNews = (r: EventRow): NewsItem => ({
  id: String(r.id),
  wallet: r.wallet,
  kind: r.kind,
  day: r.day,
  at: new Date(r.at).getTime(),
  text: r.text_en,
  notable: r.notable,
});

const EVENT_COLS = "id,wallet,day,at,kind,text_en,notable";
export const PAGE = 20;

/** Planet news, newest first; cursor = id of the last item already shown. */
export async function loadEvents(wallet: string, lifeNo: number, cursor?: string) {
  const after = cursor && /^\d+$/.test(cursor) ? `&id=lt.${cursor}` : "";
  const { rows, total } = await select<EventRow>(
    `planet_events?wallet=eq.${wallet}&life_no=eq.${lifeNo}${after}&select=${EVENT_COLS}&order=id.desc&limit=${PAGE}`,
    { count: !cursor },
  );
  const items = rows.map(toNews);
  return { items, total, next: items.length === PAGE ? items.at(-1)!.id : null };
}

export type PlanetResult =
  | { status: "alive"; card: PlanetCard }
  | {
      status: "dead";
      wallet: string;
      name: string;
      endedAt: number;
      summary: Record<string, unknown>;
    }
  | { status: "none" };

export async function loadPlanet(wallet: string): Promise<PlanetResult> {
  const [holderRes, stateRes, sys] = await Promise.all([
    select<{
      wallet: string;
      name: string | null;
      balance: string;
      rank: number | null;
      time_rank: number | null;
      class: PlanetClass | null;
      orbit: number | null;
      buys: number;
      sells: number;
      status: "none" | "alive" | "dead";
      life_no: number;
      sell_log: Sell[];
    }>(
      `holders?wallet=eq.${wallet}&select=wallet,name,balance,rank,time_rank,class,orbit,buys,sells,status,life_no,sell_log`,
    ),
    select<{
      life_no: number;
      nature: PlanetClass;
      hold_started_at: string;
      state: StoredState & { countedSells?: number[] };
    }>(`planet_state?wallet=eq.${wallet}&select=life_no,nature,hold_started_at,state`),
    select<StateRow>("system_state?id=eq.1&select=holders_count,token_decimals", {
      revalidate: 15,
    }),
  ]);
  const h = holderRes.rows[0];
  const ps = stateRes.rows[0];
  if (!h) return { status: "none" };
  if (h.status !== "alive" || !ps || ps.life_no !== h.life_no || h.rank === null) {
    const { rows } = await select<{ ended_at: string; summary: Record<string, unknown> }>(
      `planet_archive?wallet=eq.${wallet}&select=ended_at,summary&order=life_no.desc&limit=1`,
    );
    if (!rows[0]) return { status: "none" };
    return {
      status: "dead",
      wallet,
      name: h.name ?? planetName(wallet),
      endedAt: new Date(rows[0].ended_at).getTime(),
      summary: rows[0].summary,
    };
  }
  const [news, timeline] = await Promise.all([
    loadEvents(wallet, h.life_no),
    select<EventRow>(
      `planet_events?wallet=eq.${wallet}&life_no=eq.${h.life_no}&or=(kind.in.(formed,sell,collapse,eraDown,eraUp,life,lifeGas,lifeAst,civ,rare))&select=${EVENT_COLS}&order=id.desc&limit=12`,
    ),
  ]);
  const sells = marked(h.sell_log, ps.state.countedSells);
  const card = cardFromState({
    wallet,
    name: h.name ?? planetName(wallet),
    rank: h.rank,
    timeRank: h.time_rank ?? 0,
    holdersCount: sys.rows[0]?.holders_count ?? 0,
    cls: h.class ?? ps.nature,
    nature: ps.nature,
    orbit: h.orbit ?? 0,
    lifeNo: h.life_no,
    holdStartedAt: new Date(ps.hold_started_at).getTime(),
    now: Date.now(),
    balance: h.balance,
    decimals: sys.rows[0]?.token_decimals ?? 6,
    buys: h.buys,
    sells,
    sellCount: h.sells,
    state: ps.state,
    news: news.items,
    newsTotal: news.total ?? news.items.length,
    timeline: timeline.rows.map(toNews),
  });
  return { status: "alive", card };
}

/** Global feed of notable events; cursor = "<ms>_<id>" of the last item shown. */
export async function loadFeed(cursor?: string) {
  let filter = "";
  const m = cursor?.match(/^(\d+)_(\d+)$/);
  if (m) {
    const at = new Date(Number(m[1])).toISOString();
    filter = `&or=(at.lt.${at},and(at.eq.${at},id.lt.${m[2]}))`;
  }
  const { rows } = await select<EventRow>(
    `planet_events?notable=is.true${filter}&select=${EVENT_COLS}&order=at.desc,id.desc&limit=${PAGE}`,
  );
  const wallets = [...new Set(rows.map((r) => r.wallet))];
  const names = wallets.length
    ? (
        await select<{
          wallet: string;
          name: string | null;
          rank: number | null;
          class: PlanetClass | null;
        }>(`holders?wallet=in.(${wallets.join(",")})&select=wallet,name,rank,class`)
      ).rows
    : [];
  const info = new Map(names.map((n) => [n.wallet, n]));
  const items = rows.map((r) => {
    const n = info.get(r.wallet);
    return {
      ...toNews(r),
      planet: {
        name: n?.name ?? planetName(r.wallet),
        rank: n?.rank ?? null,
        cls: n?.class ?? null,
      },
    };
  });
  const last = items.at(-1);
  return { items, next: items.length === PAGE && last ? `${last.at}_${last.id}` : null };
}

/** Search alive planets by full or partial address or planet name (up to 10). */
export async function searchPlanets(q: string) {
  const query = q.trim();
  if (!query) return [];
  const cols = "select=wallet,name,rank,class";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)) {
    const exact = await select<{ wallet: string; name: string; rank: number; class: PlanetClass }>(
      `holders?wallet=eq.${query}&status=eq.alive&${cols}`,
    );
    if (exact.rows.length) return exact.rows;
  }
  if (query.length < 3) return [];
  const safe = query.replace(/[^A-Za-z0-9 ]/g, "");
  if (!safe) return [];
  const { rows } = await select<{ wallet: string; name: string; rank: number; class: PlanetClass }>(
    `holders?status=eq.alive&rank=not.is.null&or=(wallet.ilike.*${encodeURIComponent(safe)}*,name.ilike.*${encodeURIComponent(safe)}*)&${cols}&order=rank&limit=10`,
  );
  return rows;
}

/** Wallet addresses are base58; anything else never reaches the database. */
export const isWallet = (w: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w);
