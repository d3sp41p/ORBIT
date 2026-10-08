/**
 * Where the site gets its system from.
 * - LiveSource: the server API and Supabase Realtime (after launch, or with
 *   ?preview=<key> before it). The browser only renders what it receives.
 * - DemoSource: the prototype's generator, simulated in the browser, used
 *   until the coin is live (the header shows "Demo data").
 * Both expose the same shapes, so the scene and panels do not care.
 */
import {
  cardFromState,
  DAY_MS,
  DEMO,
  generateDemoSystem,
  newsItem,
  onTimeline,
  scenePlanet,
  starTierIndex,
  step,
  TICK,
  type DemoHolder,
  type NewsItem,
  type PlanetCard,
  type PlanetClass,
  type ScenePlanet,
  type SimEvent,
} from "@orbit/core";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

export interface StarInfo {
  mcap: number;
  tier: number;
  holders: number;
}

export interface Debris {
  wallet: string;
  name: string;
  orbit: number;
  endedAt: number;
}

export interface FeedItem extends NewsItem {
  planet: { name: string; rank: number | null; cls: PlanetClass | null };
}

export type CardResult =
  | { status: "alive"; card: PlanetCard }
  | {
      status: "dead";
      wallet: string;
      name: string;
      endedAt: number;
      summary: Record<string, unknown>;
    }
  | { status: "none" };

export interface SceneData {
  star: StarInfo;
  planets: ScenePlanet[];
  debris: Debris[];
}

export interface Listeners {
  /** A notable event (global feed). */
  onNews(item: FeedItem): void;
  /** Any event of a planet: the open mission page may refresh. */
  onPlanetEvent(wallet: string): void;
  /** New planet data (visuals, ranks, new and lost planets). */
  onScene(data: SceneData): void;
  onStar(star: StarInfo): void;
}

export interface DataSource {
  readonly live: boolean;
  load(): Promise<SceneData>;
  card(wallet: string): Promise<CardResult>;
  moreNews(wallet: string, cursor: string): Promise<{ items: NewsItem[]; next: string | null }>;
  feed(): Promise<FeedItem[]>;
  start(l: Listeners): void;
}

/* ================= live ================= */

export class LiveSource implements DataSource {
  readonly live = true;
  private names = new Map<string, { name: string; rank: number; cls: PlanetClass }>();
  private channel: RealtimeChannel | null = null;

  constructor(
    private readonly preview: string | null,
    private readonly supabase: { url: string; anonKey: string } | null,
  ) {}

  private url(path: string) {
    if (!this.preview) return path;
    return `${path}${path.includes("?") ? "&" : "?"}preview=${encodeURIComponent(this.preview)}`;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path));
    if (!res.ok && res.status !== 404) throw new Error(`${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  /** null when the server has no live data (coin not launched, no preview). */
  async probe(): Promise<SceneData | null> {
    const j = await this.get<{ live: boolean } & Partial<SceneData> & { star?: StarInfo }>(
      "/api/system",
    );
    if (!j.live || !j.planets) return null;
    return this.remember({ star: j.star!, planets: j.planets, debris: j.debris ?? [] });
  }

  private remember(d: SceneData) {
    this.names = new Map(
      d.planets.map((p) => [p.wallet, { name: p.name, rank: p.rank, cls: p.cls }]),
    );
    return d;
  }

  async load(): Promise<SceneData> {
    const d = await this.probe();
    if (!d) throw new Error("live data unavailable");
    return d;
  }

  async card(wallet: string): Promise<CardResult> {
    const j = await this.get<CardResult | { error: unknown }>(`/api/planet/${wallet}`);
    return "error" in j ? { status: "none" } : j;
  }

  async moreNews(wallet: string, cursor: string) {
    return this.get<{ items: NewsItem[]; next: string | null }>(
      `/api/planet/${wallet}/events?cursor=${encodeURIComponent(cursor)}`,
    );
  }

  async feed() {
    return (await this.get<{ items: FeedItem[] }>("/api/feed")).items;
  }

  start(l: Listeners) {
    // Visuals, ranks and new planets: refresh the scene every minute.
    setInterval(async () => {
      try {
        const d = await this.probe();
        if (d) l.onScene(d);
      } catch {
        // keep the last known state; try again next minute
      }
    }, 60_000);
    if (!this.supabase) return;
    const client = createClient(this.supabase.url, this.supabase.anonKey, {
      auth: { persistSession: false },
    });
    this.channel = client
      .channel("orbit-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "planet_events" },
        (msg) => {
          const r = msg.new as {
            id: number;
            wallet: string;
            day: number;
            at: string;
            kind: SimEvent["k"];
            text_en: string;
            notable: boolean;
          };
          l.onPlanetEvent(r.wallet);
          if (!r.notable) return;
          const p = this.names.get(r.wallet);
          l.onNews({
            id: String(r.id),
            wallet: r.wallet,
            kind: r.kind,
            day: r.day,
            at: new Date(r.at).getTime(),
            text: r.text_en,
            notable: true,
            planet: { name: p?.name ?? "", rank: p?.rank ?? null, cls: p?.cls ?? null },
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "system_state" },
        (msg) => {
          const s = msg.new as { mcap: number; star_tier: number; holders_count: number };
          l.onStar({ mcap: s.mcap, tier: s.star_tier, holders: s.holders_count });
        },
      )
      .subscribe();
  }
}

/* ================= demo ================= */

export class DemoSource implements DataSource {
  readonly live = false;
  private sys = generateDemoSystem(Date.now());
  private byWallet = new Map(this.sys.holders.map((h) => [h.addr, h]));
  private cache = new Map<DemoHolder, NewsItem[]>();

  private scene(h: DemoHolder): ScenePlanet {
    return scenePlanet({
      wallet: h.addr,
      name: h.name,
      rank: h.rank,
      timeRank: h.timeRank,
      orbit: h.orbit,
      cls: h.cls,
      nature: h.cls,
      state: h.S,
      days: h.days,
      sells: h.sells,
    });
  }

  private news(h: DemoHolder, e: SimEvent, i: number): NewsItem {
    return newsItem(e, {
      wallet: h.addr,
      nature: h.cls,
      waterMax: h.S.waterMax,
      holdStartedAt: h.start,
      id: String(i),
    });
  }

  private allNews(h: DemoHolder) {
    const list = h.S.news.map((e, i) => this.news(h, e, i)).reverse();
    this.cache.set(h, list);
    return list;
  }

  private data(): SceneData {
    return {
      star: { mcap: DEMO.mcap, tier: starTierIndex(DEMO.mcap), holders: this.sys.holders.length },
      planets: this.sys.holders.map((h) => this.scene(h)),
      debris: [],
    };
  }

  async load() {
    return this.data();
  }

  async card(wallet: string): Promise<CardResult> {
    const h = this.byWallet.get(wallet);
    if (!h) return { status: "none" };
    const news = this.allNews(h);
    return {
      status: "alive",
      card: cardFromState({
        wallet,
        name: h.name,
        rank: h.rank,
        timeRank: h.timeRank,
        holdersCount: this.sys.holders.length,
        cls: h.cls,
        nature: h.cls,
        orbit: h.orbit,
        lifeNo: 1,
        holdStartedAt: h.start,
        now: Date.now(),
        balance: String(Math.round(h.bal * 1e6)),
        decimals: 6,
        buys: h.buys,
        sells: h.sells,
        sellCount: h.sells.length,
        state: h.S,
        news: news.slice(0, 20),
        newsTotal: news.length,
        timeline: news.filter((n) => onTimeline(n.kind)).slice(0, 12),
      }),
    };
  }

  async moreNews(wallet: string, cursor: string) {
    const h = this.byWallet.get(wallet)!;
    const list = this.cache.get(h) ?? this.allNews(h);
    const from = list.findIndex((n) => n.id === cursor) + 1;
    const items = list.slice(from, from + 20);
    return { items, next: items.length === 20 ? items.at(-1)!.id : null };
  }

  private feedItem(h: DemoHolder, e: SimEvent, i: number): FeedItem {
    return { ...this.news(h, e, i), planet: { name: h.name, rank: h.rank, cls: h.cls } };
  }

  async feed() {
    const cut = Date.now() - 30 * 3_600_000;
    const items: FeedItem[] = [];
    for (const h of this.sys.holders)
      h.S.news.forEach((e, i) => {
        const it = this.feedItem(h, e, i);
        if (it.notable && it.at >= cut) items.push(it);
      });
    return items.sort((a, b) => b.at - a.at).slice(0, 12);
  }

  /** The demo simulates in the browser (the prototype's behaviour). */
  start(l: Listeners) {
    setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const h of this.sys.holders) {
        const S = h.S;
        if (now < h.start + S.k * TICK * DAY_MS) continue;
        const before = S.news.length;
        step(S, h, S.k * TICK, this.sys.ctx);
        S.k++;
        h.days = (now - h.start) / DAY_MS;
        changed = true;
        for (let i = before; i < S.news.length; i++) {
          const it = this.feedItem(h, S.news[i]!, i);
          l.onPlanetEvent(h.addr);
          if (it.notable) l.onNews(it);
        }
      }
      if (changed) l.onScene(this.data());
    }, 1000);
  }
}

/** Live data when the server has it, otherwise the demo. */
export async function pickSource(opts: {
  preview: string | null;
  supabase: { url: string; anonKey: string } | null;
}): Promise<{ source: DataSource; data: SceneData }> {
  const live = new LiveSource(opts.preview, opts.supabase);
  try {
    const data = await live.probe();
    if (data) return { source: live, data };
  } catch {
    // server unreachable: fall back to the demo
  }
  const demo = new DemoSource();
  return { source: demo, data: await demo.load() };
}
