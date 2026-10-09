/**
 * Data for the public API (spec: "API"). Everything is computed on the server
 * from the database; the browser never simulates anything.
 */
import {
  applyNames,
  cardFromState,
  hasCustom,
  namePairs,
  planetName,
  stockNames,
  type Bible,
  type CustomValues,
  scenePlanet,
  type NewsItem,
  type PlanetCard,
  type PlanetClass,
  type ScenePlanet,
  type Sell,
  type SimEvent,
  type StoredState,
} from "@orbit/core";
import { rpc, select, selectAll } from "./db";

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

/* ================= owner names ================= */

/**
 * Owner names in effect, by wallet. Names the admin hid are not readable with
 * the anon key at all, so they never reach this code. Only the whole map
 * (scene) is cached briefly: a card must show a change right after saving.
 */
async function customOf(wallets: string[] | "all"): Promise<Map<string, CustomValues>> {
  if (wallets !== "all" && !wallets.length) return new Map();
  const filter = wallets === "all" ? "" : `wallet=in.(${wallets.join(",")})&`;
  const rows = await selectAll<CustomValues & { wallet: string }>(
    `planet_custom?${filter}select=wallet,name,species,capital,motto`,
    wallets === "all" ? 15 : undefined,
  );
  return new Map(
    rows
      .filter(hasCustom)
      .map((r) => [
        r.wallet,
        { name: r.name, species: r.species, capital: r.capital, motto: r.motto },
      ]),
  );
}

/** Text replacements (stock name -> owner name) for the given planets. */
async function pairsOf(wallets: string[]): Promise<Map<string, [string, string][]>> {
  const custom = await customOf(wallets);
  const out = new Map<string, [string, string][]>();
  const ws = [...custom.keys()];
  if (!ws.length) return out;
  const [holders, states] = await Promise.all([
    select<{ wallet: string; name: string | null }>(
      `holders?wallet=in.(${ws.join(",")})&select=wallet,name`,
    ),
    select<{ wallet: string; bible: Bible | null }>(
      `planet_state?wallet=in.(${ws.join(",")})&select=wallet,bible:state->bible`,
    ),
  ]);
  const names = new Map(holders.rows.map((r) => [r.wallet, r.name]));
  const bibles = new Map(states.rows.map((r) => [r.wallet, r.bible]));
  for (const w of ws) {
    const stock = stockNames(names.get(w) ?? planetName(w), bibles.get(w));
    out.set(w, namePairs(stock, custom.get(w)!));
  }
  return out;
}

/** Sells of the current life with the simulation's catastrophe marks. */
const marked = (log: Sell[] | null, counted: number[] | null | undefined): Sell[] => {
  const marks = new Set(counted ?? []);
  return (log ?? []).map((s, i) => ({ ...s, counted: marks.has(i) }));
};

export async function loadSystem(revalidate: number): Promise<SystemData> {
  const [stateRes, holders, states, archive, custom] = await Promise.all([
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
    customOf("all"),
  ]);
  const s = stateRes.rows[0]!;
  const byWallet = new Map(states.map((r) => [r.wallet, r]));
  const now = Date.now();
  const planets: ScenePlanet[] = [];
  for (const h of holders) {
    const st = byWallet.get(h.wallet);
    if (!st) continue; // planet not formed yet (a few seconds after the first buy)
    const stock = h.name ?? planetName(h.wallet);
    const own = custom.get(h.wallet)?.name;
    const p = scenePlanet({
      wallet: h.wallet,
      name: own ?? stock,
      rank: h.rank,
      timeRank: h.time_rank,
      orbit: h.orbit,
      cls: h.class,
      nature: st.nature,
      state: st,
      days: (now - new Date(st.hold_started_at).getTime()) / 86_400_000,
      sells: marked(h.sell_log, st.counted),
    });
    planets.push(own && own !== stock ? { ...p, stockName: stock } : p);
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

/**
 * Planet news, newest first; cursor = id of the last item already shown.
 * Owner names replace the stock ones in every text, old ones included.
 */
export async function loadEvents(
  wallet: string,
  lifeNo: number,
  cursor?: string,
  pairs?: [string, string][],
) {
  const after = cursor && /^\d+$/.test(cursor) ? `&id=lt.${cursor}` : "";
  const [{ rows, total }, names] = await Promise.all([
    select<EventRow>(
      `planet_events?wallet=eq.${wallet}&life_no=eq.${lifeNo}${after}&select=${EVENT_COLS}&order=id.desc&limit=${PAGE}`,
      { count: !cursor },
    ),
    pairs ?? pairsOf([wallet]).then((m) => m.get(wallet) ?? []),
  ]);
  const items = rows.map((r) => ({ ...toNews(r), text: applyNames(r.text_en, names) }));
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
  const [holderRes, stateRes, sys, customRes] = await Promise.all([
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
      lore: { species: string; text: string } | null;
    }>(
      `planet_state?wallet=eq.${wallet}&select=life_no,nature,hold_started_at,state,lore:bible->lore`,
    ),
    select<StateRow>("system_state?id=eq.1&select=holders_count,token_decimals", {
      revalidate: 15,
    }),
    customOf([wallet]),
  ]);
  const own = customRes.get(wallet) ?? null;
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
      // The archive keeps the name the planet had (the owner's, unless hidden).
      name: (rows[0].summary.name as string | undefined) ?? h.name ?? planetName(wallet),
      endedAt: new Date(rows[0].ended_at).getTime(),
      summary: rows[0].summary,
    };
  }
  const bible = ps.state.bible;
  const stock = stockNames(h.name ?? planetName(wallet), bible);
  const pairs = namePairs(stock, own);
  const named = (n: NewsItem): NewsItem => ({ ...n, text: applyNames(n.text, pairs) });
  const [news, timeline, chron] = await Promise.all([
    loadEvents(wallet, h.life_no, undefined, pairs),
    select<EventRow>(
      `planet_events?wallet=eq.${wallet}&life_no=eq.${h.life_no}&or=(kind.in.(formed,sell,collapse,eraDown,eraUp,life,lifeGas,lifeAst,civ,rare))&select=${EVENT_COLS}&order=id.desc&limit=12`,
    ),
    select<{ text_en: string; generated_at: string; events_hash: string }>(
      `planet_chronicle?wallet=eq.${wallet}&life_no=eq.${h.life_no}&select=text_en,generated_at,events_hash`,
    ),
  ]);
  // The chronicle is written by the worker; ask for it when missing or 5+ events behind.
  const total = news.total ?? news.items.length;
  const chronicle = chron.rows[0];
  const counted = Number(chronicle?.events_hash.split(":")[0]);
  if (!chronicle || !(total - counted < 5))
    await rpc("request_chronicle", { p_wallet: wallet }).catch(() => undefined);
  const sells = marked(h.sell_log, ps.state.countedSells);
  const card = cardFromState({
    wallet,
    name: own?.name ?? stock.name,
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
    newsTotal: total,
    timeline: timeline.rows.map(toNews).map(named),
    lore: bible && ps.lore?.species === bible.species ? applyNames(ps.lore.text, pairs) : null,
    chronicle: chronicle
      ? {
          text: applyNames(chronicle.text_en, pairs),
          at: new Date(chronicle.generated_at).getTime(),
        }
      : null,
    stock,
    custom: own,
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
  const [pairs, custom] = await Promise.all([pairsOf(wallets), customOf(wallets)]);
  const items = rows.map((r) => {
    const n = info.get(r.wallet);
    return {
      ...toNews(r),
      text: applyNames(r.text_en, pairs.get(r.wallet) ?? []),
      planet: {
        name: custom.get(r.wallet)?.name ?? n?.name ?? planetName(r.wallet),
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
    if (exact.rows.length) {
      const custom = await customOf([query]);
      return exact.rows.map((r) => ({ ...r, name: custom.get(r.wallet)?.name ?? r.name }));
    }
  }
  if (query.length < 3) return [];
  const safe = query.replace(/[^A-Za-z0-9 ]/g, "");
  if (!safe) return [];
  const like = encodeURIComponent(safe);
  const [stock, owned] = await Promise.all([
    select<{ wallet: string; name: string; rank: number; class: PlanetClass }>(
      `holders?status=eq.alive&rank=not.is.null&or=(wallet.ilike.*${like}*,name.ilike.*${like}*)&${cols}&order=rank&limit=10`,
    ),
    select<{ wallet: string }>(`planet_custom?name=ilike.*${like}*&select=wallet&limit=10`),
  ]);
  const extra = owned.rows
    .map((r) => r.wallet)
    .filter((w) => !stock.rows.some((s) => s.wallet === w));
  const more = extra.length
    ? (
        await select<{ wallet: string; name: string; rank: number; class: PlanetClass }>(
          `holders?wallet=in.(${extra.join(",")})&status=eq.alive&rank=not.is.null&${cols}`,
        )
      ).rows
    : [];
  const all = [...stock.rows, ...more].sort((a, b) => a.rank - b.rank).slice(0, 10);
  const custom = await customOf(all.map((r) => r.wallet));
  return all.map((r) => ({ ...r, name: custom.get(r.wallet)?.name ?? r.name }));
}

/** Wallet addresses are base58; anything else never reaches the database. */
export const isWallet = (w: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w);
