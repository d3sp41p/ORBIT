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
  planetName,
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
  /** An event's template text was replaced by its AI text. */
  onNewsText(id: string, text: string): void;
  /** New planet data (visuals, ranks, new and lost planets). */
  onScene(data: SceneData): void;
  onStar(star: StarInfo): void;
}

export interface DataSource {
  readonly live: boolean;
  load(): Promise<SceneData>;
  /** `fresh` skips caches: a refresh after a change must see it. */
  card(wallet: string, fresh?: boolean): Promise<CardResult>;
  moreNews(wallet: string, cursor: string): Promise<{ items: NewsItem[]; next: string | null }>;
  feed(): Promise<FeedItem[]>;
  start(l: Listeners): void;
  /** Reload the scene now (a new planet may have formed). Null when unchanged or unknown. */
  refresh(): Promise<SceneData | null>;
}

/* ================= live ================= */

export class LiveSource implements DataSource {
  readonly live = true;
  private names = new Map<string, { name: string; rank: number; cls: PlanetClass }>();
  private channel: RealtimeChannel | null = null;
  /** News already shown (the polling fallback only passes on new ones). */
  private seen = new Set<string>();
  private polling = 0;

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

  async card(wallet: string, fresh = false): Promise<CardResult> {
    const j = await this.get<CardResult | { error: unknown }>(
      `/api/planet/${wallet}${fresh ? `?t=${Date.now()}` : ""}`,
    );
    return "error" in j ? { status: "none" } : j;
  }

  async moreNews(wallet: string, cursor: string) {
    return this.get<{ items: NewsItem[]; next: string | null }>(
      `/api/planet/${wallet}/events?cursor=${encodeURIComponent(cursor)}`,
    );
  }

  async feed() {
    const items = (await this.get<{ items: FeedItem[] }>("/api/feed")).items;
    items.forEach((i) => this.seen.add(i.id));
    return items;
  }

  /**
   * Without Realtime (its connection limit is reached, or a network blocks
   * websockets) the feed is polled every 20 seconds instead.
   */
  private poll(l: Listeners, on: boolean) {
    if (!on) {
      window.clearInterval(this.polling);
      this.polling = 0;
      return;
    }
    if (this.polling) return;
    this.polling = window.setInterval(async () => {
      try {
        const known = new Set(this.seen);
        const items = (await this.get<{ items: FeedItem[] }>("/api/feed")).items;
        for (const it of [...items].reverse())
          if (!known.has(it.id)) {
            this.seen.add(it.id);
            l.onPlanetEvent(it.wallet);
            l.onNews(it);
          }
      } catch {
        // try again on the next round
      }
    }, 20_000);
  }

  private listeners: Listeners | null = null;
  private lastRefresh = 0;
  private refreshTimer = 0;

  async refresh(): Promise<SceneData | null> {
    this.lastRefresh = Date.now();
    try {
      const d = await this.probe();
      if (d) this.listeners?.onScene(d);
      return d;
    } catch {
      return null; // keep the last known state
    }
  }

  /** A new planet formed: reload soon, at most once every 8 seconds. */
  private refreshSoon() {
    if (this.refreshTimer) return;
    const wait = Math.max(2500, this.lastRefresh + 8000 - Date.now());
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      void this.refresh();
    }, wait);
  }

  start(l: Listeners) {
    this.listeners = l;
    // Visuals, ranks and new planets; new planets also trigger a reload at once.
    setInterval(() => void this.refresh(), 20_000);
    if (!this.supabase) return this.poll(l, true);
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
          // An event of a planet the scene does not have yet: it was just born.
          if (!this.names.has(r.wallet)) this.refreshSoon();
          if (!r.notable) return;
          this.seen.add(String(r.id));
          const p = this.names.get(r.wallet);
          l.onNews({
            id: String(r.id),
            wallet: r.wallet,
            kind: r.kind,
            day: r.day,
            at: new Date(r.at).getTime(),
            text: r.text_en,
            notable: true,
            // A planet that just died is no longer in the scene: its stock name still is its name.
            planet: {
              name: p?.name ?? planetName(r.wallet),
              rank: p?.rank ?? null,
              cls: p?.cls ?? null,
            },
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "planet_events" },
        (msg) => {
          const r = msg.new as { id: number; wallet: string; text_en: string };
          l.onNewsText(String(r.id), r.text_en);
          l.onPlanetEvent(r.wallet);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "planet_chronicle" },
        (msg) => {
          const r = msg.new as { wallet?: string };
          if (r.wallet) l.onPlanetEvent(r.wallet);
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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") this.poll(l, false);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
          this.poll(l, true);
      });
    // No answer from Realtime within 15 seconds: poll until it connects.
    window.setTimeout(() => {
      if (this.channel?.state !== "joined") this.poll(l, true);
    }, 15_000);
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

  async refresh() {
    return null;
  }

  /** The demo simulates in the browser (the prototype's behaviour). */
  start(l: Listeners) {
    // When the coin launches, pages opened before switch to the live system.
    window.setInterval(async () => {
      try {
        const j = (await (await fetch("/api/system")).json()) as { live?: boolean };
        if (j.live) location.reload();
      } catch {
        // offline for a moment: ask again later
      }
    }, 30_000);
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
